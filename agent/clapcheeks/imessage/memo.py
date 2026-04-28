"""Per-contact memo writer (P6, AI-8740 — write side).

Called from the handoff path when a phone number lands in a Hinge/Tinder
convo. Writes ``~/.clapcheeks/memos/+E164.md`` with the match's profile +
last 30 messages so the iMessage reply path has rich context post-handoff.

The READ side lives in ``clapcheeks.imessage.ai_reply`` (separate change).
This module is intentionally narrow: pure stdlib, no Supabase coupling,
safe to call from any platform-specific handoff hook.
"""
from __future__ import annotations

import datetime
import logging
import re
from pathlib import Path

logger = logging.getLogger("clapcheeks.imessage.memo")

MEMO_DIR = Path.home() / ".clapcheeks" / "memos"


def _normalize_phone(raw: str) -> str:
    """Return E.164 ``+1XXXXXXXXXX`` or ``+NN...`` format.

    Returns an empty string when no digits are present so callers can
    short-circuit without writing a stray ``+.md`` file.
    """
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return ""
    if len(digits) == 10:
        return f"+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"
    return f"+{digits}"


def write_memo(
    phone: str,
    *,
    name: str = "",
    source: str = "",
    age: str = "",
    city: str = "",
    distance_mi: str = "",
    schools: list[str] | None = None,
    jobs: list[str] | None = None,
    prompts: list[dict] | None = None,
    her_comment: str = "",
    convo_lines: list[str] | None = None,
    overwrite: bool = False,
) -> str:
    """Write or merge a per-contact memo.

    Returns the absolute path that was written, or an empty string on
    failure (invalid phone, etc.). When ``overwrite`` is False and the
    memo already exists, the new content is prepended and the previous
    memo is preserved below an HTML-comment marker so manual notes are
    never silently destroyed.
    """
    phone = _normalize_phone(phone)
    if not phone:
        logger.warning("write_memo: invalid phone, skipping")
        return ""

    try:
        MEMO_DIR.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("write_memo: cannot create %s: %s", MEMO_DIR, exc)
        return ""

    path = MEMO_DIR / f"{phone}.md"
    today = datetime.date.today().isoformat()
    schools = schools or []
    jobs = jobs or []
    prompts = prompts or []
    convo_lines = convo_lines or []

    existing = ""
    if path.exists() and not overwrite:
        try:
            existing = path.read_text().strip()
        except OSError as exc:
            logger.warning("memo read failed for %s: %s", path, exc)

    header = [f"# {name or 'Unknown'} ({source or 'unknown source'})"]
    if source:
        header.append(f"- **Source**: {source}")
    if age:
        header.append(f"- **Age**: {age}")
    if city:
        header.append(f"- **City**: {city}")
    if distance_mi != "" and distance_mi is not None:
        header.append(f"- **Distance**: {distance_mi} mi")
    if schools:
        header.append(f"- **School**: {', '.join(schools)}")
    if jobs:
        header.append(f"- **Job**: {', '.join(jobs)}")
    header.append(f"- **Phone handoff**: {today}")
    if her_comment:
        header.append(f"- **What she wrote when liking you**: {her_comment}")

    blocks = ["\n".join(header)]
    if prompts:
        blocks.append(
            "## Prompts\n"
            + "\n".join(
                f"- **{p.get('question', '?')}**: {p.get('answer', '?')}"
                for p in prompts
            )
        )
    if convo_lines:
        blocks.append(
            "## Dating-app convo snapshot (at handoff)\n"
            + "\n".join(f"- {ln}" for ln in convo_lines[-30:])
        )

    new_content = "\n\n".join(blocks) + "\n"

    try:
        if existing and not overwrite:
            merged = (
                f"<!-- auto-regenerated {today} -->\n"
                + new_content
                + "\n---\n\n<!-- previous memo -->\n"
                + existing
                + "\n"
            )
            path.write_text(merged)
        else:
            path.write_text(new_content)
    except OSError as exc:
        logger.warning("memo write failed for %s: %s", path, exc)
        return ""

    logger.info("memo written: %s", path)
    return str(path)
