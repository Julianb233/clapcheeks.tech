"""Event emitter — fire-and-forget POSTs to the API for key agent events.

Events:
  match_received    — new match detected on a platform
  opener_sent       — opener message successfully sent
  reply_sent        — reply sent in conversation
  date_booked       — date booked in calendar
  ban_detected      — platform auto-paused due to ban signal
  session_complete  — swipe session finished (with stats)

All calls are non-blocking (threaded) and fail silently.
"""
from __future__ import annotations
import logging
import threading
from datetime import datetime

logger = logging.getLogger(__name__)


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


class EventEmitter:
    def __init__(self, api_url: str, agent_token: str):
        self.api_url = api_url.rstrip("/")
        self.token = agent_token

    def _emit(self, event_type: str, data: dict) -> None:
        _post(f"{self.api_url}/events/agent",
              self.token,
              {"event": event_type, "data": data, "ts": datetime.utcnow().isoformat()})

    def match_received(self, platform: str, match_name: str) -> None:
        self._emit("match_received", {"platform": platform, "match_name": match_name})

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
