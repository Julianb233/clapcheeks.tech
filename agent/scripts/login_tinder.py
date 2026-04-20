#!/usr/bin/env python3
"""Drive a real Tinder login on the local Mac's Chrome.

Run on the Mac Mini. Launches a visible Chromium, walks the phone-login
flow, reads the SMS code from ~/Library/Messages/chat.db, submits it,
and extracts the X-Auth-Token from localStorage. No Browserbase.

If Arkose captcha fires and there's no solver configured, the script
pauses so a human can clear it, then continues. Script prints the
final token or an explanation of why it couldn't complete.

Usage:
    login_tinder.py --phone +16195090699
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time

# Allow running as a script before installation
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from clapcheeks.inputs.sms import wait_for_code, MessagesDBUnavailable
from clapcheeks.platforms.tinder_auth import _persist_token  # reuse .env merge

logging.basicConfig(
    level=os.environ.get("LOGLEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("login_tinder")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--phone", required=True, help="E.164 phone, e.g. +16195090699")
    ap.add_argument("--headless", action="store_true",
                    help="Run Chromium headless (default: visible so you can watch).")
    ap.add_argument("--sms-timeout", type=int, default=120)
    ap.add_argument("--captcha-timeout", type=int, default=180,
                    help="If Arkose appears, wait this long for it to clear.")
    args = ap.parse_args()

    phone = args.phone.strip()
    if not phone.startswith("+"):
        log.error("Phone must be E.164 (+16195090699)")
        return 2

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log.error("Playwright not installed. pip install playwright && playwright install chromium")
        return 3

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=args.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/125.0 Safari/537.36"
            ),
        )
        page = context.new_page()
        page.set_default_timeout(20_000)

        try:
            _drive_login(page, phone, args)
            token = _extract_token(page, context)
        finally:
            # Keep the browser open for 10s so you can eyeball the end state
            time.sleep(10)
            context.close()
            browser.close()

    if not token:
        log.error("Login looked complete but no token found in localStorage/cookies.")
        return 4

    _persist_token(token)
    preview = token[:14] + "..." + token[-4:]
    print(f"\nSUCCESS: token written to ~/.clapcheeks/.env")
    print(f"token: {preview}")
    return 0


def _drive_login(page, phone, args):
    log.info("Opening tinder.com/app/login")
    page.goto("https://tinder.com/app/login", wait_until="domcontentloaded")

    _click_first(page, [
        'button:has-text("Log in")',
        'a:has-text("Log in")',
        'text="Log in"',
    ], "Log in button", optional=True)

    _click_first(page, [
        'text="Log in with phone number"',
        'button:has-text("Phone Number")',
        'text="Continue with Phone Number"',
    ], "phone-login option", optional=True)

    phone_input = _wait_first(page, [
        'input[type="tel"]',
        'input[name*="phone" i]',
        'input[placeholder*="phone" i]',
    ], "phone input")

    # Tinder pre-selects a country code. Strip + and leading country digit
    # for US (+1). For non-US, pass the full national number.
    national = phone.lstrip("+")
    if national.startswith("1") and len(national) == 11:
        national = national[1:]
    log.info("Entering phone digits: %s", national)
    phone_input.fill(national)
    sms_request_ts = time.time() - 2

    _click_first(page, [
        'button:has-text("Continue")',
        'button[type="submit"]',
    ], "Continue (send SMS)")

    _wait_if_captcha(page, args.captcha_timeout)

    log.info("Waiting up to %ds for SMS code...", args.sms_timeout)
    try:
        code_msg = wait_for_code(
            "tinder", timeout_seconds=args.sms_timeout,
            received_after=sms_request_ts,
        )
    except MessagesDBUnavailable as exc:
        log.error("Cannot read Messages.db: %s", exc)
        raise SystemExit(5)
    if not code_msg:
        log.error("No SMS arrived. Confirm forwarding is on for the receiving iPhone.")
        raise SystemExit(5)

    log.info("Got code %s (age %.1fs, from %s)",
             code_msg.code, code_msg.age_seconds, code_msg.sender)

    _fill_otp_code(page, code_msg.code)
    _click_first(page, [
        'button:has-text("Continue")',
        'button:has-text("Submit")',
        'button[type="submit"]',
    ], "Submit code", optional=True)

    _wait_if_captcha(page, args.captcha_timeout)

    # Wait for the URL to leave /login
    for _ in range(40):
        if "/app/login" not in page.url:
            break
        page.wait_for_timeout(500)
    log.info("Post-login URL: %s", page.url)


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _click_first(page, selectors, description, *, optional=False):
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=4000)
            loc.click()
            log.debug("Clicked %s via %s", description, sel)
            return
        except Exception:
            continue
    if optional:
        log.debug("Skipping optional %s", description)
        return
    raise RuntimeError(f"Could not click {description}")


def _wait_first(page, selectors, description):
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=5000)
            return loc
        except Exception:
            continue
    raise RuntimeError(f"{description} not found on page")


def _wait_if_captcha(page, max_wait_s):
    markers = [
        'iframe[title*="captcha" i]',
        'iframe[src*="arkoselabs"]',
        'iframe[src*="funcaptcha"]',
        'text="verify you are human"',
    ]
    saw_captcha = False
    deadline = time.time() + max_wait_s
    while time.time() < deadline:
        found = False
        for m in markers:
            try:
                if page.locator(m).count() > 0:
                    found = True
                    break
            except Exception:
                continue
        if found:
            if not saw_captcha:
                log.warning("Arkose captcha detected — waiting for it to clear (up to %ds).", max_wait_s)
                saw_captcha = True
            page.wait_for_timeout(2000)
        else:
            if saw_captcha:
                log.info("Captcha cleared.")
            return
    log.warning("Captcha still present after %ds — proceeding anyway.", max_wait_s)


def _fill_otp_code(page, code):
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
    raise RuntimeError("Could not locate OTP inputs")


def _extract_token(page, context):
    # localStorage / sessionStorage first
    try:
        dump = page.evaluate("""
            () => {
              const out = {};
              for (const k of Object.keys(localStorage)) out['L:'+k] = localStorage.getItem(k);
              for (const k of Object.keys(sessionStorage)) out['S:'+k] = sessionStorage.getItem(k);
              return out;
            }
        """) or {}
    except Exception as exc:
        log.warning("storage read failed: %s", exc)
        dump = {}

    known = (
        "TinderWeb/APIToken", "TinderWeb/ApiToken",
        "auth_token", "X-Auth-Token", "userSessionToken",
    )
    for key in known:
        for prefix in ("L:", "S:"):
            v = dump.get(prefix + key)
            if v:
                return _strip(v)

    import re as _re
    jwt = _re.compile(r"^ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")
    uuid = _re.compile(r"^[0-9a-f-]{20,40}$")
    for k, v in dump.items():
        if not isinstance(v, str):
            continue
        s = _strip(v)
        if jwt.match(s) or uuid.match(s):
            log.info("Token found in storage key %s", k)
            return s

    # Cookie fallback
    try:
        for c in context.cookies("https://tinder.com"):
            if c.get("name", "").lower() in {"x-auth-token", "authtoken", "auth_token"}:
                return c.get("value")
    except Exception:
        pass
    return None


def _strip(v):
    v = v.strip()
    if v.startswith('"') and v.endswith('"'):
        v = v[1:-1]
    return v


if __name__ == "__main__":
    sys.exit(main())
