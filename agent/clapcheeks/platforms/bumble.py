"""Bumble browser automation — swipe loop, Beehive queue, and AI openers."""
from __future__ import annotations

import asyncio
import logging
import random
import time

from clapcheeks.session.rate_limiter import can_swipe, record_swipe

logger = logging.getLogger(__name__)

# Centralized selectors — prefer data-qa-role, fall back to aria-label/class.
SELECTORS = {
    # Swipe card
    "card": '[data-qa-role="encounters-card"], .encounters-story-profile',
    "name": '[data-qa-role="encounters-card-name"], .encounters-story-profile__name',
    # Swipe actions
    "like": '[data-qa-role="encounters-action-like"], button.encounters-action--like',
    "dislike": '[data-qa-role="encounters-action-dislike"], button.encounters-action--dislike',
    # Match popup
    "match_modal": '[data-qa-role="match-popup"], .encounters-match',
    "match_dismiss": '[data-qa-role="match-popup-close"], .encounters-match__cta',
    # Chat / Beehive
    "chat_tab": '[data-qa-role="chat-list"], a[href*="/app/connections"]',
    "chat_item": '[data-qa-role="chat-list-item"], .contacts-item',
    "chat_item_name": '[data-qa-role="chat-list-item-name"], .contacts-item__name',
    "user_turn_badge": '[data-qa-role="your-turn"], .conversations-your-turn, :text("Your turn")',
    "expiry_timer": '.conversations-expiry, [data-qa-role="expiry-timer"]',
    # Messenger
    "message_input": '[data-qa-role="messenger-input"], textarea.messenger-input',
    "send_button": '[data-qa-role="messenger-send"], button.messenger-send',
}


class BumbleClient:
    """Automate Bumble swiping via a Playwright browser driver."""

    def __init__(self, driver) -> None:
        self.driver = driver
        self._page = None
        self.base_url = "https://bumble.com/app"

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
        """Navigate to Bumble and wait for manual login if needed.

        Returns True when the swipe UI is detected, False on timeout.
        """
        page = self._get_page()

        async def _login() -> bool:
            await page.goto(self.base_url, wait_until="domcontentloaded")

            # Check if already logged in (swipe card visible)
            try:
                await page.locator(SELECTORS["card"]).first.wait_for(
                    state="visible", timeout=5_000,
                )
                logger.info("Already logged in to Bumble.")
                return True
            except Exception:
                pass

            print(
                "\n=== Bumble Login Required ===\n"
                "Please log in manually in the browser window.\n"
                "Waiting up to 120 seconds for login...\n"
            )

            for _ in range(40):
                await asyncio.sleep(3)
                try:
                    await page.locator(SELECTORS["card"]).first.wait_for(
                        state="visible", timeout=2_000,
                    )
                    logger.info("Bumble login detected.")
                    return True
                except Exception:
                    continue

            logger.warning("Bumble login timed out after 120 seconds.")
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
        if not self.login():
            return {"liked": 0, "passed": 0, "errors": 1, "openers_sent": 0}

        from clapcheeks.session.rate_limiter import get_daily_summary

        daily = get_daily_summary() or {}
        used_right = daily.get("bumble_right", 0)
        used_left = daily.get("bumble_left", 0)
        # Enforce per-direction limits (right: 60, left: 250)
        right_remaining = max(0, 60 - used_right)
        left_remaining = max(0, 250 - used_left)
        total_remaining = right_remaining + left_remaining

        if total_remaining <= 0:
            logger.warning("Daily swipe limit reached for Bumble.")
            return {
                "liked": 0, "passed": 0, "errors": 0,
                "openers_sent": 0, "reason": "daily_limit",
            }

        max_swipes = min(max_swipes, total_remaining)

        page = self._get_page()
        liked = 0
        passed = 0
        errors = 0
        new_matches: list[dict] = []

        async def _swipe_loop() -> None:
            nonlocal liked, passed, errors

            pause_interval = random.randint(8, 15)

            for i in range(max_swipes):
                try:
                    # Wait for profile card
                    try:
                        await page.locator(SELECTORS["card"]).first.wait_for(
                            state="visible", timeout=10_000,
                        )
                    except Exception:
                        logger.info("No more profiles available, ending session.")
                        break

                    # Human-like pre-swipe delay
                    await asyncio.sleep(random.uniform(1.5, 4.0))

                    # Decide: slight per-decision jitter on like_ratio
                    effective_ratio = like_ratio + random.uniform(-0.05, 0.05)
                    do_like = random.random() < effective_ratio

                    # Enforce right-swipe limit
                    if do_like and not can_swipe("bumble", "right"):
                        logger.info("Right-swipe limit reached, passing instead.")
                        do_like = False

                    if not do_like and not can_swipe("bumble", "left"):
                        logger.info("Left-swipe limit reached, ending session.")
                        break

                    if do_like:
                        await page.locator(SELECTORS["like"]).first.click()
                        liked += 1
                        record_swipe("bumble", "right")
                    else:
                        await page.locator(SELECTORS["dislike"]).first.click()
                        passed += 1
                        record_swipe("bumble", "left")

                    # Check for match popup after like
                    if do_like:
                        match_data = await _check_match_popup(page)
                        if match_data:
                            new_matches.append(match_data)

                    # Inter-swipe delay
                    await asyncio.sleep(random.uniform(0.8, 2.5))

                    # Periodic longer pause for human-like behavior
                    if (i + 1) % pause_interval == 0:
                        pause = random.uniform(5.0, 15.0)
                        logger.debug(
                            "Taking a %.1fs break at swipe %d", pause, i + 1,
                        )
                        await asyncio.sleep(pause)
                        pause_interval = random.randint(8, 15)

                except Exception as exc:
                    logger.warning("Swipe iteration %d failed: %s", i, exc)
                    errors += 1
                    continue

        async def _check_match_popup(page) -> dict | None:
            try:
                await page.locator(SELECTORS["match_modal"]).first.wait_for(
                    state="visible", timeout=2_000,
                )
            except Exception:
                return None

            match_name = "Unknown"
            try:
                name_el = page.locator(SELECTORS["name"]).first
                match_name = (
                    await name_el.text_content(timeout=2_000) or ""
                ).strip()
            except Exception:
                pass

            logger.info("Match detected: %s", match_name)

            # Dismiss match modal
            try:
                await page.locator(SELECTORS["match_dismiss"]).first.click(
                    timeout=2_000,
                )
            except Exception:
                pass

            return {"name": match_name}

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_swipe_loop())
        finally:
            loop.close()

        # Post-swipe: check beehive and send openers
        openers_sent = self._send_pending_openers()

        return {
            "liked": liked,
            "passed": passed,
            "errors": errors,
            "openers_sent": openers_sent,
            "new_matches": new_matches,
        }

    # ------------------------------------------------------------------
    # Beehive queue
    # ------------------------------------------------------------------

    def check_beehive(self) -> list[dict]:
        """Scan the Beehive match queue and return actionable matches.

        Returns only matches where it is the user's turn to message.
        """
        page = self._get_page()

        async def _scan() -> list[dict]:
            # Navigate to matches/connections
            try:
                await page.locator(SELECTORS["chat_tab"]).first.click(
                    timeout=5_000,
                )
                await asyncio.sleep(random.uniform(1.5, 3.0))
            except Exception as exc:
                logger.warning("Could not navigate to Beehive: %s", exc)
                return []

            items = page.locator(SELECTORS["chat_item"])
            count = await items.count()
            logger.info("Found %d matches in Beehive queue.", count)

            actionable: list[dict] = []
            for idx in range(count):
                item = items.nth(idx)
                match: dict = {
                    "name": "",
                    "user_turn": False,
                    "expires_in": None,
                }

                # Extract name
                try:
                    name_el = item.locator(SELECTORS["chat_item_name"]).first
                    match["name"] = (
                        await name_el.text_content(timeout=2_000) or ""
                    ).strip()
                except Exception:
                    pass

                # Detect user's turn
                try:
                    turn_el = item.locator(SELECTORS["user_turn_badge"]).first
                    await turn_el.wait_for(state="visible", timeout=500)
                    match["user_turn"] = True
                except Exception:
                    pass

                # Detect expiry timer
                try:
                    expiry_el = item.locator(SELECTORS["expiry_timer"]).first
                    match["expires_in"] = (
                        await expiry_el.text_content(timeout=500) or ""
                    ).strip() or None
                except Exception:
                    pass

                # Store index for clicking later
                match["_element_index"] = idx

                if match["user_turn"]:
                    actionable.append(match)

            logger.info(
                "%d actionable matches (user's turn) out of %d total.",
                len(actionable), count,
            )
            return actionable

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_scan())
        finally:
            loop.close()

    # ------------------------------------------------------------------
    # Opener messaging
    # ------------------------------------------------------------------

    def send_opener(self, match: dict) -> str | None:
        """Open a conversation and send an AI-generated first message.

        Returns the opener text on success, None on failure.
        """
        page = self._get_page()

        async def _send() -> str | None:
            # Click on the match in the list
            try:
                items = page.locator(SELECTORS["chat_item"])
                idx = match.get("_element_index", 0)
                await items.nth(idx).click(timeout=3_000)
                await asyncio.sleep(random.uniform(1.0, 2.0))
            except Exception as exc:
                logger.warning(
                    "Could not open conversation with %s: %s",
                    match.get("name"), exc,
                )
                return None

            # Wait for message input
            try:
                await page.locator(SELECTORS["message_input"]).first.wait_for(
                    state="visible", timeout=5_000,
                )
            except Exception as exc:
                logger.warning(
                    "Message input not visible for %s: %s",
                    match.get("name"), exc,
                )
                return None

            # Generate opener via AI
            from clapcheeks.ai.opener import generate_opener

            opener = generate_opener(
                match_name=match.get("name", ""),
                profile_data={
                    "name": match.get("name", ""),
                    "platform": "bumble",
                },
            )

            # Type with human-like keystroke delays
            try:
                await page.type(
                    SELECTORS["message_input"],
                    opener,
                    delay=random.randint(30, 80),
                )
                await asyncio.sleep(random.uniform(0.5, 1.0))

                await page.locator(SELECTORS["send_button"]).first.click(
                    timeout=3_000,
                )
                await asyncio.sleep(random.uniform(1.0, 2.0))
                logger.info("Opener sent to %s: %s", match.get("name"), opener)
            except Exception as exc:
                logger.warning(
                    "Failed to send opener to %s: %s", match.get("name"), exc,
                )
                return None

            # Navigate back to match list
            try:
                await page.locator(SELECTORS["chat_tab"]).first.click(
                    timeout=3_000,
                )
                await asyncio.sleep(random.uniform(1.0, 2.0))
            except Exception:
                pass

            return opener

        loop = asyncio.new_event_loop()
        try:
            return loop.run_until_complete(_send())
        finally:
            loop.close()

    def _send_pending_openers(self) -> int:
        """Check Beehive and send openers to actionable matches.

        Called at the end of run_swipe_session().
        Capped at 5 openers per session to avoid anti-spam detection.
        """
        matches = self.check_beehive()
        if not matches:
            return 0

        max_openers = 5
        sent = 0

        for match in matches[:max_openers]:
            result = self.send_opener(match)
            if result is not None:
                sent += 1
            # Longer delay between openers to avoid detection
            time.sleep(random.uniform(10.0, 30.0))

        logger.info(
            "Sent %d openers out of %d actionable matches.", sent, len(matches),
        )
        return sent

    # ------------------------------------------------------------------
    # AI-8808 — Reaction stub
    # ------------------------------------------------------------------

    def send_reaction(
        self,
        match_id: str,
        target_message_id: str,
        kind: str,
    ) -> None:
        """React to a Bumble message.

        Bumble does not expose a message reaction API in its public or
        semi-public web/mobile surface. This is a no-op stub (logs + returns)
        rather than a ``NotImplementedError`` because Bumble is a lower-
        priority platform and callers should degrade gracefully.

        Tagged AI-8808-followup for investigation when Bumble's private API
        is better mapped.
        """
        logger.warning(
            "send_reaction: Bumble message reactions are not implemented "
            "(match_id=%s target_message_id=%s kind=%s). "
            "Reaction silently dropped — AI-8808-followup.",
            match_id, target_message_id, kind,
        )
