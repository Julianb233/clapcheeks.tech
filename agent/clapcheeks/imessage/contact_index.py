"""Fleet contact index — maps phone/email to a client slug so BlueBubbles
webhook payloads are routed to the right `fleet-shared/inbox/<slug>/`.

Canonical file (read by .fleet-config/services/bluebubbles-webhook/server.js):
    /opt/agency-workspace/fleet-shared/clients/contact-index.json

Key normalization mirrors the webhook server exactly:
    key = address.lower().replace(/[^\d+@.a-z]/g, "")
so we normalize the same way here when writing, to avoid stale duplicates.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger("clapcheeks.imessage.contact_index")

CONTACT_INDEX_PATH = Path(
    "/opt/agency-workspace/fleet-shared/clients/contact-index.json"
)

_NORMALIZE_STRIP = re.compile(r"[^\d+@.a-z]")


def normalize_key(address: str) -> str:
    return _NORMALIZE_STRIP.sub("", (address or "").lower())


def load() -> dict[str, str]:
    if not CONTACT_INDEX_PATH.exists():
        return {}
    try:
        return json.loads(CONTACT_INDEX_PATH.read_text()) or {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("contact-index unreadable (%s); treating as empty", exc)
        return {}


def save(index: dict[str, str]) -> None:
    CONTACT_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = CONTACT_INDEX_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n")
    tmp.replace(CONTACT_INDEX_PATH)


def register(address: str, slug: str) -> tuple[str, str | None]:
    """Map `address` → `slug`. Returns (normalized_key, previous_slug_or_None)."""
    key = normalize_key(address)
    if not key:
        raise ValueError(f"refusing to register empty/unparseable address: {address!r}")
    index = load()
    prev = index.get(key)
    index[key] = slug
    save(index)
    return key, prev


def unregister(address: str) -> str | None:
    key = normalize_key(address)
    index = load()
    prev = index.pop(key, None)
    if prev is not None:
        save(index)
    return prev


__all__ = ["CONTACT_INDEX_PATH", "normalize_key", "load", "save", "register", "unregister"]
