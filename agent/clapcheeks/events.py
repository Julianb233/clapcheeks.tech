"""Event emitter — fire-and-forget POSTs to the API for key agent events.

Events:
  match_received    — new match detected on a platform
  opener_sent       — opener message successfully sent
  reply_sent        — reply sent in conversation
  date_booked       — date booked in calendar
  ban_detected      — platform auto-paused due to ban signal
  session_complete  — swipe session finished (with stats)
  draft_queued      — low-confidence draft parked for operator review
  token_expiring_soon — platform session token nearing expiry

All calls are non-blocking (threaded) and fail silently.

AI-8772: in addition to the legacy /events/agent log, push-notification-
worthy events fan out to /api/notify so the operator gets email /
iMessage / web push depending on their prefs.
"""
from __future__ import annotations
import logging
import os
import threading
from datetime import datetime

logger = logging.getLogger(__name__)

# Events the operator can be paged on. Anything else only logs.
NOTIFIABLE_EVENTS = {
    "date_booked",
    "ban_detected",
    "new_match",
    "draft_queued",
    "token_expiring",
}


def _post(url: str, token: str, payload: dict) -> None:
    """Fire-and-forget POST in background thread."""
    def _send():
        try:
            import requests
            requests.post(url, json=payload,
                         headers={"Authorization": f"Bearer {token}"},
                         timeout=5)
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()


def _post_notify(notify_url: str, token: str, user_id: str | None,
                 event_type: str, payload: dict) -> None:
    """Fire-and-forget POST to /api/notify (AI-8772).

    Uses the X-Device-Token header that the rest of the agent uses for
    next-job / ingest endpoints.
    """
    def _send():
        try:
            import requests
            body: dict = {"event_type": event_type, "payload": payload}
            if user_id:
                body["target_user_id"] = user_id
            requests.post(
                notify_url,
                json=body,
                headers={
                    "Content-Type": "application/json",
                    "X-Device-Token": token,
                },
                timeout=5,
            )
        except Exception:
            pass
    threading.Thread(target=_send, daemon=True).start()


def _derive_notify_url(api_url: str) -> str:
    """Map api.clapcheeks.tech / localhost api roots to the web /api/notify.

    The agent stores `api_url` like `https://api.clapcheeks.tech` for the
    legacy events endpoint. The notify dispatcher lives on the web app
    (Next.js routes) at `https://clapcheeks.tech/api/notify`. Translate
    here so callers don't have to plumb a separate URL through config.
    """
    override = os.environ.get("CLAPCHEEKS_NOTIFY_URL")
    if override:
        return override.rstrip("/")
    base = api_url.rstrip("/")
    if base.startswith("https://api.clapcheeks.tech"):
        return "https://clapcheeks.tech/api/notify"
    if base.startswith("http://api.clapcheeks.tech"):
        return "http://clapcheeks.tech/api/notify"
    # Localhost / staging — assume the web app is on the same host root.
    if "/api" in base:
        return base.rsplit("/api", 1)[0] + "/api/notify"
    return base + "/api/notify"


class EventEmitter:
    def __init__(self, api_url: str, agent_token: str, user_id: str | None = None):
        self.api_url = api_url.rstrip("/")
        self.token = agent_token
        self.user_id = user_id
        self.notify_url = _derive_notify_url(api_url)

    def _emit(self, event_type: str, data: dict) -> None:
        # Legacy log endpoint (/events/agent).
        _post(f"{self.api_url}/events/agent",
              self.token,
              {"event": event_type, "data": data, "ts": datetime.utcnow().isoformat()})
        # New: operator-facing notification dispatcher.
        if event_type in NOTIFIABLE_EVENTS:
            _post_notify(self.notify_url, self.token, self.user_id,
                         event_type, data)

    def match_received(self, platform: str, match_name: str) -> None:
        # Legacy event id was 'match_received'; the notification matrix
        # in the UI calls it 'new_match' for clarity. Emit the legacy log
        # AND the notifier event so both surfaces stay in sync.
        self._emit("match_received",
                   {"platform": platform, "match_name": match_name})
        if "new_match" in NOTIFIABLE_EVENTS:
            _post_notify(self.notify_url, self.token, self.user_id,
                         "new_match",
                         {"platform": platform, "match_name": match_name})

    def opener_sent(self, platform: str, match_name: str, opener: str) -> None:
        self._emit("opener_sent", {"platform": platform, "match_name": match_name, "opener": opener})

    def reply_sent(self, platform: str, match_name: str, stage: str) -> None:
        self._emit("reply_sent", {"platform": platform, "match_name": match_name, "stage": stage})

    def date_booked(self, platform: str, match_name: str, slot: str) -> None:
        self._emit("date_booked", {"platform": platform, "match_name": match_name, "slot": slot})

    def ban_detected(self, platform: str, ban_type: str) -> None:
        self._emit("ban_detected", {"platform": platform, "ban_type": ban_type})

    def session_complete(self, platform: str, stats: dict) -> None:
        self._emit("session_complete", {"platform": platform, **stats})

    def draft_queued(self, platform: str, match_name: str, reason: str = "") -> None:
        """Low-confidence draft parked for operator review."""
        self._emit("draft_queued",
                   {"platform": platform, "match_name": match_name, "reason": reason})

    def token_expiring_soon(self, platform: str, hours_left: int = 0) -> None:
        """Platform session token is nearing expiry — operator must reauth."""
        self._emit("token_expiring",
                   {"platform": platform, "hours_left": hours_left})
