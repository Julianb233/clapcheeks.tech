"""Tinder API client — talks to api.gotinder.com directly.

Two wire formats, both selectable via env:

  TINDER_WIRE_FORMAT=json        (default)
      Works today with an X-Auth-Token captured from the **Tinder web app**
      (Chrome DevTools → Network tab → any authenticated request → copy the
      X-Auth-Token header). No jailbreak, no Frida, no TLS pinning — the web
      client has none of those. This is the recommended path.

  TINDER_WIRE_FORMAT=protobuf
      For tokens captured from the iOS app. Needs `.proto` modules dropped
      into `clapcheeks/platforms/tinder_proto/` and the seams below
      (`_encode_like`, `_decode_recs`, …) implemented. Without those, any
      RPC raises `TinderProtobufNotConfigured`.

Env vars:
    TINDER_AUTH_TOKEN      — X-Auth-Token (required)
    TINDER_WIRE_FORMAT     — json | protobuf (default: json)
    TINDER_API_BASE        — override (default: https://api.gotinder.com)
    TINDER_APP_VERSION     — iOS build string (protobuf mode only)
    TINDER_PERSISTENT_ID   — persistent-device-id header (optional)
    TINDER_LOCALE          — locale query param (default: en-US)
"""
from __future__ import annotations

import logging
import os
import random
import time
from typing import Any

import requests

from clapcheeks.session.rate_limiter import (
    RateLimitExceeded,
    check_limit,
    record_swipe,
)

logger = logging.getLogger("clapcheeks.tinder_api")

DEFAULT_BASE = "https://api.gotinder.com"
DEFAULT_APP_VERSION = "14.26.0"
DEFAULT_LOCALE = "en-US"
REQUEST_TIMEOUT = 15
DAILY_LIKE_LIMIT = 100

WEB_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/123.0 Safari/537.36"
)
IOS_USER_AGENT = "Tinder/{v} (iPhone; iOS 17.4; Scale/3.00)"


class TinderAuthError(RuntimeError):
    """Raised when the X-Auth-Token is missing or rejected (401/403)."""


class TinderProtobufNotConfigured(RuntimeError):
    """Raised when protobuf mode is selected but the .proto modules are absent."""


class TinderAPIClient:
    """Tinder client for api.gotinder.com. Matches TinderClient's public API."""

    def __init__(
        self,
        driver: Any = None,
        token: str | None = None,
        base_url: str | None = None,
        wire_format: str | None = None,
    ) -> None:
        self.driver = driver  # ignored — here so the factory can pass it
        self.base_url = (base_url or os.environ.get("TINDER_API_BASE", DEFAULT_BASE)).rstrip("/")
        self.wire = (wire_format or os.environ.get("TINDER_WIRE_FORMAT", "json")).lower()
        if self.wire not in {"json", "protobuf"}:
            raise ValueError(f"TINDER_WIRE_FORMAT must be json|protobuf, got {self.wire!r}")

        self.token = token or os.environ.get("TINDER_AUTH_TOKEN") or ""
        if not self.token:
            raise TinderAuthError(
                "TINDER_AUTH_TOKEN not set. See docs/SETUP_TINDER_TOKEN.md."
            )

        self.locale = os.environ.get("TINDER_LOCALE", DEFAULT_LOCALE)

        self.session = requests.Session()
        self.session.headers.update(self._default_headers())

        self.liked = 0
        self.passed = 0
        self.errors = 0

    # ------------------------------------------------------------------
    # Headers
    # ------------------------------------------------------------------

    def _default_headers(self) -> dict[str, str]:
        if self.wire == "protobuf":
            app_version = os.environ.get("TINDER_APP_VERSION", DEFAULT_APP_VERSION)
            h = {
                "X-Auth-Token": self.token,
                "User-Agent": IOS_USER_AGENT.format(v=app_version),
                "app-version": app_version.replace(".", ""),
                "platform": "ios",
                "os-version": "17.4",
                "Accept": "application/x-protobuf",
                "Content-Type": "application/x-protobuf",
            }
        else:
            h = {
                "X-Auth-Token": self.token,
                "User-Agent": WEB_USER_AGENT,
                "Accept": "application/json",
                "Content-Type": "application/json",
                "platform": "web",
                "app-version": "1040000",
            }

        pid = os.environ.get("TINDER_PERSISTENT_ID")
        if pid:
            h["persistent-device-id"] = pid
        return h

    # ------------------------------------------------------------------
    # HTTP plumbing
    # ------------------------------------------------------------------

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json_body: Any = None,
        body_bytes: bytes | None = None,
        _retried: bool = False,
    ) -> requests.Response:
        url = path if path.startswith("http") else f"{self.base_url}{path}"

        kwargs: dict[str, Any] = {"timeout": REQUEST_TIMEOUT}
        if params:
            kwargs["params"] = params
        if json_body is not None:
            kwargs["json"] = json_body
        elif body_bytes is not None:
            kwargs["data"] = body_bytes

        try:
            resp = self.session.request(method, url, **kwargs)
        except requests.RequestException as exc:
            self.errors += 1
            raise RuntimeError(f"Tinder request failed: {exc}") from exc

        if resp.status_code in (401, 403):
            if not _retried and self._try_browser_refresh():
                self.session.headers.update(self._default_headers())
                return self._request(
                    method, path,
                    params=params, json_body=json_body, body_bytes=body_bytes,
                    _retried=True,
                )
            raise TinderAuthError(
                f"{resp.status_code} from Tinder API. Token rejected and "
                f"browser auto-refresh did not recover. Run "
                f"`clapcheeks refresh-tinder-token` or re-capture manually."
            )
        if resp.status_code == 429:
            retry_after = resp.headers.get("Retry-After", "?")
            raise RateLimitExceeded("tinder", -1, -1)  # signals rate limit
        if resp.status_code >= 400:
            self.errors += 1
            raise RuntimeError(
                f"Tinder {method} {path} -> {resp.status_code}: "
                f"{(resp.text or resp.content)[:200]!r}"
            )
        return resp

    # ------------------------------------------------------------------
    # 401/403 auto-refresh via Browserbase + SMS
    # ------------------------------------------------------------------

    def _try_browser_refresh(self) -> bool:
        """Token refresh strategies, tried in order. All zero-cost by default.

        1. Supabase ingest — the Chrome extension posts tokens to
           clapcheeks.tech; the sync loop pulls them here. This is the
           canonical path.
        2. Local Mac Chrome (AppleScript/CDP) on the Mac running the daemon.
        3. Browserbase cloud fallback — only when CLAPCHEEKS_ENABLE_BROWSERBASE=1
           AND CLAPCHEEKS_TINDER_PHONE is set. Paid, rarely needed.
        """
        # Strategy 1: extension-fed token in Supabase
        try:
            from clapcheeks.sync import pull_platform_tokens
            if pull_platform_tokens() > 0:
                self.token = os.environ.get("TINDER_AUTH_TOKEN", self.token)
                logger.info("Tinder token refreshed from Supabase (extension push).")
                return True
        except Exception as exc:
            logger.debug("Supabase token pull failed: %s", exc)

        # Strategy 2: local Chrome on same Mac as daemon
        try:
            from clapcheeks.platforms.tinder_local import (
                refresh_token as local_refresh, TinderLocalAuthFailed,
            )
            result = local_refresh()
            self.token = result["token"]
            logger.info("Tinder local Chrome refresh succeeded.")
            return True
        except TinderLocalAuthFailed as exc:
            logger.info("Local Chrome refresh unavailable (%s).", exc)
        except Exception as exc:
            logger.warning("Local Chrome refresh errored: %s", exc)

        # Strategy 3: Browserbase — explicit opt-in only
        if os.environ.get("CLAPCHEEKS_ENABLE_BROWSERBASE", "") != "1":
            logger.info(
                "Browserbase disabled (set CLAPCHEEKS_ENABLE_BROWSERBASE=1 to enable)."
            )
            return False
        if not os.environ.get("CLAPCHEEKS_TINDER_PHONE", "").strip():
            return False
        try:
            from clapcheeks.platforms.tinder_auth import refresh_token as bb_refresh
            result = bb_refresh()
        except Exception as exc:
            logger.warning("Tinder Browserbase refresh failed: %s", exc)
            return False
        self.token = result["token"]
        logger.info("Tinder Browserbase refresh succeeded.")
        return True

    def _get_json(self, path: str, params: dict | None = None) -> dict:
        resp = self._request("GET", path, params=params)
        try:
            return resp.json() if resp.content else {}
        except ValueError:
            return {}

    def _post_json(self, path: str, body: dict, params: dict | None = None) -> dict:
        resp = self._request("POST", path, json_body=body, params=params)
        try:
            return resp.json() if resp.content else {}
        except ValueError:
            return {}

    # ------------------------------------------------------------------
    # Protobuf seams (only used when wire == "protobuf")
    # ------------------------------------------------------------------

    def _encode_like(self, rec_id: str, s_number: int | None = None) -> bytes:
        raise TinderProtobufNotConfigured(
            "Drop generated protobuf modules into clapcheeks/platforms/tinder_proto/ "
            "and implement _encode_like(). See docs/SETUP_TINDER_TOKEN.md."
        )

    def _encode_pass(self, rec_id: str, s_number: int | None = None) -> bytes:
        raise TinderProtobufNotConfigured("Implement _encode_pass()")

    def _decode_recs(self, body: bytes) -> list[dict]:
        raise TinderProtobufNotConfigured("Implement _decode_recs()")

    def _decode_match(self, body: bytes) -> dict | None:
        raise TinderProtobufNotConfigured("Implement _decode_match()")

    def _encode_message(self, match_id: str, text: str) -> bytes:
        raise TinderProtobufNotConfigured("Implement _encode_message()")

    def _decode_matches_list(self, body: bytes) -> list[dict]:
        raise TinderProtobufNotConfigured("Implement _decode_matches_list()")

    # ------------------------------------------------------------------
    # Public API — parity with TinderClient (browser)
    # ------------------------------------------------------------------

    def login(self) -> bool:
        """Probe the token with a cheap authenticated call."""
        try:
            if self.wire == "json":
                self._get_json("/v2/profile", params={"locale": self.locale})
            else:
                self._request("GET", "/v2/profile")
            logger.info("Tinder API login OK (%s wire).", self.wire)
            return True
        except TinderAuthError:
            raise
        except Exception as exc:
            logger.warning("Tinder login probe failed: %s", exc)
            return False

    # ---- recs -----------------------------------------------------------

    def _fetch_recs(self) -> list[dict]:
        if self.wire == "protobuf":
            resp = self._request("GET", "/v2/recs/core")
            return self._decode_recs(resp.content)
        data = self._get_json("/v2/recs/core", params={"locale": self.locale})
        # Current JSON shape: { "data": { "results": [...] }, "meta": {...} }
        results = (data.get("data") or {}).get("results") or []
        return [self._normalize_rec_json(r) for r in results]

    @staticmethod
    def _normalize_rec_json(raw: dict) -> dict:
        user = raw.get("user") or {}
        photos: list[str] = []
        for p in user.get("photos") or []:
            url = p.get("url") or (p.get("processedFiles") or [{}])[0].get("url")
            if url:
                photos.append(url)
        return {
            "rec_id": user.get("_id") or raw.get("_id"),
            "name": user.get("name"),
            "age": _calc_age(user.get("birth_date")),
            "bio": user.get("bio"),
            "photos": photos,
            "s_number": raw.get("s_number"),
            "raw": raw,
        }

    # ---- rate (like / pass / super) -------------------------------------

    def _like(self, rec: dict) -> dict | None:
        rec_id = rec["rec_id"]
        s_num = rec.get("s_number")

        if self.wire == "protobuf":
            body = self._encode_like(rec_id, s_num)
            resp = self._request("POST", f"/like/{rec_id}", body_bytes=body)
            self.liked += 1
            return self._decode_match(resp.content)

        # JSON: /like/{id} is a GET with optional s_number query param
        params = {"locale": self.locale}
        if s_num is not None:
            params["s_number"] = str(s_num)
        data = self._get_json(f"/like/{rec_id}", params=params)
        self.liked += 1

        if data.get("match"):
            match = data.get("match")
            match_id = match.get("_id") if isinstance(match, dict) else None
            return {
                "name": rec.get("name", "Unknown"),
                "match_id": match_id,
                "opener": "",
            }
        return None

    def _pass(self, rec: dict) -> None:
        rec_id = rec["rec_id"]
        s_num = rec.get("s_number")

        if self.wire == "protobuf":
            body = self._encode_pass(rec_id, s_num)
            self._request("POST", f"/pass/{rec_id}", body_bytes=body)
        else:
            params = {"locale": self.locale}
            if s_num is not None:
                params["s_number"] = str(s_num)
            self._get_json(f"/pass/{rec_id}", params=params)
        self.passed += 1

    # ---- swipe session --------------------------------------------------

    def run_swipe_session(
        self,
        like_ratio: float = 0.5,
        max_swipes: int = 30,
    ) -> dict:
        if not self.login():
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        try:
            check_limit("tinder", "swipe")
        except RateLimitExceeded as exc:
            logger.warning("%s", exc)
            return {
                "liked": self.liked, "passed": self.passed,
                "errors": self.errors, "new_matches": [],
            }

        try:
            recs = self._fetch_recs()
        except TinderProtobufNotConfigured:
            logger.error("Tinder protobuf not wired — drop .proto modules or switch to json wire.")
            raise
        except Exception as exc:
            logger.error("Tinder recs fetch failed: %s", exc)
            return {
                "liked": self.liked, "passed": self.passed,
                "errors": self.errors + 1, "new_matches": [],
            }

        new_matches: list[dict] = []
        effective_max = min(max_swipes, len(recs), DAILY_LIKE_LIMIT)

        for idx in range(effective_max):
            rec = recs[idx]
            try:
                if random.random() < like_ratio:
                    match = self._like(rec)
                    record_swipe("tinder", "right")
                    if match:
                        new_matches.append(match)
                else:
                    self._pass(rec)
                    record_swipe("tinder", "left")
                time.sleep(random.uniform(0.8, 2.6))
            except TinderAuthError:
                raise
            except Exception as exc:
                logger.warning("Tinder swipe %d failed: %s", idx, exc)
                self.errors += 1

        return {
            "liked": self.liked,
            "passed": self.passed,
            "errors": self.errors,
            "new_matches": new_matches,
        }

    # ---- matches + messaging -------------------------------------------

    def check_new_matches(self) -> list[dict]:
        try:
            matches = self.get_matches(count=30)
        except Exception as exc:
            logger.debug("check_new_matches failed: %s", exc)
            return []
        out: list[dict] = []
        for m in matches:
            if m.get("has_messages") or m.get("hasMessages"):
                continue
            name = ""
            person = m.get("person") or {}
            if isinstance(person, dict):
                name = person.get("name", "")
            out.append({
                "match_id": m.get("_id") or m.get("id") or m.get("matchId"),
                "name": name,
            })
        return out

    def send_message(self, match_id: str, message: str) -> bool:
        try:
            if self.wire == "protobuf":
                body = self._encode_message(match_id, message)
                self._request("POST", f"/user/matches/{match_id}", body_bytes=body)
            else:
                self._post_json(f"/user/matches/{match_id}", {"message": message})
            return True
        except Exception as exc:
            logger.error("Tinder send_message failed: %s", exc)
            return False

    def get_matches(self, count: int = 20) -> list[dict]:
        try:
            if self.wire == "protobuf":
                resp = self._request("GET", "/v2/matches", params={"count": count})
                return self._decode_matches_list(resp.content)[:count]
            data = self._get_json(
                "/v2/matches",
                params={"count": count, "locale": self.locale, "message": 0},
            )
            matches = (data.get("data") or {}).get("matches") or []
            return matches[:count]
        except Exception as exc:
            logger.debug("get_matches failed: %s", exc)
            return []


def _calc_age(birth_date: str | None) -> int | None:
    """Convert an ISO birth_date into an integer age; None on failure."""
    if not birth_date:
        return None
    try:
        from datetime import datetime, timezone
        dt = datetime.fromisoformat(birth_date.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        age = now.year - dt.year - (
            (now.month, now.day) < (dt.month, dt.day)
        )
        return age
    except Exception:
        return None
