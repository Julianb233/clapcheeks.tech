"""Phase F iMessage sender (AI-8320).

Sends outbound iMessages using the Mac Mini `god mac send` bridge. Falls
back to a local `osascript` call if running on the Mac directly and god
is not on PATH.

Keeps a narrow surface so the drafting pipeline can remain platform-
agnostic — callers pass (phone_e164, body).

Patches:
- P3 (AI-8737): pre-send chat.db recheck — abort if the operator just
  typed a message manually on the same handle (avoid double-texting).
- P4 (AI-8738): explicit AppleScript account-index routing for the
  osascript fallback so SMS handles route via the SMS account
  (Continuity / Messages in iCloud) instead of the iMessage account.
- AI-8808: BlueBubbles adapter for tapbacks and screen effects. When
  ``BLUEBUBBLES_URL`` + ``BLUEBUBBLES_PASSWORD`` are set (or passed
  explicitly), ``send_tapback`` and ``send_with_effect`` route through
  the BlueBubbles REST API.
- AI-8876 (Y1): ``send_imessage`` now tries BlueBubbles *first* when
  ``BLUEBUBBLES_URL`` + ``BLUEBUBBLES_PASSWORD`` are set, then falls
  through to god-mac, then osascript. This gives Private-API delivery
  (read receipts, typing indicators, effects) as the default path while
  preserving full backwards compatibility.
"""
from __future__ import annotations

import logging
import os
import shutil
import sqlite3
import subprocess
from dataclasses import dataclass
from pathlib import Path

from clapcheeks.imessage.reader import to_e164_us

logger = logging.getLogger("clapcheeks.imessage.sender")


# ---------------------------------------------------------------------------
# Paths / configuration
# ---------------------------------------------------------------------------

IMESSAGE_DB_PATH = Path.home() / "Library" / "Messages" / "chat.db"

# AppleScript "account N" routing. macOS Messages.app exposes both an
# iMessage account and an SMS-forwarding account; their indices are stable
# per-Mac but vary across machines. Override per-Mac with env vars.
IMESSAGE_ACCOUNT_INDEX = int(os.environ.get("IMESSAGE_ACCOUNT_INDEX", "5"))
SMS_ACCOUNT_INDEX = int(os.environ.get("SMS_ACCOUNT_INDEX", "2"))

# Country-code prefixes that we treat as SMS-by-default (Android-heavy
# regions where iMessage delivery routinely fails). Operator can extend
# this list per-handle via SMS_HANDLES_FILE.
SMS_PREFIXES = ("+52", "+91")  # +52 Mexico, +91 India
SMS_HANDLES_FILE = Path.home() / ".clapcheeks" / "sms-handles.txt"


@dataclass
class SendResult:
    ok: bool
    channel: str              # 'god-mac' | 'osascript' | 'noop'
    error: str | None = None


# ---------------------------------------------------------------------------
# Helpers — transport detection
# ---------------------------------------------------------------------------

def _which_god() -> str | None:
    return shutil.which("god")


def _which_osascript() -> str | None:
    return shutil.which("osascript")


# ---------------------------------------------------------------------------
# P3 — pre-send chat.db recheck
# ---------------------------------------------------------------------------

def _recheck_no_double_text(handle_id: str) -> bool:
    """Re-query chat.db for the LAST message on this handle.

    Returns False if is_from_me=1 (operator typed manually since the draft
    was generated). Returns True if safe to send (her last, or no prior).

    Fails OPEN — if chat.db is unavailable (not on Mac, FDA revoked, etc.)
    we let the send proceed rather than silently dropping every draft.
    """
    if not IMESSAGE_DB_PATH.exists():
        return True  # not on Mac with chat.db — let send proceed
    try:
        db = sqlite3.connect(f"file:{IMESSAGE_DB_PATH}?mode=ro", uri=True, timeout=2)
        last = db.execute(
            """SELECT is_from_me FROM message m
               JOIN handle h ON m.handle_id = h.rowid
               WHERE h.id = ? ORDER BY date DESC LIMIT 1""",
            (handle_id,),
        ).fetchone()
        db.close()
        return last is None or last[0] == 0
    except Exception as exc:  # noqa: BLE001 — fail-open on any DB error
        logger.warning(
            "chat.db recheck failed for %s: %s — proceeding with send",
            handle_id, exc,
        )
        return True  # fail-open


# ---------------------------------------------------------------------------
# P4 — SMS handle classification
# ---------------------------------------------------------------------------

def _is_sms_handle(handle: str) -> bool:
    """Decide whether a phone handle should route through the SMS account.

    Rules (in order):
    1. Country-code prefix matches SMS_PREFIXES (Mexico, India, ...).
    2. Operator-overridden allow-list at ~/.clapcheeks/sms-handles.txt
       (one E.164 handle per line; blank lines and whitespace ignored).
    """
    if any(handle.startswith(p) for p in SMS_PREFIXES):
        return True
    if SMS_HANDLES_FILE.exists():
        try:
            entries = {
                line.strip()
                for line in SMS_HANDLES_FILE.read_text().splitlines()
                if line.strip()
            }
            return handle in entries
        except OSError:
            pass
    return False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def send_imessage(
    phone: str,
    body: str,
    *,
    dry_run: bool = False,
    user_id: str | None = None,
    match_id: str | None = None,
    supabase=None,
) -> SendResult:
    """Send `body` to `phone` via iMessage / SMS.

    Normalizes phone to E.164 first. On dry_run (or if no transport is
    available), returns a noop SendResult without raising.

    AI-8809: when user_id + match_id + supabase are provided the AI gate is
    checked first; if paused the send is refused and logged.
    """
    # AI-8809: gate check — refuse silently when AI is paused.
    if supabase is not None and user_id and match_id:
        from clapcheeks.autonomy.gate import is_ai_active
        if not is_ai_active(supabase, user_id, match_id):
            logger.info(
                "send_imessage: refused for user=%s match=%s — ai_paused",
                user_id, match_id,
            )
            return SendResult(ok=False, channel="noop", error="ai_paused")

    e164 = to_e164_us(phone)
    if not e164:
        return SendResult(ok=False, channel="noop", error=f"bad phone: {phone!r}")
    if not body or not body.strip():
        return SendResult(ok=False, channel="noop", error="empty body")

    if dry_run:
        logger.info("[dry_run] would send iMessage to %s: %s", e164, body[:80])
        return SendResult(ok=True, channel="noop")

    # P3: chat.db recheck — abort if operator typed manually since draft.
    if not _recheck_no_double_text(e164):
        logger.info(
            "send aborted for %s — last message is_from_me=1 (operator typed)",
            e164,
        )
        return SendResult(ok=False, channel="noop", error="double_text_aborted")

    # AI-8876 (Y1): BlueBubbles-first — try BB when configured, fall through
    # to god-mac then osascript if BB is unavailable or errors.
    bb = _bluebubbles_client()
    if bb is not None:
        try:
            from clapcheeks.imessage.bluebubbles import SendResult as BBResult
            bb_result: BBResult = bb.send_text(e164, body)
            if bb_result.ok:
                logger.debug("send_imessage: delivered via BlueBubbles to %s", e164)
                return SendResult(ok=True, channel="bluebubbles")
            logger.warning(
                "send_imessage: BlueBubbles failed for %s (%s) — falling through to god-mac",
                e164, bb_result.error,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "send_imessage: BlueBubbles exception for %s: %s — falling through to god-mac",
                e164, exc,
            )

    god = _which_god()
    if god:
        try:
            proc = subprocess.run(
                [god, "mac", "send", e164, body],
                capture_output=True, text=True, timeout=30, check=False,
            )
            if proc.returncode == 0:
                return SendResult(ok=True, channel="god-mac")
            return SendResult(
                ok=False, channel="god-mac",
                error=f"rc={proc.returncode} stderr={proc.stderr[:200]}",
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            return SendResult(ok=False, channel="god-mac", error=str(exc))

    osa = _which_osascript()
    if osa:
        # P4: explicit account-index routing. Pick SMS account for handles
        # we know are SMS, otherwise iMessage account.
        account_index = (
            SMS_ACCOUNT_INDEX if _is_sms_handle(e164) else IMESSAGE_ACCOUNT_INDEX
        )
        escaped_body = body.replace("\\", "\\\\").replace('"', '\\"')
        script = (
            f'tell application "Messages" to send "{escaped_body}" '
            f'to participant "{e164}" of account {account_index}'
        )
        try:
            proc = subprocess.run(
                [osa, "-e", script],
                capture_output=True, text=True, timeout=30, check=False,
            )
            if proc.returncode == 0:
                return SendResult(ok=True, channel="osascript")
            return SendResult(
                ok=False, channel="osascript",
                error=f"rc={proc.returncode} stderr={proc.stderr[:200]}",
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            return SendResult(ok=False, channel="osascript", error=str(exc))

    return SendResult(ok=False, channel="noop", error="no iMessage transport available")


# ---------------------------------------------------------------------------
# AI-8808 — BlueBubbles-routed tapback + effect API
# ---------------------------------------------------------------------------

def _bluebubbles_client(
    url: str | None = None,
    password: str | None = None,
):
    """Return a ``BlueBubblesClient`` or ``None`` if BlueBubbles is not configured.

    Prefers explicit ``url`` / ``password`` arguments; falls back to the
    ``BLUEBUBBLES_URL`` / ``BLUEBUBBLES_PASSWORD`` environment variables.
    Returns ``None`` (silently) if neither source provides a URL.
    """
    import os as _os

    _url = url or _os.environ.get("BLUEBUBBLES_URL", "")
    _pw = password or _os.environ.get("BLUEBUBBLES_PASSWORD", "")
    if not _url:
        return None

    try:
        from clapcheeks.imessage.bluebubbles import BlueBubblesClient
        return BlueBubblesClient(_url, _pw)
    except ImportError as exc:
        logger.warning(
            "BlueBubblesClient import failed — check that requests is installed: %s", exc
        )
        return None


def send_tapback(
    phone: str,
    target_msg_guid: str,
    kind,  # TapbackKind
    *,
    bluebubbles_url: str | None = None,
    bluebubbles_password: str | None = None,
) -> SendResult:
    """Send a tapback (react) on a specific iMessage GUID.

    Routes through BlueBubbles Server if ``bluebubbles_url`` is provided (or
    the ``BLUEBUBBLES_URL`` env var is set). If neither is configured, logs a
    warning and returns a noop result — the text conversation is unaffected.

    Parameters
    ----------
    phone:
        Recipient handle in E.164 format. Used only for logging; the actual
        tapback target is ``target_msg_guid``.
    target_msg_guid:
        iMessage GUID of the message to react to (e.g. ``p:0/<uuid>``).
    kind:
        ``TapbackKind`` enum value (LOVE, LIKE, DISLIKE, LAUGH,
        EMPHASIZE, QUESTION, or the REMOVE_* variants).
    bluebubbles_url, bluebubbles_password:
        Override the env-var defaults for per-user credential lookup.
    """
    e164 = to_e164_us(phone) or phone  # best-effort normalize; guid is the real key

    bb = _bluebubbles_client(bluebubbles_url, bluebubbles_password)
    if bb is None:
        logger.warning(
            "send_tapback: BlueBubbles not configured for %s — "
            "tapback dropped (BLUEBUBBLES_URL not set). "
            "Set BLUEBUBBLES_URL + BLUEBUBBLES_PASSWORD to enable.",
            e164,
        )
        return SendResult(
            ok=False,
            channel="noop",
            error="BlueBubbles not configured — tapback not supported via osascript/god-mac",
        )

    from clapcheeks.imessage.bluebubbles import SendResult as BBResult

    bb_result: BBResult = bb.send_tapback(target_msg_guid, kind)
    return SendResult(
        ok=bb_result.ok,
        channel="bluebubbles",
        error=bb_result.error,
    )


def send_with_effect(
    phone: str,
    body: str,
    effect_id: str,
    *,
    dry_run: bool = False,
    bluebubbles_url: str | None = None,
    bluebubbles_password: str | None = None,
) -> SendResult:
    """Send ``body`` to ``phone`` with an iMessage screen effect.

    Routes through BlueBubbles Server when configured. Falls back to a plain
    ``send_imessage`` call (which drops the effect) if BlueBubbles is not
    configured — the body is still delivered.

    Parameters
    ----------
    phone:
        Recipient phone in E.164 format.
    body:
        Message text.
    effect_id:
        BlueBubbles / iMessage effect ID, e.g.
        ``"com.apple.MobileSMS.expressivesend.impact"`` (slam) or one of
        the values from ``clapcheeks.imessage.bluebubbles.EFFECT_IDS``.
    dry_run:
        When True, short-circuit and return a noop result.
    bluebubbles_url, bluebubbles_password:
        Override the env-var defaults for per-user credential lookup.
    """
    e164 = to_e164_us(phone)
    if not e164:
        return SendResult(ok=False, channel="noop", error=f"bad phone: {phone!r}")
    if not body or not body.strip():
        return SendResult(ok=False, channel="noop", error="empty body")

    if dry_run:
        logger.info(
            "[dry_run] would send iMessage to %s with effect %s: %s",
            e164, effect_id, body[:80],
        )
        return SendResult(ok=True, channel="noop")

    bb = _bluebubbles_client(bluebubbles_url, bluebubbles_password)
    if bb is None:
        logger.warning(
            "send_with_effect: BlueBubbles not configured — "
            "sending %s without effect %s via standard path",
            e164, effect_id,
        )
        # Fall back to plain send (body delivered, effect silently dropped).
        return send_imessage(e164, body)

    from clapcheeks.imessage.bluebubbles import SendResult as BBResult

    bb_result: BBResult = bb.send_text(e164, body, effect_id=effect_id)
    return SendResult(
        ok=bb_result.ok,
        channel="bluebubbles",
        error=bb_result.error,
    )
