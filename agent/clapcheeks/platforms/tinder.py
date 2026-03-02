"""Tinder browser automation — swipe loop with human-like behavior."""
from __future__ import annotations

import logging
import random
import time

logger = logging.getLogger(__name__)

# Centralized selectors for easy maintenance when Tinder changes its DOM.
SELECTORS = {
    "card": '[class*="recsCardboard"], [data-testid="gamepad"], [aria-label*="recommendation"]',
    "name": '[itemprop="name"], span[class*="Typs(display1)"]',
    "like": 'button[aria-label="Like"], [data-testid="gamepad-like"]',
    "nope": 'button[aria-label="Nope"], [data-testid="gamepad-nope"]',
    "match_modal": '[class*="matchAnimation"], [aria-label*="match"], :text("It\'s a Match")',
    "keep_swiping": '[aria-label*="Keep Swiping"], [aria-label*="Back to Tinder"]',
    "match_name": '[class*="matchName"], [data-testid="match-name"]',
    "message_input": 'textarea[placeholder*="message"], [data-testid="chat-input"], [aria-label*="message"]',
    "send_message": 'button[aria-label="Send"], [data-testid="send-button"]',
}


class TinderClient:
    """Automate Tinder swiping via a Playwright browser driver."""

    def __init__(self, driver) -> None:
        self.driver = driver
        self._page = None

    def _get_page(self):
        """Resolve the Playwright Page from the driver."""
        if self._page is not None:
            return self._page
        # BrowserDriver stores the page as ._page after launch()
        if hasattr(self.driver, "_page") and self.driver._page is not None:
            self._page = self.driver._page
        else:
            self._page = self.driver
        return self._page

    # ------------------------------------------------------------------
    # Login
    # ------------------------------------------------------------------

    def login(self) -> bool:
        """Navigate to Tinder and wait for manual login if needed.

        Returns True when the swipe UI is detected, False on timeout.
        """
        import asyncio

        page = self._get_page()

        async def _login() -> bool:
            await page.goto("https://tinder.com", wait_until="domcontentloaded")

            # Check if already logged in (swipe card visible)
            try:
                await page.locator(SELECTORS["card"]).first.wait_for(
                    state="visible", timeout=5_000,
                )
                logger.info("Already logged in to Tinder.")
                return True
            except Exception:
                pass

            # Not logged in — ask user to authenticate manually
            print(
                "\n=== Tinder Login Required ===\n"
                "Please log in manually in the browser window.\n"
                "Waiting up to 120 seconds for login...\n"
            )

            # Poll every 3 seconds for 120 seconds total
            for _ in range(40):
                await asyncio.sleep(3)
                try:
                    await page.locator(SELECTORS["card"]).first.wait_for(
                        state="visible", timeout=2_000,
                    )
                    logger.info("Tinder login detected.")
                    return True
                except Exception:
                    continue

            logger.warning("Tinder login timed out after 120 seconds.")
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
        """Execute a swiping session. Returns stats dict."""
        import asyncio

        # Login first
        if not self.login():
            return {"liked": 0, "passed": 0, "errors": 1, "new_matches": []}

        # Rate-limit check
        from clapcheeks.session.rate_limiter import get_daily_summary

        daily = get_daily_summary() or {}
        used_today = daily.get("tinder_right", 0) + daily.get("tinder_left", 0)
        remaining = max(0, 100 - used_today)
        max_swipes = min(max_swipes, remaining)

        if max_swipes <= 0:
            logger.warning("Daily swipe limit reached for Tinder (100/day).")
            return {"liked": 0, "passed": 0, "errors": 0, "new_matches": []}

        page = self._get_page()

        liked = 0
        passed = 0
        errors = 0
        new_matches: list[dict] = []

        async def _swipe_loop() -> None:
            nonlocal liked, passed, errors

            for i in range(max_swipes):
                try:
                    # Wait for a profile card to appear
                    try:
                        await page.locator(SELECTORS["card"]).first.wait_for(
                            state="visible", timeout=10_000,
                        )
                    except Exception:
                        logger.info("No more profiles available, ending session.")
                        break

                    # Extract minimal profile data (non-fatal)
                    profile_data = await self._extract_profile(page)

                    # Decide swipe direction
                    do_like = self._should_like(profile_data, like_ratio)

                    if do_like:
                        await page.locator(SELECTORS["like"]).first.click()
                        liked += 1
                    else:
                        await page.locator(SELECTORS["nope"]).first.click()
                        passed += 1

                    # Check for match modal
                    match_result = await self._detect_match_async(page, profile_data)
                    if match_result is not None:
                        new_matches.append(match_result)

                    # Human-like delay between swipes
                    await asyncio.sleep(random.uniform(0.5, 2.0))

                except Exception as exc:
                    logger.warning("Swipe iteration %d failed: %s", i, exc)
                    errors += 1
                    continue

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_swipe_loop())
        finally:
            loop.close()

        return {
            "liked": liked,
            "passed": passed,
            "errors": errors,
            "new_matches": new_matches,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    async def _extract_profile(page) -> dict:
        """Pull name and age from the current profile card. Non-fatal."""
        data: dict = {}
        try:
            name_el = page.locator(SELECTORS["name"]).first
            data["name"] = await name_el.text_content(timeout=2_000)
        except Exception:
            pass
        try:
            # Age is typically adjacent to the name
            age_el = page.locator('[itemprop="age"], span[class*="Typs(headline1)"]').first
            raw = await age_el.text_content(timeout=2_000)
            if raw:
                data["age"] = int("".join(c for c in raw if c.isdigit()) or "0")
        except Exception:
            pass
        return data

    @staticmethod
    def _should_like(profile_data: dict, like_ratio: float) -> bool:
        """Decide whether to like a profile based on age prefs and ratio."""
        from clapcheeks.profile import load_profile

        age = profile_data.get("age")
        if age and age > 0:
            prefs = load_profile()
            # Only enforce if user set non-default prefs
            if prefs.pref_age_min != 18 or prefs.pref_age_max != 99:
                if age < prefs.pref_age_min or age > prefs.pref_age_max:
                    return False

        return random.random() < like_ratio

    def _detect_match(self) -> str | None:
        """Synchronous wrapper for match detection."""
        import asyncio

        page = self._get_page()
        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(self._detect_match_async(page))
        finally:
            loop.close()

    @staticmethod
    async def _detect_match_async(page, profile_data: dict | None = None) -> dict | None:
        """Check for and dismiss a match modal. Returns match dict or None."""
        try:
            await page.locator(SELECTORS["match_modal"]).first.wait_for(
                state="visible", timeout=2_000,
            )
        except Exception:
            return None

        # Match found — extract name
        match_name = ""
        try:
            name_el = page.locator(SELECTORS["match_name"]).first
            match_name = (await name_el.text_content(timeout=2_000) or "").strip()
        except Exception:
            match_name = (profile_data or {}).get("name", "Unknown")

        logger.info("Match detected: %s", match_name)

        # Generate and send opener
        opener_text = ""
        try:
            from clapcheeks.ai.opener import generate_opener

            opener_text = generate_opener(match_name, profile_data)

            # Try to type and send the message
            msg_input = page.locator(SELECTORS["message_input"]).first
            await msg_input.wait_for(state="visible", timeout=3_000)
            await msg_input.fill(opener_text)

            send_btn = page.locator(SELECTORS["send_message"]).first
            await send_btn.click(timeout=2_000)
            logger.info("Opener sent to %s: %s", match_name, opener_text)
        except Exception as exc:
            logger.warning("Could not send opener to %s: %s", match_name, exc)
            # Dismiss modal — prefer Keep Swiping
            try:
                await page.locator(SELECTORS["keep_swiping"]).first.click(timeout=2_000)
            except Exception:
                pass

        return {"name": match_name, "opener": opener_text}
