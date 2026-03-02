"""Plenty of Fish (POF) browser automation — Meet section YES/NO swiping via Playwright."""
from __future__ import annotations

import asyncio
import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "pof": {"right": 100, "left": 300, "messages": 30},

POF_MEET_URL = "https://www.pof.com/meet"
POF_LOGIN_URL = "https://www.pof.com/login"

SELECTORS = {
    # Login form
    "username_input": '#username, input[name="username"], input[placeholder*="Username"]',
    "password_input": '#password, input[name="password"], input[type="password"]',
    "login_submit": 'button[type="submit"], input[type="submit"], .login-btn',
    # Meet / profile card
    "card": '.profile-card, [class*="meet-profile"], [data-testid="profile-card"]',
    "name": '.profile-card__name, [class*="profile-name"], h1',
    "yes_btn": (
        'button[data-vote="yes"], button[aria-label*="Yes"], '
        '.action-button--yes, [class*="yes-btn"]'
    ),
    "no_btn": (
        'button[data-vote="no"], button[aria-label*="No"], '
        '.action-button--no, [class*="no-btn"]'
    ),
    # Match notification
    "match_modal": '[class*="match-modal"], [class*="its-a-match"], .match-popup',
    "match_close": 'button[aria-label*="Close"], .match-modal__close, [class*="close-btn"]',
    # Inbox / messages
    "inbox_link": 'a[href*="/inbox"], nav a[href*="messages"]',
    "unread_item": '.inbox-item--unread, [class*="message-item"][class*="unread"]',
    "logged_in_indicator": '.user-nav, [class*="logged-in"], #main-nav',
}

DEFAULT_DAILY_RIGHT_LIMIT = 100


class POFClient:
    """Automate POF (Plenty of Fish) Meet section swiping via Playwright browser automation."""

    def __init__(self, driver) -> None:
        self.driver = driver
        self._page = None
        self._credentials: dict = {}

    def _get_page(self):
        """Resolve the Playwright Page from the driver."""
        if self._page is not None:
            return self._page
        if hasattr(self.driver, "_page") and self.driver._page is not None:
            self._page = self.driver._page
        else:
            self._page = self.driver
        return self._page

    def set_credentials(self, username: str, password: str) -> None:
        """Store credentials for auto-login attempt (optional helper)."""
        self._credentials = {"username": username, "password": password}

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def login(self) -> bool:
        """Navigate to POF Meet and wait for a logged-in session.

        Attempts credential-based auto-login if set_credentials() was called.
        Falls back to waiting for manual login.

        Returns True when the Meet UI is detected, False on timeout.
        """
        page = self._get_page()

        async def _login() -> bool:
            await page.goto(POF_MEET_URL, wait_until="domcontentloaded")

            # Check if already on Meet page (logged in)
            try:
                await page.locator(SELECTORS["card"]).first.wait_for(
                    state="visible", timeout=5_000,
                )
                logger.info("Already logged in to POF.")
                return True
            except Exception:
                pass

            # Attempt auto-login with credentials if available
            if self._credentials:
                try:
                    await page.goto(POF_LOGIN_URL, wait_until="domcontentloaded")
                    await asyncio.sleep(random.uniform(1.0, 2.0))

                    username_field = page.locator(SELECTORS["username_input"]).first
                    await username_field.fill(self._credentials["username"])
                    await asyncio.sleep(random.uniform(0.3, 0.8))

                    password_field = page.locator(SELECTORS["password_input"]).first
                    await password_field.fill(self._credentials["password"])
                    await asyncio.sleep(random.uniform(0.5, 1.0))

                    await page.locator(SELECTORS["login_submit"]).first.click()
                    await asyncio.sleep(random.uniform(2.0, 4.0))

                    # Navigate to meet
                    await page.goto(POF_MEET_URL, wait_until="domcontentloaded")
                    try:
                        await page.locator(SELECTORS["card"]).first.wait_for(
                            state="visible", timeout=8_000,
                        )
                        logger.info("Auto-login to POF succeeded.")
                        return True
                    except Exception:
                        logger.warning("Auto-login to POF failed — falling back to manual.")
                except Exception as exc:
                    logger.warning("Auto-login attempt failed: %s", exc)

            # Manual login wait
            print(
                "\n=== POF Login Required ===\n"
                "Please log in manually in the browser window.\n"
                "Waiting up to 120 seconds for login...\n"
            )

            for _ in range(40):
                await asyncio.sleep(3)
                try:
                    # Check for Meet card or logged-in nav indicator
                    card_visible = False
                    try:
                        await page.locator(SELECTORS["card"]).first.wait_for(
                            state="visible", timeout=2_000,
                        )
                        card_visible = True
                    except Exception:
                        pass

                    if not card_visible:
                        nav_count = await page.locator(SELECTORS["logged_in_indicator"]).count()
                        if nav_count > 0:
                            await page.goto(POF_MEET_URL, wait_until="domcontentloaded")
                            await asyncio.sleep(2)
                            card_visible = True

                    if card_visible:
                        logger.info("POF login detected.")
                        return True
                except Exception:
                    continue

            logger.warning("POF login timed out after 120 seconds.")
            return False

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_login())
        finally:
            loop.close()

    # ------------------------------------------------------------------
    # Swipe session
    # ------------------------------------------------------------------

    def run_swipe_session(
        self,
        like_ratio: float = 0.5,
        max_swipes: int = 30,
    ) -> dict:
        """Execute a POF Meet swiping session. Returns stats dict."""
        if not self.login():
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check
        daily = get_daily_summary() or {}
        used_right = daily.get("pof_right", 0)
        remaining = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_right)
        effective_max = min(max_swipes, remaining + max_swipes)

        if remaining <= 0:
            logger.warning("Daily YES-vote limit reached for POF (%d/day).", DEFAULT_DAILY_RIGHT_LIMIT)

        page = self._get_page()
        liked = 0
        passed = 0
        errors = 0
        new_matches: list[dict] = []

        async def _swipe_loop() -> None:
            nonlocal liked, passed, errors

            for i in range(min(max_swipes, 200)):
                try:
                    # Wait for profile card
                    try:
                        await page.locator(SELECTORS["card"]).first.wait_for(
                            state="visible", timeout=10_000,
                        )
                    except Exception:
                        logger.info("No more POF profiles in Meet, ending session.")
                        break

                    # Extract name (non-fatal)
                    profile_name = "Unknown"
                    try:
                        name_el = page.locator(SELECTORS["name"]).first
                        profile_name = (
                            await name_el.text_content(timeout=2_000) or ""
                        ).strip()
                    except Exception:
                        pass

                    # Decide direction
                    do_like = random.random() < like_ratio

                    if do_like and can_swipe("pof", "right"):
                        try:
                            await page.locator(SELECTORS["yes_btn"]).first.click(timeout=5_000)
                            liked += 1
                            record_swipe("pof", "right")
                            logger.debug("YES on %s (POF).", profile_name)
                        except Exception as exc:
                            logger.warning("YES click failed for %s: %s", profile_name, exc)
                            errors += 1
                    else:
                        try:
                            await page.locator(SELECTORS["no_btn"]).first.click(timeout=5_000)
                            passed += 1
                            record_swipe("pof", "left")
                            logger.debug("NO on %s (POF).", profile_name)
                        except Exception as exc:
                            logger.warning("NO click failed for %s: %s", profile_name, exc)
                            errors += 1

                    # Check for match modal after YES
                    if do_like:
                        try:
                            await page.locator(SELECTORS["match_modal"]).first.wait_for(
                                state="visible", timeout=2_000,
                            )
                            new_matches.append({"name": profile_name})
                            logger.info("Match detected: %s", profile_name)
                            try:
                                await page.locator(SELECTORS["match_close"]).first.click(timeout=2_000)
                            except Exception:
                                pass
                        except Exception:
                            pass

                    # Gaussian jitter delay: mean=6s, std=2.5, clamped 2-18s
                    delay = max(2.0, min(18.0, random.gauss(6, 2.5)))
                    await asyncio.sleep(delay)

                except Exception as exc:
                    logger.warning("Swipe iteration %d failed: %s", i, exc)
                    errors += 1
                    continue

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_swipe_loop())
        finally:
            loop.close()

        return {"liked": liked, "passed": passed, "errors": errors, "new_matches": new_matches}

    # ------------------------------------------------------------------
    # Match detection
    # ------------------------------------------------------------------

    def check_new_matches(self) -> list[dict]:
        """Navigate to POF inbox and return new unread match conversations."""
        page = self._get_page()
        matches: list[dict] = []

        async def _check() -> list[dict]:
            result: list[dict] = []
            try:
                inbox_link = page.locator(SELECTORS["inbox_link"]).first
                await inbox_link.click(timeout=5_000)
                await asyncio.sleep(random.uniform(1.5, 3.0))

                unread_items = page.locator(SELECTORS["unread_item"])
                count = await unread_items.count()

                for idx in range(min(count, 20)):
                    item = unread_items.nth(idx)
                    try:
                        name_el = item.locator('[class*="name"], span').first
                        name = (await name_el.text_content(timeout=1_500) or "").strip()
                        result.append({"match_id": f"pof_match_{idx}", "name": name or "Unknown"})
                    except Exception:
                        continue
            except Exception as exc:
                logger.debug("check_new_matches on POF failed: %s", exc)
            return result

        loop = asyncio.new_event_loop()
        try:
            matches = loop.run_until_complete(_check())
        finally:
            loop.close()

        logger.info("Found %d new matches on POF.", len(matches))
        return matches

    # ------------------------------------------------------------------
    # Messaging
    # ------------------------------------------------------------------

    def send_message(self, match_id: str, message: str) -> bool:
        """Send a message to a match via browser automation.

        Returns True on success, False on failure.
        """
        page = self._get_page()

        async def _send() -> bool:
            try:
                input_el = page.locator('textarea[placeholder*="message"], #message-body').first
                await input_el.wait_for(state="visible", timeout=5_000)
                await input_el.fill(message)
                await asyncio.sleep(random.uniform(0.5, 1.2))
                send_btn = page.locator('button[type="submit"], button[aria-label*="Send"]').first
                await send_btn.click(timeout=3_000)
                logger.info("Message sent to match %s on POF.", match_id)
                return True
            except Exception as exc:
                logger.error("send_message to %s on POF failed: %s", match_id, exc)
                return False

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_send())
        finally:
            loop.close()
