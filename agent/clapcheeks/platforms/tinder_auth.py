"""Tinder Browserbase-backed auth refresh.

Tinder web login uses an Arkose Labs captcha in front of phone verification,
so raw HTTP calls won't work. Browserbase gives us a stealth Chrome instance
with a clean residential fingerprint + built-in captcha solver. We drive
the login flow with Playwright connected to the BB session, feed the SMS
code in from Messages.db (same path Hinge uses), and pull the fresh
`X-Auth-Token` out of localStorage.

Env inputs:
    BROWSERBASE_API_KEY        — required
    BROWSERBASE_PROJECT_ID     — required
    CLAPCHEEKS_TINDER_PHONE    — E.164 phone (e.g. +14155551234). Required
                                  for `refresh_token()`; CLI asks if missing.

Outputs (written to ~/.clapcheeks/.env):
    TINDER_AUTH_TOKEN, TINDER_WIRE_FORMAT=json, CLAPCHEEKS_TINDER_MODE=api

Heads-up: Tinder may take 10-30 seconds per step, and SMS arrival is
another 5-15 seconds. Budget ~90 seconds for the whole flow.
"""
from __future__ import annotations

import logging
import os
import re
import time
from pathlib import Path

from clapcheeks.inputs.sms import wait_for_code, MessagesDBUnavailable

logger = logging.getLogger("clapcheeks.tinder_auth")

_ENV_FILE = Path.home() / ".clapcheeks" / ".env"

LOGIN_URL = "https://tinder.com/app/login"
# Candidate localStorage keys where Tinder stashes the auth token. We try in order.
_LOCAL_STORAGE_KEYS = (
    "TinderWeb/APIToken",
    "TinderWeb/ApiToken",
    "auth_token",
    "X-Auth-Token",
    "userSessionToken",
)


class TinderBrowserAuthFailed(RuntimeError):
    """End-to-end browser auth didn't recover a token."""


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def refresh_token(
    phone_number: str | None = None,
    *,
    sms_timeout_seconds: int = 120,
    step_timeout_ms: int = 20_000,
    headless: bool = True,
) -> dict:
    """End-to-end Tinder refresh via Browserbase + Playwright.

    Returns {token, phone} on success. Writes to ~/.clapcheeks/.env.
    """
    phone = phone_number or os.environ.get("CLAPCHEEKS_TINDER_PHONE", "").strip()
    if not phone or not phone.startswith("+"):
        raise TinderBrowserAuthFailed(
            "CLAPCHEEKS_TINDER_PHONE not set (or not E.164). "
            "Use +14155551234-style format."
        )

    api_key = os.environ.get("BROWSERBASE_API_KEY")
    project_id = os.environ.get("BROWSERBASE_PROJECT_ID")
    if not api_key or not project_id:
        raise TinderBrowserAuthFailed(
            "BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID missing."
        )

    # Lazy imports so the rest of the module works even without BB installed
    try:
        from browserbase import Browserbase  # type: ignore
        from playwright.sync_api import sync_playwright  # type: ignore
    except ImportError as exc:
        raise TinderBrowserAuthFailed(
            f"Missing dependency: {exc}. pip install browserbase playwright."
        ) from exc

    bb = Browserbase(api_key=api_key)
    session = bb.sessions.create(
        project_id=project_id,
        browser_settings={
            "solve_captchas": True,
            "fingerprint": {"devices": ["desktop"], "locales": ["en-US"]},
            "viewport": {"width": 1280, "height": 900},
        },
    )
    logger.info("BB session %s created (replay: %s)", session.id, session.session_url(session.id) if hasattr(session, 'session_url') else '')

    sms_trigger_at = None
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(session.connect_url)
            context = browser.contexts[0] if browser.contexts else browser.new_context()
            page = context.pages[0] if context.pages else context.new_page()
            page.set_default_timeout(step_timeout_ms)

            # --- Open login ---
            page.goto(LOGIN_URL, wait_until="domcontentloaded")
            _click_first(page, [
                'button:has-text("Log in")',
                'a:has-text("Log in")',
                'text="Log in"',
            ], description="Log in button")

            _click_first(page, [
                'text="Log in with phone number"',
                'button:has-text("phone")',
                'text="Continue with Phone Number"',
            ], description="Log in with phone", optional=True)

            # --- Phone entry ---
            phone_input = _wait_first(page, [
                'input[type="tel"]',
                'input[name*="phone" i]',
                'input[placeholder*="phone" i]',
            ], description="phone input")
            phone_input.fill(phone.lstrip("+").lstrip("1"))  # US-centric; Tinder usually pre-selects +1
            sms_trigger_at = time.time() - 2
            _click_first(page, [
                'button:has-text("Continue")',
                'button[type="submit"]',
            ], description="Continue (send SMS)")

            # --- Captcha (handled by BB solve_captchas) ---
            # Give BB's solver a moment if challenge appears.
            _wait_if_captcha(page, max_wait_s=30)

            # --- Wait for SMS code from Messages.db ---
            logger.info("Waiting up to %ds for Tinder SMS code...", sms_timeout_seconds)
            try:
                code_msg = wait_for_code(
                    "tinder",
                    timeout_seconds=sms_timeout_seconds,
                    received_after=sms_trigger_at,
                )
            except MessagesDBUnavailable as exc:
                raise TinderBrowserAuthFailed(str(exc)) from exc
            if not code_msg:
                raise TinderBrowserAuthFailed(
                    f"No Tinder SMS arrived in {sms_timeout_seconds}s."
                )

            # --- Enter code ---
            _fill_otp_code(page, code_msg.code)
            _click_first(page, [
                'button:has-text("Continue")',
                'button:has-text("Submit")',
                'button[type="submit"]',
            ], description="Submit code", optional=True)

            # --- Wait for login to settle (URL change off /app/login) ---
            for _ in range(40):
                if "/app/login" not in page.url:
                    break
                page.wait_for_timeout(500)

            # --- Pull the token ---
            token = _read_token_from_storage(page)
            if not token:
                # Fallback: dig into cookies
                token = _read_token_from_cookies(context)
            if not token:
                raise TinderBrowserAuthFailed(
                    "Login looked successful but no auth token found in "
                    "localStorage or cookies. Dating apps change their storage "
                    "key often — open the Browserbase replay to check."
                )

            _persist_token(token)
            logger.info("Tinder token refreshed via Browserbase.")
            return {"token": token, "phone": phone, "bb_session_id": session.id}
    finally:
        # Best-effort session close. BB auto-terminates sessions after their TTL anyway.
        try:
            bb.sessions.update(session.id, project_id=project_id, status="REQUEST_RELEASE")
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Playwright helpers
# ---------------------------------------------------------------------------

def _click_first(page, selectors, description: str, *, optional: bool = False) -> None:
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=4000)
            loc.click()
            logger.debug("Clicked %s via %s", description, sel)
            return
        except Exception:
            continue
    if optional:
        logger.debug("Skipping optional click (%s) — nothing matched", description)
        return
    raise TinderBrowserAuthFailed(f"Could not click {description}")


def _wait_first(page, selectors, description: str):
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=4000)
            return loc
        except Exception:
            continue
    raise TinderBrowserAuthFailed(f"{description} not found on page")


def _wait_if_captcha(page, max_wait_s: int = 30) -> None:
    """If an Arkose/other captcha iframe appears, give BB's solver time."""
    markers = [
        'iframe[title*="captcha" i]',
        'iframe[src*="arkoselabs"]',
        'iframe[src*="funcaptcha"]',
        'text="verify you are human"',
    ]
    deadline = time.time() + max_wait_s
    saw_captcha = False
    while time.time() < deadline:
        for m in markers:
            try:
                if page.locator(m).count() > 0:
                    saw_captcha = True
                    break
            except Exception:
                continue
        if not saw_captcha:
            return
        # Poll until it disappears
        page.wait_for_timeout(1500)
        saw_captcha = False
        for m in markers:
            try:
                if page.locator(m).count() > 0:
                    saw_captcha = True
                    break
            except Exception:
                continue
        if not saw_captcha:
            logger.info("Captcha cleared.")
            return
    logger.warning("Captcha still present after %ds — proceeding anyway.", max_wait_s)


def _fill_otp_code(page, code: str) -> None:
    """Tinder renders OTP as 6 separate <input> boxes on desktop, 1 on mobile."""
    # Try single input first
    for sel in ('input[autocomplete="one-time-code"]', 'input[name="otp"]'):
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=3000)
            loc.fill(code)
            return
        except Exception:
            continue
    # Multi-box fallback
    try:
        boxes = page.locator('input[type="tel"]').all()
        if len(boxes) >= len(code):
            for ch, box in zip(code, boxes):
                box.fill(ch)
            return
    except Exception:
        pass
    raise TinderBrowserAuthFailed("Could not locate OTP inputs")


# ---------------------------------------------------------------------------
# Token extraction
# ---------------------------------------------------------------------------

def _read_token_from_storage(page) -> str | None:
    # Inspect every key in localStorage + sessionStorage
    try:
        dump = page.evaluate("""
            () => {
              const out = {};
              for (const key of Object.keys(localStorage)) out['L:' + key] = localStorage.getItem(key);
              for (const key of Object.keys(sessionStorage)) out['S:' + key] = sessionStorage.getItem(key);
              return out;
            }
        """) or {}
    except Exception as exc:
        logger.warning("localStorage read failed: %s", exc)
        return None
    # Try the known keys first
    for k in _LOCAL_STORAGE_KEYS:
        v = dump.get(f"L:{k}") or dump.get(f"S:{k}")
        if v:
            return _strip_token(v)
    # Otherwise scan values that look like JWTs or Tinder-style tokens
    jwt_re = re.compile(r"^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
    uuid_re = re.compile(r"^[0-9a-f-]{20,40}$")
    for k, v in dump.items():
        if not v or not isinstance(v, str):
            continue
        s = _strip_token(v)
        if jwt_re.match(s) or uuid_re.match(s):
            logger.info("Found token candidate in storage key %s", k)
            return s
    return None


def _strip_token(val: str) -> str:
    v = val.strip()
    if v.startswith('"') and v.endswith('"'):
        v = v[1:-1]
    return v


def _read_token_from_cookies(context) -> str | None:
    try:
        cookies = context.cookies("https://tinder.com")
    except Exception:
        return None
    for c in cookies:
        if c.get("name", "").lower() in {"x-auth-token", "authtoken", "auth_token"}:
            return c.get("value")
    return None


# ---------------------------------------------------------------------------
# Persist
# ---------------------------------------------------------------------------

def _persist_token(token: str) -> None:
    """Merge updates into ~/.clapcheeks/.env (0600)."""
    updates = {
        "TINDER_AUTH_TOKEN": token,
        "TINDER_WIRE_FORMAT": "json",
        "CLAPCHEEKS_TINDER_MODE": "api",
    }
    _ENV_FILE.parent.mkdir(parents=True, exist_ok=True)
    current: dict[str, str] = {}
    order: list[str] = []
    if _ENV_FILE.exists():
        for line in _ENV_FILE.read_text().splitlines():
            stripped = line.strip()
            if "=" in stripped and not stripped.startswith("#"):
                k, v = stripped.split("=", 1)
                k = k.strip()
                current[k] = v.strip().strip('"').strip("'")
                if k not in order:
                    order.append(k)
            else:
                order.append(line)
    current.update(updates)
    for k in updates:
        if k not in order:
            order.append(k)
    lines: list[str] = []
    seen: set[str] = set()
    for marker in order:
        if marker in current and marker not in seen:
            lines.append(f"{marker}={current[marker]}")
            seen.add(marker)
        elif "=" in marker or not marker.strip() or marker.strip().startswith("#"):
            lines.append(marker)
    for k, v in current.items():
        if k not in seen:
            lines.append(f"{k}={v}")
    _ENV_FILE.write_text("\n".join(lines) + "\n")
    try:
        _ENV_FILE.chmod(0o600)
    except Exception:
        pass
    for k, v in updates.items():
        os.environ[k] = v
