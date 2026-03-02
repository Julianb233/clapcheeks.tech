"""Badoo browser automation — encounters swipe loop via Playwright."""
from __future__ import annotations

import asyncio
import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe, get_daily_summary

logger = logging.getLogger(__name__)

# Expected DAILY_LIMITS entry in clapcheeks/session/rate_limiter.py:
#   "badoo": {"right": 100, "left": 300, "messages": 30},

BADOO_ENCOUNTERS_URL = "https://badoo.com/encounters"

SELECTORS = {
    "card": '.profile-card, [class*="profile-card"], [data-qa="profile-card"]',
    "name": '.profile-card__name, [class*="profile-name"], [data-qa="profile-name"]',
    "like": (
        'button[data-qa="vote-yes"], button[aria-label*="Like"], '
        '.encounters-album__action--like, [class*="vote-yes"]'
    ),
    "pass": (
        'button[data-qa="vote-no"], button[aria-label*="Pass"], '
        '.encounters-album__action--dislike, [class*="vote-no"]'
    ),
    "match_modal": '[class*="match"], [data-qa="match-popup"]',
    "match_dismiss": '[data-qa="match-popup-close"], button[aria-label*="Keep"]',
    "message_input": 'textarea[placeholder*="message"], [data-qa="message-input"]',
    "send_button": 'button[data-qa="send"], button[aria-label*="Send"]',
    "logged_in_indicator": '.header-nav, [data-qa="header"], .js-header',
}

DEFAULT_DAILY_RIGHT_LIMIT = 100


class BadooClient:
    """Automate Badoo encounters swiping via Playwright browser automation."""

    def __init__(self, driver) -> None:
        self.driver = driver
        self._page = None

    def _get_page(self):
        """Resolve the Playwright Page from the driver."""
        if self._page is not None:
            return self._page
        if hasattr(self.driver, "_page") and self.driver._page is not None:
            self._page = self.driver._page
        else:
            self._page = self.driver
        return self._page

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def login(self) -> bool:
        """Navigate to Badoo encounters and wait for manual login if needed.

        Returns True when the encounters UI is detected, False on timeout.
        """
        page = self._get_page()

        async def _login() -> bool:
            await page.goto(BADOO_ENCOUNTERS_URL, wait_until="domcontentloaded")

            # Check if already logged in (encounters card visible)
            try:
                await page.locator(SELECTORS["card"]).first.wait_for(
                    state="visible", timeout=6_000,
                )
                logger.info("Already logged in to Badoo.")
                return True
            except Exception:
                pass

            print(
                "\n=== Badoo Login Required ===\n"
                "Please log in manually in the browser window.\n"
                "Waiting up to 120 seconds for login...\n"
            )

            for _ in range(40):
                await asyncio.sleep(3)
                try:
                    await page.locator(SELECTORS["card"]).first.wait_for(
                        state="visible", timeout=2_000,
                    )
                    logger.info("Badoo login detected.")
                    return True
                except Exception:
                    continue

            logger.warning("Badoo login timed out after 120 seconds.")
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
        """Execute a Badoo encounters swiping session. Returns stats dict."""
        if not self.login():
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check
        daily = get_daily_summary() or {}
        used_right = daily.get("badoo_right", 0)
        remaining = max(0, DEFAULT_DAILY_RIGHT_LIMIT - used_right)
        effective_max = min(max_swipes, remaining + max_swipes)  # pass-swipes not capped

        if remaining <= 0:
            logger.warning("Daily right-swipe limit reached for Badoo (%d/day).", DEFAULT_DAILY_RIGHT_LIMIT)

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
                        logger.info("No more Badoo profiles available, ending session.")
                        break

                    # Extract profile name (non-fatal)
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

                    if do_like and can_swipe("badoo", "right"):
                        try:
                            await page.locator(SELECTORS["like"]).first.click(timeout=5_000)
                            liked += 1
                            record_swipe("badoo", "right")
                            logger.debug("Liked %s on Badoo.", profile_name)
                        except Exception as exc:
                            logger.warning("Like click failed for %s: %s", profile_name, exc)
                            errors += 1
                    else:
                        try:
                            await page.locator(SELECTORS["pass"]).first.click(timeout=5_000)
                            passed += 1
                            record_swipe("badoo", "left")
                            logger.debug("Passed %s on Badoo.", profile_name)
                        except Exception as exc:
                            logger.warning("Pass click failed for %s: %s", profile_name, exc)
                            errors += 1

                    # Check for match modal after like
                    if do_like:
                        try:
                            await page.locator(SELECTORS["match_modal"]).first.wait_for(
                                state="visible", timeout=2_000,
                            )
                            new_matches.append({"name": profile_name})
                            logger.info("Match detected: %s", profile_name)
                            # Dismiss match modal
                            try:
                                await page.locator(SELECTORS["match_dismiss"]).first.click(timeout=2_000)
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
        """Navigate to Badoo connections and return new matches (no opener sent yet)."""
        page = self._get_page()
        matches: list[dict] = []

        async def _check() -> list[dict]:
            result: list[dict] = []
            try:
                await page.goto("https://badoo.com/connections", wait_until="domcontentloaded")
                await asyncio.sleep(random.uniform(1.5, 3.0))

                # Look for match items without message previews
                match_items = page.locator('[class*="match-item"], [data-qa="connection-item"]')
                count = await match_items.count()

                for idx in range(min(count, 30)):
                    item = match_items.nth(idx)
                    try:
                        name_el = item.locator('[class*="name"], [data-qa="name"]').first
                        name = (await name_el.text_content(timeout=1_500) or "").strip()
                        # Check if no message yet (new match)
                        has_msg = await item.locator('[class*="message"], [data-qa="last-message"]').count()
                        if not has_msg:
                            result.append({"match_id": f"badoo_match_{idx}", "name": name})
                    except Exception:
                        continue
            except Exception as exc:
                logger.debug("check_new_matches failed: %s", exc)
            return result

        loop = asyncio.new_event_loop()
        try:
            matches = loop.run_until_complete(_check())
        finally:
            loop.close()

        logger.info("Found %d new matches on Badoo.", len(matches))
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
                input_el = page.locator(SELECTORS["message_input"]).first
                await input_el.wait_for(state="visible", timeout=5_000)
                await input_el.fill(message)
                await asyncio.sleep(random.uniform(0.5, 1.2))
                await page.locator(SELECTORS["send_button"]).first.click(timeout=3_000)
                logger.info("Message sent to match %s on Badoo.", match_id)
                return True
            except Exception as exc:
                logger.error("send_message to %s failed: %s", match_id, exc)
                return False

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_send())
        finally:
            loop.close()
