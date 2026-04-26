"""mitmproxy addon — passively harvest BOTH Hinge + Tinder auth tokens
from iPhone traffic in one place.

Replaces mitm_hinge.py. Same flow:
    1. iPhone Wi-Fi proxy points at Mac Mini :8080
    2. Hinge or Tinder makes an API request → we see the auth header
    3. POST to clapcheeks.tech/api/ingest/platform-token
    4. Extension daemon picks it up on next sync tick

Header conventions per platform:
    Hinge   : Authorization: Bearer <jwt>     host: *.hingeaws.net | *.hinge.co
    Tinder  : X-Auth-Token: <uuid>            host: api.gotinder.com

Env vars (set in launchd plist):
    CLAPCHEEKS_DEVICE_TOKEN — same token used by chrome extension
    CLAPCHEEKS_INGEST_URL   — defaults to https://clapcheeks.tech/api/ingest/platform-token
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

import requests
from mitmproxy import ctx, http

log = logging.getLogger("clapcheeks.mitm_dating")

INGEST_URL = os.environ.get(
    "CLAPCHEEKS_INGEST_URL",
    "https://clapcheeks.tech/api/ingest/platform-token",
)
DEVICE_TOKEN = os.environ.get("CLAPCHEEKS_DEVICE_TOKEN", "").strip()
DEVICE_NAME = os.environ.get("CLAPCHEEKS_DEVICE_NAME", "iphone-mitm")

_HINGE_HOST_RE = re.compile(r"(^|\.)hingeaws\.net$|(^|\.)hinge\.co$", re.IGNORECASE)
_TINDER_HOST_RE = re.compile(r"(^|\.)gotinder\.com$|(^|\.)tinder\.com$", re.IGNORECASE)

# Per-platform last-seen state for dedup. We see many requests per minute
# while the user is active; only upload one fresh token per platform per 60s.
_state: dict[str, dict] = {
    "hinge": {"last_token": None, "last_at": 0.0},
    "tinder": {"last_token": None, "last_at": 0.0},
}


def _extract(flow: http.HTTPFlow) -> tuple[str, str] | None:
    """Return (platform, token) if this flow carries an auth credential we
    care about, else None."""
    host = (flow.request.pretty_host or "").lower()
    if _HINGE_HOST_RE.search(host):
        auth = flow.request.headers.get("Authorization", "")
        if auth.lower().startswith("bearer "):
            tok = auth.split(" ", 1)[1].strip()
            if len(tok) >= 20:
                return ("hinge", tok)
    if _TINDER_HOST_RE.search(host):
        # Tinder iOS sends X-Auth-Token; tinder.com web also uses it
        tok = flow.request.headers.get("X-Auth-Token", "").strip()
        if len(tok) >= 20:
            return ("tinder", tok)
        # fall through — some endpoints sign with Authorization: Token …
        auth = flow.request.headers.get("Authorization", "")
        if auth.lower().startswith("token "):
            tok = auth.split(" ", 1)[1].strip()
            if len(tok) >= 20:
                return ("tinder", tok)
    return None


def request(flow: http.HTTPFlow) -> None:
    """mitmproxy hook — fires on every outbound HTTP/HTTPS request."""
    if not DEVICE_TOKEN:
        return
    try:
        hit = _extract(flow)
        if not hit:
            return
        platform, token = hit
        st = _state[platform]
        now = time.time()
        if st["last_token"] == token and now - st["last_at"] < 60:
            return  # dedup
        _upload(platform, token, flow.request.pretty_url)
    except Exception as exc:  # noqa: BLE001
        log.warning("mitm_dating request hook failed: %s", exc)


def _upload(platform: str, token: str, url: str) -> None:
    try:
        resp = requests.post(
            INGEST_URL,
            headers={
                "Content-Type": "application/json",
                "X-Device-Token": DEVICE_TOKEN,
                "X-Device-Name": DEVICE_NAME,
            },
            json={
                "platform": platform,
                "token": token,
                "storage_key": "iphone-proxy",
                "at": int(time.time() * 1000),
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        log.warning("ingest POST network error (%s): %s", platform, exc)
        return

    if 200 <= resp.status_code < 300:
        _state[platform]["last_token"] = token
        _state[platform]["last_at"] = time.time()
        ctx.log.info(
            f"mitm_dating: harvested {platform} token from {url[:80]} "
            f"(len={len(token)})"
        )
    else:
        log.warning(
            "ingest rejected (%s): %d %s",
            platform, resp.status_code, resp.text[:200],
        )


def load(loader: Any) -> None:  # noqa: ARG001
    ctx.log.info("mitm_dating addon loaded — capturing Hinge + Tinder.")
    if not DEVICE_TOKEN:
        ctx.log.error(
            "CLAPCHEEKS_DEVICE_TOKEN not set — addon is a no-op. "
            "Set it in the mitmdump launchd plist."
        )
