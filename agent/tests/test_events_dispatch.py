"""EventEmitter dispatch tests (AI-8772).

Verifies that:
- The legacy /events/agent log is hit for every event.
- Notifiable events also POST to /api/notify with X-Device-Token + the
  expected body shape.
- Non-notifiable events (e.g. opener_sent, reply_sent) DO NOT hit the
  notify dispatcher.
- The notify URL is derived from api_url correctly for prod, dev, and
  the explicit env override.
"""
from __future__ import annotations

import os
import time
from unittest.mock import patch, MagicMock

from clapcheeks import events as events_mod
from clapcheeks.events import EventEmitter, _derive_notify_url


# ---------------------------------------------------------------------------
# URL derivation
# ---------------------------------------------------------------------------

class TestDeriveNotifyUrl:
    def test_prod_api_root(self):
        assert (
            _derive_notify_url("https://api.clapcheeks.tech")
            == "https://clapcheeks.tech/api/notify"
        )

    def test_prod_api_root_with_trailing_slash(self):
        assert (
            _derive_notify_url("https://api.clapcheeks.tech/")
            == "https://clapcheeks.tech/api/notify"
        )

    def test_localhost_with_api_segment(self):
        assert (
            _derive_notify_url("http://localhost:3001/api")
            == "http://localhost:3001/api/notify"
        )

    def test_env_override_wins(self):
        with patch.dict(
            os.environ, {"CLAPCHEEKS_NOTIFY_URL": "https://staging.example.com/api/notify"}
        ):
            assert (
                _derive_notify_url("https://api.clapcheeks.tech")
                == "https://staging.example.com/api/notify"
            )


# ---------------------------------------------------------------------------
# Helper: capture all _post / _post_notify calls without spawning threads.
# ---------------------------------------------------------------------------

def _capture_posts():
    """Returns (legacy_calls, notify_calls) lists patched into the module."""
    legacy_calls: list[dict] = []
    notify_calls: list[dict] = []

    def fake_post(url, token, payload):
        legacy_calls.append({"url": url, "token": token, "payload": payload})

    def fake_post_notify(notify_url, token, user_id, event_type, payload):
        notify_calls.append({
            "notify_url": notify_url,
            "token": token,
            "user_id": user_id,
            "event_type": event_type,
            "payload": payload,
        })

    return legacy_calls, notify_calls, fake_post, fake_post_notify


# ---------------------------------------------------------------------------
# Notifiable events fan out to BOTH the legacy log AND the dispatcher
# ---------------------------------------------------------------------------

class TestNotifiableEvents:
    def setup_method(self):
        self.emitter = EventEmitter(
            "https://api.clapcheeks.tech",
            agent_token="tok-abc",
            user_id="user-123",
        )

    def test_date_booked_hits_both(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.date_booked("hinge", "Sam", "Fri 7pm")
        assert len(legacy) == 1
        assert legacy[0]["payload"]["event"] == "date_booked"
        assert legacy[0]["payload"]["data"]["match_name"] == "Sam"
        assert len(notify) == 1
        assert notify[0]["event_type"] == "date_booked"
        assert notify[0]["user_id"] == "user-123"
        assert notify[0]["token"] == "tok-abc"
        assert notify[0]["notify_url"] == "https://clapcheeks.tech/api/notify"
        assert notify[0]["payload"]["platform"] == "hinge"
        assert notify[0]["payload"]["slot"] == "Fri 7pm"

    def test_ban_detected_hits_both(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.ban_detected("tinder", "soft_ban")
        assert len(legacy) == 1 and len(notify) == 1
        assert notify[0]["event_type"] == "ban_detected"
        assert notify[0]["payload"]["ban_type"] == "soft_ban"

    def test_match_received_uses_new_match_for_notify(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.match_received("hinge", "Alex")
        assert len(legacy) == 1
        assert legacy[0]["payload"]["event"] == "match_received"
        assert len(notify) == 1
        assert notify[0]["event_type"] == "new_match"
        assert notify[0]["payload"] == {"platform": "hinge", "match_name": "Alex"}

    def test_draft_queued_hits_both(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.draft_queued("bumble", "Jordan", reason="low_confidence")
        assert len(notify) == 1
        assert notify[0]["event_type"] == "draft_queued"
        assert notify[0]["payload"]["reason"] == "low_confidence"

    def test_token_expiring_hits_both(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.token_expiring_soon("hinge", hours_left=12)
        assert len(notify) == 1
        assert notify[0]["event_type"] == "token_expiring"
        assert notify[0]["payload"]["hours_left"] == 12


# ---------------------------------------------------------------------------
# Non-notifiable events: legacy log only
# ---------------------------------------------------------------------------

class TestNonNotifiableEvents:
    def setup_method(self):
        self.emitter = EventEmitter("https://api.clapcheeks.tech", "tok", "user-1")

    def test_opener_sent_no_notify(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.opener_sent("hinge", "Sam", "hey")
        assert len(legacy) == 1
        assert len(notify) == 0

    def test_reply_sent_no_notify(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.reply_sent("hinge", "Sam", "replying")
        assert len(legacy) == 1
        assert len(notify) == 0

    def test_session_complete_no_notify(self):
        legacy, notify, fp, fpn = _capture_posts()
        with patch.object(events_mod, "_post", fp), patch.object(
            events_mod, "_post_notify", fpn
        ):
            self.emitter.session_complete("hinge", {"swiped": 50, "matches": 3})
        assert len(legacy) == 1
        assert len(notify) == 0


# ---------------------------------------------------------------------------
# End-to-end: requests.post is reached with the expected payload shape.
# ---------------------------------------------------------------------------

class TestRequestsIntegration:
    def test_post_notify_calls_requests_with_correct_shape(self):
        captured: list[dict] = []

        def fake_post(url, json=None, headers=None, timeout=None, **_kwargs):
            captured.append({"url": url, "json": json, "headers": headers, "timeout": timeout})
            return MagicMock(status_code=200)

        with patch.object(events_mod, "_post", lambda *a, **kw: None):
            with patch("requests.post", fake_post):
                emitter = EventEmitter(
                    "https://api.clapcheeks.tech",
                    agent_token="tok-xyz",
                    user_id="user-99",
                )
                emitter.date_booked("hinge", "Sam", "Sat 8pm")
                deadline = time.time() + 2
                while time.time() < deadline and not captured:
                    time.sleep(0.05)

        assert len(captured) == 1
        c = captured[0]
        assert c["url"] == "https://clapcheeks.tech/api/notify"
        assert c["headers"]["X-Device-Token"] == "tok-xyz"
        assert c["headers"]["Content-Type"] == "application/json"
        assert c["json"]["event_type"] == "date_booked"
        assert c["json"]["target_user_id"] == "user-99"
        assert c["json"]["payload"]["platform"] == "hinge"
        assert c["json"]["payload"]["match_name"] == "Sam"
        assert c["json"]["payload"]["slot"] == "Sat 8pm"
        assert c["timeout"] == 5
