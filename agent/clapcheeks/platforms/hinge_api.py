"""Hinge iPhone-API client — uses prod-api.hingeaws.net directly.

Mirrors the HingeClient (browser) public interface so callers don't change.
Auth is a Bearer token captured from the iOS app via Charles / HTTP Toolkit
(see docs/SETUP_HINGE_TOKEN.md). Hinge does not pin TLS certs, so capture
works on a non-jailbroken iPhone with no Frida.

Env vars this client reads:
    HINGE_AUTH_TOKEN    — Bearer token (required)
    HINGE_INSTALL_ID    — install id header (optional but recommended)
    HINGE_SESSION_ID    — session id header (optional)
    HINGE_DEVICE_ID     — device id header (optional)
    HINGE_API_BASE      — override base URL (default: https://prod-api.hingeaws.net)
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

logger = logging.getLogger("clapcheeks.hinge_api")

DEFAULT_BASE = "https://prod-api.hingeaws.net"
DAILY_LIKE_LIMIT = 50
REQUEST_TIMEOUT = 15

_SYSTEM_PROMPT = (
    "You are a witty, charming person on a dating app. Write a short comment "
    "(1-2 sentences max) responding to someone's Hinge prompt. Be genuine, "
    "playful, and specific to what they wrote. Never be generic, creepy, or "
    "use pickup lines. Match the energy of what they wrote."
)
_STRICT_SUFFIX = " Keep it to ONE sentence, no emojis."


class HingeAuthError(RuntimeError):
    """Raised when the Hinge bearer token is missing, invalid, or expired."""


class HingeAPIClient:
    """Hinge client that talks to prod-api.hingeaws.net directly.

    Public surface matches the Playwright-based HingeClient so the factory
    can swap one for the other without touching call sites.

    The `driver` argument is accepted and ignored — it exists so the factory
    can pass the same kwargs to either backend.
    """

    def __init__(
        self,
        driver: Any = None,
        ai_service_url: str | None = None,
        token: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self.driver = driver  # ignored
        self.ai_service_url = ai_service_url
        self.base_url = (base_url or os.environ.get("HINGE_API_BASE", DEFAULT_BASE)).rstrip("/")

        self.token = token or os.environ.get("HINGE_AUTH_TOKEN") or ""
        if not self.token:
            raise HingeAuthError(
                "HINGE_AUTH_TOKEN not set. See docs/SETUP_HINGE_TOKEN.md for capture."
            )

        self.session = requests.Session()
        self.session.headers.update(self._default_headers())

        self.liked = 0
        self.passed = 0
        self.errors = 0
        self.commented = 0

    # ------------------------------------------------------------------
    # HTTP plumbing
    # ------------------------------------------------------------------

    def _default_headers(self) -> dict[str, str]:
        # Hinge's iOS client sends install/session/device IDs alongside the
        # bearer token. The API accepts requests without them but becomes
        # noticeably stricter — send them when captured.
        h = {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "Hinge/9.68.0 (iPhone; iOS 17.4; Scale/3.00)",
            "X-App-Version": "9.68.0",
            "X-Build-Number": "9680",
            "X-OS-Version": "17.4",
            "X-Device-Platform": "ios",
        }
        for env_key, header in (
            ("HINGE_INSTALL_ID", "X-Install-Id"),
            ("HINGE_SESSION_ID", "X-Session-Id"),
            ("HINGE_DEVICE_ID", "X-Device-Id"),
        ):
            val = os.environ.get(env_key)
            if val:
                h[header] = val
        return h

    def _request(
        self,
        method: str,
        path: str,
        _retried: bool = False,
        **kwargs: Any,
    ) -> dict:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        kwargs.setdefault("timeout", REQUEST_TIMEOUT)
        try:
            resp = self.session.request(method, url, **kwargs)
        except requests.RequestException as exc:
            self.errors += 1
            raise RuntimeError(f"Hinge API request failed: {exc}") from exc

        if resp.status_code == 401:
            # Try the SMS auto-refresh once if a phone number is configured.
            if not _retried and self._try_sms_refresh():
                self.session.headers.update(self._default_headers())
                return self._request(method, path, _retried=True, **kwargs)
            raise HingeAuthError(
                "401 from Hinge API. Token expired and SMS auto-refresh did not "
                "recover. Capture manually via docs/SETUP_HINGE_TOKEN.md or run "
                "`clapcheeks refresh-hinge-token`."
            )
        if resp.status_code >= 400:
            self.errors += 1
            raise RuntimeError(
                f"Hinge {method} {path} -> {resp.status_code}: {resp.text[:200]}"
            )
        if not resp.content:
            return {}
        try:
            return resp.json()
        except ValueError:
            return {"raw": resp.text}

    # ------------------------------------------------------------------
    # 401 auto-refresh via SMS
    # ------------------------------------------------------------------

    def _try_sms_refresh(self) -> bool:
        """Attempt the Hinge SMS auth flow. Returns True on success.

        Triggered on first 401 from the API. Silently no-ops if no phone
        number is configured (CLAPCHEEKS_HINGE_PHONE) or the SMS DB is
        unreadable.
        """
        phone = os.environ.get("CLAPCHEEKS_HINGE_PHONE", "").strip()
        if not phone:
            logger.info(
                "Skipping SMS refresh — set CLAPCHEEKS_HINGE_PHONE to enable."
            )
            return False
        try:
            from clapcheeks.platforms.hinge_auth import refresh_token
            result = refresh_token(phone)
        except Exception as exc:
            logger.warning("Hinge SMS auto-refresh failed: %s", exc)
            return False
        self.token = result["token"]
        logger.info("Hinge SMS auto-refresh succeeded.")
        return True

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def login(self) -> bool:
        """Validate the token by hitting a cheap authenticated endpoint.

        Returns True on success, raises HingeAuthError if the token is bad.
        """
        try:
            self._request("GET", "/user/v2/public/me")
            logger.info("Hinge API login OK.")
            return True
        except HingeAuthError:
            raise
        except Exception as exc:
            # Endpoint shape may drift; fall back to a known-good recs call
            logger.debug("me endpoint failed (%s), trying recs probe", exc)
            self._get_feed()
            logger.info("Hinge API login OK (via recs probe).")
            return True

    # ------------------------------------------------------------------
    # Feed + actions
    # ------------------------------------------------------------------

    def _get_feed(self) -> list[dict]:
        """Return a list of recommendation cards."""
        data = self._request("GET", "/feed/rec/v3")
        if isinstance(data, dict):
            return data.get("recs") or data.get("subjects") or data.get("data") or []
        if isinstance(data, list):
            return data
        return []

    def _extract_card(self, raw: dict) -> dict:
        """Normalize a raw recs entry into the shape the rest of the code expects."""
        subject = raw.get("subject") or raw
        prompts = subject.get("prompts") or []
        first_prompt = prompts[0] if prompts else None
        photos: list[str] = []
        for p in subject.get("photos") or []:
            url = p.get("cdnUrl") or p.get("url")
            if url:
                photos.append(url)
        return {
            "subject_id": subject.get("subjectId") or subject.get("id") or raw.get("id"),
            "name": (subject.get("firstName") or subject.get("name") or "").strip(),
            "has_prompt": bool(first_prompt),
            "prompt_text": (first_prompt or {}).get("prompt", {}).get("question")
                if first_prompt else None,
            "prompt_response": (first_prompt or {}).get("answer") if first_prompt else None,
            "prompt_id": (first_prompt or {}).get("id") if first_prompt else None,
            "photos": photos,
            "raw": raw,
        }

    def _like(self, card: dict, comment: str | None = None) -> None:
        """Rate a profile as 'like'. If `comment` is provided, attach it."""
        subject_id = card.get("subject_id")
        if not subject_id:
            raise RuntimeError("Cannot like — card missing subject_id")

        payload: dict[str, Any] = {
            "subjectId": subject_id,
            "rating": "like",
            "origin": "standards",
        }
        if comment:
            payload["comment"] = comment
            if card.get("prompt_id"):
                payload["contentId"] = card["prompt_id"]
                payload["contentType"] = "prompt"

        self._request("POST", "/rate/v2", json=payload)

        self.liked += 1
        if comment:
            self.commented += 1
            logger.info("Liked %s with comment: %s",
                        card.get("name") or subject_id,
                        (comment[:60] + "…") if len(comment) > 60 else comment)
        else:
            logger.info("Liked %s", card.get("name") or subject_id)

    def _skip(self, card: dict) -> None:
        payload = {
            "subjectId": card.get("subject_id"),
            "rating": "skip",
            "origin": "standards",
        }
        self._request("POST", "/rate/v2", json=payload)
        self.passed += 1
        logger.info("Skipped %s", card.get("name") or card.get("subject_id"))

    # ------------------------------------------------------------------
    # Most Compatible (iOS feed tag)
    # ------------------------------------------------------------------

    def check_most_compatible(self) -> int:
        """Like up to 3 Most Compatible profiles. Returns count acted on."""
        try:
            data = self._request("GET", "/feed/compatible/v1")
        except Exception as exc:
            logger.info("No Most Compatible feed (%s), skipping.", exc)
            return 0

        raw_items = (
            data.get("recs") or data.get("subjects") or data.get("data") or []
            if isinstance(data, dict) else []
        )
        acted = 0
        for raw in raw_items[:3]:
            card = self._extract_card(raw)
            try:
                comment = (
                    self._generate_prompt_comment(
                        card["prompt_text"], card.get("prompt_response"),
                    )
                    if card["has_prompt"] and self.ai_service_url
                    else None
                )
                self._like(card, comment=comment)
                acted += 1
                time.sleep(random.uniform(1.5, 3.5))
            except Exception as exc:
                logger.warning("Most Compatible like failed: %s", exc)
                self.errors += 1

        if acted:
            logger.info("Most Compatible: acted on %d.", acted)
        return acted

    # ------------------------------------------------------------------
    # Swipe session (public entrypoint)
    # ------------------------------------------------------------------

    def run_swipe_session(
        self,
        like_ratio: float = 0.5,
        max_swipes: int = 30,
    ) -> dict:
        self.login()

        mc_count = self.check_most_compatible()

        try:
            check_limit("hinge", "swipe")
        except RateLimitExceeded as exc:
            logger.warning("%s", exc)
            return {
                "liked": self.liked, "passed": self.passed,
                "errors": self.errors, "commented": self.commented,
                "most_compatible": mc_count,
            }

        try:
            feed = self._get_feed()
        except Exception as exc:
            logger.error("Feed fetch failed: %s", exc)
            return {
                "liked": self.liked, "passed": self.passed,
                "errors": self.errors + 1, "commented": self.commented,
                "most_compatible": mc_count,
            }

        effective_max = min(max_swipes, len(feed), DAILY_LIKE_LIMIT)
        for idx in range(effective_max):
            card = self._extract_card(feed[idx])
            try:
                roll = random.random()
                if card["has_prompt"] and roll < like_ratio and self.ai_service_url:
                    comment = self._generate_prompt_comment(
                        card["prompt_text"], card.get("prompt_response"),
                    )
                    self._like(card, comment=comment)
                    record_swipe("hinge", "right")
                elif roll < like_ratio:
                    self._like(card)
                    record_swipe("hinge", "right")
                else:
                    self._skip(card)
                    record_swipe("hinge", "left")
                time.sleep(random.uniform(1.5, 4.0))
            except HingeAuthError:
                raise
            except Exception as exc:
                logger.warning("Iter %d failed: %s", idx, exc)
                self.errors += 1

        return {
            "liked": self.liked,
            "passed": self.passed,
            "errors": self.errors,
            "commented": self.commented,
            "most_compatible": mc_count,
        }

    # ------------------------------------------------------------------
    # Matches + messaging (parity with browser client)
    # ------------------------------------------------------------------

    def check_new_matches(self) -> list[dict]:
        """Return matches with no messages yet."""
        try:
            data = self._request("GET", "/match/v1")
        except Exception as exc:
            logger.debug("check_new_matches failed: %s", exc)
            return []
        matches = (data.get("matches") if isinstance(data, dict) else data) or []
        out: list[dict] = []
        for m in matches:
            if m.get("hasMessages"):
                continue
            out.append({
                "match_id": m.get("matchId") or m.get("id"),
                "name": (m.get("subject") or {}).get("firstName") or m.get("name") or "",
            })
        return out

    def send_message(self, match_id: str, message: str) -> bool:
        try:
            self._request(
                "POST",
                f"/message/send/v1",
                json={"matchId": match_id, "body": message},
            )
            return True
        except Exception as exc:
            logger.error("send_message failed: %s", exc)
            return False

    def get_matches(self, count: int = 20) -> list[dict]:
        try:
            data = self._request("GET", f"/match/v1?limit={count}")
        except Exception as exc:
            logger.debug("get_matches failed: %s", exc)
            return []
        matches = (data.get("matches") if isinstance(data, dict) else data) or []
        return matches[:count]

    def get_messages(self, match_id: str, limit: int = 50) -> list[dict]:
        """Fetch message history for a single match (oldest first).

        Hinge's iOS API serves threads at /message/match/v1/{matchId}. The
        response wraps an array under ``messages``. Empty list on any
        failure (logged) so callers can treat it as "no messages yet".
        """
        if not match_id:
            return []
        try:
            data = self._request(
                "GET",
                f"/message/match/v1/{match_id}?limit={limit}",
            )
        except Exception as exc:
            logger.debug("get_messages(%s) failed: %s", match_id, exc)
            return []
        msgs = (data.get("messages") if isinstance(data, dict) else data) or []
        out: list[dict] = []
        for m in msgs:
            out.append({
                "message_id": m.get("messageId") or m.get("id"),
                "from_self": bool(m.get("fromSelf") or m.get("isSelf")),
                "body": m.get("body") or m.get("text"),
                "sent_at": m.get("createdAt") or m.get("sentAt"),
            })
        return out

    @staticmethod
    def message_thread_url(match_id: str, limit: int = 50, base_url: str | None = None) -> str:
        """Build the URL the Chrome-extension job_queue should fetch.

        Provided so callers enqueueing jobs don't hard-code the path in
        multiple places.
        """
        b = (base_url or DEFAULT_BASE).rstrip("/")
        return f"{b}/message/match/v1/{match_id}?limit={limit}"

    # ------------------------------------------------------------------
    # Full match intake (Phase A - AI-8315)
    # ------------------------------------------------------------------

    def list_all_matches(self, page_size: int = 100, max_pages: int = 20) -> list[dict]:
        """Return every match. Paginates via offset."""
        all_matches: list[dict] = []
        offset = 0
        for _ in range(max_pages):
            try:
                data = self._request(
                    "GET",
                    f"/match/v1?limit={page_size}&offset={offset}",
                )
            except Exception as exc:
                logger.warning("Hinge list_all_matches page failed: %s", exc)
                break
            page = (data.get("matches") if isinstance(data, dict) else data) or []
            if not page:
                break
            all_matches.extend(page)
            if len(page) < page_size:
                break
            offset += page_size
        logger.info("Hinge: pulled %d matches", len(all_matches))
        return all_matches

    def get_match_profile(self, subject_id: str) -> dict | None:
        """Return the hydrated subject profile."""
        if not subject_id:
            return None
        try:
            data = self._request("GET", f"/subject/v1/{subject_id}")
            if isinstance(data, dict):
                return data.get("subject") or data
            return None
        except HingeAuthError:
            raise
        except Exception as exc:
            logger.debug("Hinge get_match_profile(%s) failed: %s", subject_id, exc)
            return None

    @staticmethod
    def parse_match_to_intel(match: dict, full_profile: dict | None = None) -> dict:
        """Normalize a Hinge match + optional full profile into clapcheeks_matches shape."""
        subject = full_profile or match.get("subject") or {}

        photos: list[dict] = []
        for idx, p in enumerate(subject.get("photos") or []):
            url = p.get("cdnUrl") or p.get("url")
            if not url:
                continue
            photos.append({
                "idx": idx,
                "url": url,
                "width": p.get("width"),
                "height": p.get("height"),
            })

        prompts: list[dict] = []
        for p in subject.get("prompts") or []:
            q = ((p.get("prompt") or {}).get("question")) or p.get("question")
            a = p.get("answer")
            if q or a:
                prompts.append({"question": q or "", "answer": a or ""})

        job = None
        employments = subject.get("employments") or []
        if employments and isinstance(employments[0], dict):
            emp = employments[0]
            if emp.get("jobTitle"):
                job = emp.get("jobTitle")
            elif isinstance(emp.get("employer"), dict):
                job = emp.get("employer", {}).get("name")
            else:
                job = emp.get("employer")

        school = None
        educations = subject.get("educations") or []
        if educations and isinstance(educations[0], dict):
            edu = educations[0]
            if edu.get("schoolName"):
                school = edu.get("schoolName")
            elif isinstance(edu.get("school"), dict):
                school = edu.get("school", {}).get("name")
            else:
                school = edu.get("school")

        instagram_handle = None
        ig = subject.get("instagram") or subject.get("instagramData")
        if isinstance(ig, dict):
            instagram_handle = ig.get("username") or ig.get("handle")
        elif isinstance(ig, str):
            instagram_handle = ig

        birth_date_raw = subject.get("birthday") or subject.get("birthDate")
        birth_date = None
        age = subject.get("age")
        if birth_date_raw:
            try:
                from datetime import datetime as _dt
                birth_date = _dt.fromisoformat(
                    str(birth_date_raw).replace("Z", "+00:00")
                ).date().isoformat()
                if not age:
                    from datetime import date as _d
                    today = _d.today()
                    bd = _dt.fromisoformat(
                        str(birth_date_raw).replace("Z", "+00:00")
                    ).date()
                    age = today.year - bd.year - (
                        (today.month, today.day) < (bd.month, bd.day)
                    )
            except Exception:
                birth_date = None

        return {
            "external_id": (
                match.get("matchId")
                or match.get("id")
                or subject.get("subjectId")
                or subject.get("id")
            ),
            "name": (
                subject.get("firstName")
                or subject.get("name")
                or (match.get("subject") or {}).get("firstName")
                or ""
            ),
            "age": age,
            "bio": subject.get("bio") or subject.get("intro") or "",
            "birth_date": birth_date,
            "photos": photos,
            "prompts": prompts,
            "job": job,
            "school": school,
            "instagram_handle": instagram_handle,
            "spotify_artists": None,
            "last_activity_at": match.get("createdAt") or match.get("matchedAt"),
        }

    # ------------------------------------------------------------------
    # AI comment generation (borrowed from the browser client)
    # ------------------------------------------------------------------

    def _generate_prompt_comment(
        self,
        prompt_text: str | None,
        prompt_response: str | None = None,
    ) -> str | None:
        if not self.ai_service_url or not prompt_text:
            return None

        user_prompt = f"Their prompt: {prompt_text}"
        if prompt_response:
            user_prompt += f"\nTheir answer: {prompt_response}"

        payload = {
            "model": "llama3.2",
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            "stream": False,
            "options": {"temperature": 0.8, "num_predict": 100},
        }

        try:
            r = requests.post(self.ai_service_url, json=payload, timeout=10)
            r.raise_for_status()
            comment = r.json()["message"]["content"].strip()
            if len(comment) > 150:
                comment = comment[:147] + "..."

            emoji_count = sum(1 for c in comment if ord(c) > 0x1F600)
            sentence_count = (
                comment.count(".") + comment.count("!") + comment.count("?")
            )
            if emoji_count >= 3 or sentence_count > 2 or '"' in comment:
                payload["messages"][0]["content"] = _SYSTEM_PROMPT + _STRICT_SUFFIX
                r = requests.post(self.ai_service_url, json=payload, timeout=10)
                r.raise_for_status()
                comment = r.json()["message"]["content"].strip()
                if len(comment) > 150:
                    comment = comment[:147] + "..."
            return comment
        except Exception as exc:
            logger.warning("AI comment gen failed: %s", exc)
            return None
