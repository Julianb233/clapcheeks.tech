"""mitmproxy addon — passively harvest Hinge auth tokens from iPhone traffic.

Flow:
    1. Your iPhone Wi-Fi proxy points at this Mac on :8080.
    2. Any time Hinge makes an API request to prod-api.hingeaws.net, we
       see the Authorization: Bearer header here.
    3. We POST the token to clapcheeks.tech/api/ingest/platform-token
       using the same device token as the Chrome extension.
    4. The Mac Mini's clapcheeks daemon pulls the fresh token from
       Supabase on its next sync tick and writes it to .env.

No captcha. No login flow replication. Zero weekly work for you after
the iPhone proxy + cert setup is done once.

Run with:
    mitmdump -s clapcheeks/addons/mitm_hinge.py --listen-port 8080

Env vars required:
    CLAPCHEEKS_DEVICE_TOKEN — same token you paste in the Chrome extension.
    CLAPCHEEKS_INGEST_URL   — override for local testing. Defaults to
                              https://clapcheeks.tech/api/ingest/platform-token
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any

import requests

from mitmproxy import ctx, http

log = logging.getLogger("clapcheeks.mitm_hinge")

INGEST_URL = os.environ.get(
    "CLAPCHEEKS_INGEST_URL",
    "https://clapcheeks.tech/api/ingest/platform-token",
)
DEVICE_TOKEN = os.environ.get("CLAPCHEEKS_DEVICE_TOKEN", "").strip()
DEVICE_NAME = os.environ.get("CLAPCHEEKS_DEVICE_NAME", "iphone-mitm")

# Rate limit uploads. We see many requests per minute when Hinge is
# active; we only care about the first token we see each 60s.
_last_upload_at = 0.0
_last_token_sent: str | None = None


# Match any Hinge-ish host. Covers current prod, and historical variants
# like stage-api.hingeaws.net.
_HOST_RE = re.compile(r"(^|\.)hingeaws\.net$|(^|\.)hinge\.co$", re.IGNORECASE)


def request(flow: http.HTTPFlow) -> None:
    """mitmproxy hook: called on every request."""
    if not DEVICE_TOKEN:
        return
    try:
        host = (flow.request.pretty_host or "").lower()
        if not _HOST_RE.search(host):
            return
        auth = flow.request.headers.get("Authorization", "")
        if not auth.lower().startswith("bearer "):
            return
        token = auth.split(" ", 1)[1].strip()
        if not token or len(token) < 20:
            return
        _maybe_upload(token, flow.request.pretty_url)
    except Exception as exc:
        log.warning("mitm_hinge: request hook failed: %s", exc)


def _maybe_upload(token: str, url: str) -> None:
    global _last_upload_at, _last_token_sent
    now = time.time()
    if token == _last_token_sent and now - _last_upload_at < 60:
        return  # dedup
    try:
        resp = requests.post(
            INGEST_URL,
            headers={
                "Content-Type": "application/json",
                "X-Device-Token": DEVICE_TOKEN,
                "X-Device-Name": DEVICE_NAME,
            },
            json={
                "platform": "hinge",
                "token": token,
                "storage_key": "iphone-proxy",
                "at": int(now * 1000),
            },
            timeout=10,
        )
    except requests.RequestException as exc:
        log.warning("ingest POST network error: %s", exc)
        return

    if resp.status_code // 100 == 2:
        _last_upload_at = now
        _last_token_sent = token
        ctx.log.info(
            f"mitm_hinge: harvested token from {url[:80]} (len={len(token)})"
        )
    else:
        log.warning(
            "ingest rejected: %d %s",
            resp.status_code, resp.text[:120],
        )


def load(loader: Any) -> None:
    """Called once by mitmdump on startup."""
    ctx.log.info("mitm_hinge addon loaded.")
    if not DEVICE_TOKEN:
        ctx.log.error(
            "CLAPCHEEKS_DEVICE_TOKEN not set — addon will be a no-op. "
            "Export it in the mitmdump launchd plist."
        )
        return
    ctx.log.info(
        f"Harvesting Hinge tokens -> {INGEST_URL} (device={DEVICE_NAME})"
    )


def running() -> None:
    """Called after mitmproxy is up and listening."""
    ctx.log.info("mitm_hinge addon running. Waiting for Hinge traffic...")
