"""BlueBubbles Server adapter — iMessage tapbacks, screen effects, and presence (AI-8808, AI-8876).

BlueBubbles Server (https://bluebubbles.app) exposes a REST API and a
Socket.IO WebSocket that can drive the Messages.app Private API on macOS to:

  * Send tapbacks (love / like / dislike / laugh / emphasize / question)
    via POST /api/v1/message/react
  * Send iMessage screen effects (slam, loud, gentle, …)
    via POST /api/v1/message/text with the ``effectId`` field
  * Send typing indicators (AI-8876 Y7)
    via POST /api/v1/chat/:guid/typing
  * Mark chats as read (AI-8876 Y7)
    via POST /api/v1/chat/:guid/read

AppleScript / osascript CANNOT do either of these things — the Messages.app
scripting dictionary has no tapback or effectId support. BlueBubbles is the
only non-jailbreak path for these features.

Requirements on the user's Mac:
  1. BlueBubbles Server app running.
  2. BlueBubbles Private API Helper plugin installed + enabled in the app.
     (Without it, /api/v1/message/react returns 400 / disabled.)
  3. macOS SIP must be partially disabled for the Helper plugin to load into
     Messages.app. Instructions: https://docs.bluebubbles.app/private-api

Auth: every request must include the server password either as a query
parameter (?password=<pw>) or as Basic auth. We use the query param because
it is compatible with Socket.IO URL construction.

Env vars (fallbacks if not passed to constructor):
    BLUEBUBBLES_URL       — server base URL, e.g. http://192.168.1.5:1234
    BLUEBUBBLES_PASSWORD  — server password (plaintext, stored encrypted in DB)
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Generator, Any

import requests

logger = logging.getLogger("clapcheeks.imessage.bluebubbles")

# ---------------------------------------------------------------------------
# Tapback kind enum
# ---------------------------------------------------------------------------

class TapbackKind(Enum):
    """BlueBubbles reaction integers for iMessage tapbacks.

    Positive values add the tapback; negative values remove it.
    Wire values match the BlueBubbles API spec:
        https://documenter.getpostman.com/view/14988634/Tz5p7yPv
    """
    LOVE        =  2000
    LIKE        =  2001
    DISLIKE     =  2002
    LAUGH       =  2003
    EMPHASIZE   =  2004
    QUESTION    =  2005

    # Remove variants — subtract 1000 from the base value
    REMOVE_LOVE       = -2000
    REMOVE_LIKE       = -2001
    REMOVE_DISLIKE    = -2002
    REMOVE_LAUGH      = -2003
    REMOVE_EMPHASIZE  = -2004
    REMOVE_QUESTION   = -2005

    @property
    def is_remove(self) -> bool:
        return self.value < 0

    @property
    def label(self) -> str:
        return self.name.lower().replace("remove_", "-")


# ---------------------------------------------------------------------------
# iMessage screen effect IDs
# ---------------------------------------------------------------------------

#: Full set of iMessage screen effect IDs as accepted by the BlueBubbles API.
#: Pass one of these strings as ``effect_id`` to ``send_text``.
EFFECT_IDS: dict[str, str] = {
    "slam":        "com.apple.MobileSMS.expressivesend.impact",
    "loud":        "com.apple.MobileSMS.expressivesend.loud",
    "gentle":      "com.apple.MobileSMS.expressivesend.gentle",
    "invisible":   "com.apple.MobileSMS.expressivesend.invisibleink",
    "lasers":      "com.apple.messages.effect.CKEchoEffect",
    "balloons":    "com.apple.messages.effect.CKHappyBirthdayEffect",
    "confetti":    "com.apple.messages.effect.CKConfettiEffect",
    "fireworks":   "com.apple.messages.effect.CKFireworksEffect",
    "celebration": "com.apple.messages.effect.CKSparklesEffect",
    "spotlight":   "com.apple.messages.effect.CKShootingStarEffect",
    "echo":        "com.apple.MobileSMS.expressivesend.echo",
}


# ---------------------------------------------------------------------------
# Result type (mirrors imessage.sender.SendResult for API parity)
# ---------------------------------------------------------------------------

@dataclass
class SendResult:
    ok: bool
    channel: str = "bluebubbles"
    error: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# BlueBubbles REST client
# ---------------------------------------------------------------------------

class BlueBubblesError(RuntimeError):
    """Non-transient error from the BlueBubbles Server API."""


class BlueBubblesClient:
    """REST client for a local BlueBubbles Server instance.

    Parameters
    ----------
    url:
        Base URL of the server, e.g. ``http://192.168.1.5:1234``.
        Trailing slash is stripped automatically.
    password:
        Server password (plaintext). In production this is decrypted from
        ``clapcheeks_user_settings.bluebubbles_password`` via
        ``clapcheeks.auth.token_vault.decrypt_token``.
    timeout:
        Per-request timeout in seconds (default 15).
    """

    def __init__(self, url: str, password: str, *, timeout: int = 15) -> None:
        self.base_url = url.rstrip("/")
        self.password = password
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json",
        })

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _url(self, path: str) -> str:
        return f"{self.base_url}{path}"

    def _params(self, extra: dict | None = None) -> dict:
        p = {"password": self.password}
        if extra:
            p.update(extra)
        return p

    def _post(self, path: str, payload: dict) -> dict:
        """POST ``payload`` to ``path`` and return the parsed JSON body.

        Raises ``BlueBubblesError`` on non-2xx or network error.
        """
        try:
            resp = self._session.post(
                self._url(path),
                json=payload,
                params=self._params(),
                timeout=self.timeout,
            )
        except requests.RequestException as exc:
            raise BlueBubblesError(f"network error: {exc}") from exc

        if not resp.ok:
            raise BlueBubblesError(
                f"HTTP {resp.status_code} from {path}: {resp.text[:300]}"
            )
        try:
            return resp.json()
        except ValueError:
            return {"status": resp.status_code, "raw": resp.text}

    # ------------------------------------------------------------------
    # Public send API
    # ------------------------------------------------------------------

    def send_text(
        self,
        handle: str,
        body: str,
        *,
        effect_id: str | None = None,
        subject: str | None = None,
    ) -> SendResult:
        """Send a plain-text iMessage, optionally with a screen effect.

        Parameters
        ----------
        handle:
            Recipient phone in E.164 format (e.g. ``+14155550100``) or email.
        body:
            Message body text.
        effect_id:
            One of the ``EFFECT_IDS`` values (e.g. ``EFFECT_IDS["slam"]``).
            Pass the raw effect URI string, not a short-name key.
        subject:
            Optional message subject (bold text above the body in iMessage).
        """
        if not body.strip():
            return SendResult(ok=False, error="empty body")

        payload: dict[str, Any] = {
            "chatGuid": f"iMessage;-;{handle}",
            "message": body,
            "method": "private-api",  # required for effectId
        }
        if effect_id:
            payload["effectId"] = effect_id
        if subject:
            payload["subject"] = subject

        logger.debug(
            "BlueBubbles send_text to %s effect=%s", handle, effect_id or "none"
        )
        try:
            data = self._post("/api/v1/message/text", payload)
            return SendResult(ok=True, raw=data)
        except BlueBubblesError as exc:
            logger.warning("send_text failed for %s: %s", handle, exc)
            return SendResult(ok=False, error=str(exc))

    def send_tapback(
        self,
        target_message_guid: str,
        kind: TapbackKind,
    ) -> SendResult:
        """Send a tapback (react) on a specific message GUID.

        Parameters
        ----------
        target_message_guid:
            The iMessage GUID of the message to react to.
            Format: ``p:0/<uuid>`` as returned by the BlueBubbles API or
            ingested from Messages.db (chat.db) ROWID-derived identifiers.
        kind:
            ``TapbackKind`` variant to apply (or remove).

        Notes
        -----
        Requires the BlueBubbles Private API Helper plugin. Without it the
        server returns HTTP 400 "Private API disabled". Installation:
        https://docs.bluebubbles.app/private-api/installation
        """
        payload = {
            "selectedMessageGuid": target_message_guid,
            "reaction": kind.value,
        }
        logger.debug(
            "BlueBubbles send_tapback guid=%s kind=%s (%d)",
            target_message_guid, kind.name, kind.value,
        )
        try:
            data = self._post("/api/v1/message/react", payload)
            return SendResult(ok=True, raw=data)
        except BlueBubblesError as exc:
            logger.warning(
                "send_tapback failed guid=%s kind=%s: %s",
                target_message_guid, kind.name, exc,
            )
            return SendResult(ok=False, error=str(exc))

    # ------------------------------------------------------------------
    # AI-8876 (Y7) — Typing indicators and read receipts
    # ------------------------------------------------------------------

    def start_typing(self, chat_guid: str) -> SendResult:
        """Send a typing-started indicator to the given chat.

        Parameters
        ----------
        chat_guid:
            BlueBubbles chat GUID, e.g. ``iMessage;-;+14155550100`` or a
            group chat GUID from the ``/api/v1/chat/query`` endpoint.

        Notes
        -----
        Requires the BlueBubbles Private API Helper plugin.  Without it
        the server returns HTTP 400 "Private API disabled".
        """
        logger.debug("BlueBubbles start_typing chat_guid=%s", chat_guid)
        try:
            data = self._post(
                f"/api/v1/chat/{chat_guid}/typing",
                {"typing": True},
            )
            return SendResult(ok=True, raw=data)
        except BlueBubblesError as exc:
            logger.warning("start_typing failed guid=%s: %s", chat_guid, exc)
            return SendResult(ok=False, error=str(exc))

    def stop_typing(self, chat_guid: str) -> SendResult:
        """Send a typing-stopped indicator to the given chat.

        Parameters
        ----------
        chat_guid:
            BlueBubbles chat GUID.
        """
        logger.debug("BlueBubbles stop_typing chat_guid=%s", chat_guid)
        try:
            data = self._post(
                f"/api/v1/chat/{chat_guid}/typing",
                {"typing": False},
            )
            return SendResult(ok=True, raw=data)
        except BlueBubblesError as exc:
            logger.warning("stop_typing failed guid=%s: %s", chat_guid, exc)
            return SendResult(ok=False, error=str(exc))

    def mark_read(self, chat_guid: str) -> SendResult:
        """Mark all messages in the given chat as read.

        Parameters
        ----------
        chat_guid:
            BlueBubbles chat GUID.

        Notes
        -----
        This sends a read receipt to the remote party via the Private API.
        Requires the BlueBubbles Private API Helper plugin.
        """
        logger.debug("BlueBubbles mark_read chat_guid=%s", chat_guid)
        try:
            data = self._post(
                f"/api/v1/chat/{chat_guid}/read",
                {},
            )
            return SendResult(ok=True, raw=data)
        except BlueBubblesError as exc:
            logger.warning("mark_read failed guid=%s: %s", chat_guid, exc)
            return SendResult(ok=False, error=str(exc))

    # ------------------------------------------------------------------
    # WebSocket (inbound events) — scaffolded, persistence is follow-up
    # ------------------------------------------------------------------

    def connect_ws(self) -> None:
        """Open a Socket.IO connection to receive inbound BlueBubbles events.

        Scaffold only — full persistence implementation is out of scope for
        AI-8808 (tagged as follow-up). This method is a no-op unless the
        optional ``socketio-client`` / ``python-socketio`` package is
        present at runtime.

        When implemented, the loop should call ``iter_events()`` and store
        incoming reaction events to ``clapcheeks_conversations.reactions``.
        """
        logger.info(
            "BlueBubbles WS connect_ws() called — "
            "WebSocket persistence is scaffolded; full implementation is a "
            "follow-up to AI-8808 (requires python-socketio dependency)."
        )

    def iter_events(self) -> Generator[dict[str, Any], None, None]:
        """Yield inbound BlueBubbles events (tapbacks, new messages, etc.).

        Scaffold only — yields nothing until the Socket.IO loop is wired up.
        Full implementation: subscribe to ``new-message`` and ``updated-message``
        events from the BlueBubbles Socket.IO server and forward tapback
        payloads to the reaction persistence layer.

        Example event shape for a tapback::

            {
              "type": "updated-message",
              "data": {
                "guid": "p:0/<uuid>",
                "associatedMessageType": 2000,  # LOVE tapback
                "associatedMessageGuid": "<target-guid>",
              }
            }
        """
        logger.debug(
            "iter_events() scaffold: no events emitted (WS not connected)"
        )
        return
        yield  # make this a generator without importing anything

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------

    def ping(self) -> bool:
        """Return True if the server is reachable and the password is valid."""
        try:
            resp = self._session.get(
                self._url("/api/v1/server/info"),
                params=self._params(),
                timeout=self.timeout,
            )
            return resp.ok
        except requests.RequestException:
            return False


__all__ = [
    "BlueBubblesClient",
    "BlueBubblesError",
    "TapbackKind",
    "EFFECT_IDS",
    "SendResult",
]
