"""Hinge browser automation — feed iteration with AI prompt comments."""
from __future__ import annotations

import logging
import random
import time

import requests as _requests

logger = logging.getLogger("clapcheeks.hinge")

# Centralized selectors — Hinge changes its DOM frequently.
SELECTORS = {
    "feed": '[class*="feed"], [data-testid*="feed"], main',
    "card": '[class*="profile"], [data-testid*="profile"], [data-testid*="card"]',
    "name": '[data-testid*="name"], h1, [class*="name"]',
    "prompt_block": '[class*="prompt"], [data-testid*="prompt"]',
    "prompt_question": '[class*="prompt-question"], [data-testid*="prompt-question"]',
    "prompt_answer": (
        '[class*="prompt-answer"], [data-testid*="prompt-answer"], '
        '[class*="prompt-response"]'
    ),
    "photo": (
        'img[class*="photo"], [data-testid*="photo"] img, '
        'img[class*="profile"]'
    ),
    "like_btn": (
        'button[aria-label*="Like"], [data-testid*="like"], '
        'button[class*="like"]'
    ),
    "skip_btn": (
        'button[aria-label*="Skip"], button[aria-label*="Remove"], '
        '[data-testid*="skip"], [data-testid*="remove"]'
    ),
    "comment_input": (
        'textarea[class*="comment"], [data-testid*="comment-input"], '
        'textarea[placeholder*="comment"], textarea[placeholder*="Add a comment"]'
    ),
    "comment_btn": (
        '[data-testid*="Add a comment"], button[aria-label*="comment"], '
        '[class*="add-comment"]'
    ),
    "send_btn": (
        'button[aria-label*="Send"], [data-testid*="send"], '
        'button[type="submit"]'
    ),
}

DAILY_LIKE_LIMIT = 50
HINGE_URL = "https://hinge.co/app"

# AI system prompt for generating comments on Hinge prompts.
_SYSTEM_PROMPT = (
    "You are a witty, charming person on a dating app. Write a short comment "
    "(1-2 sentences max) responding to someone's Hinge prompt. Be genuine, "
    "playful, and specific to what they wrote. Never be generic, creepy, or "
    "use pickup lines. Match the energy of what they wrote."
)

_STRICT_SUFFIX = " Keep it to ONE sentence, no emojis."


class HingeClient:
    """Automate Hinge feed browsing with AI-powered prompt comments."""

    def __init__(self, driver, ai_service_url=None) -> None:
        self.driver = driver
        self.ai_service_url = ai_service_url
        self._page = None
        self.liked = 0
        self.passed = 0
        self.errors = 0
        self.commented = 0

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
        """Navigate to Hinge and wait for manual login if needed.

        Returns True when the feed is detected.
        Raises TimeoutError if login times out after 120 seconds.
        """
        import asyncio

        page = self._get_page()

        async def _login() -> bool:
            await page.goto(HINGE_URL, wait_until="domcontentloaded")

            # Check if already logged in
            try:
                await page.locator(SELECTORS["feed"]).first.wait_for(
                    state="visible", timeout=5_000,
                )
                logger.info("Already logged in to Hinge.")
                return True
            except Exception:
                pass

            # Not logged in — manual auth required
            print(
                "\n=== Hinge Login Required ===\n"
                "Please log in to Hinge in the browser window. Waiting...\n"
            )

            for _ in range(40):
                await asyncio.sleep(3)
                try:
                    await page.locator(SELECTORS["feed"]).first.wait_for(
                        state="visible", timeout=2_000,
                    )
                    logger.info("Hinge login detected.")
                    return True
                except Exception:
                    continue

            raise TimeoutError("Hinge login timed out after 120 seconds.")

        loop = asyncio.new_event_loop()
        try:
            result = loop.run_until_complete(_login())
            # Human-like pause after login
            time.sleep(random.uniform(2.0, 5.0))
            return result
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
        """Execute a Hinge like/skip session. Returns stats dict."""
        import asyncio

        self.login()

        # Rate-limit check
        from clapcheeks.session.rate_limiter import get_daily_summary, record_swipe

        daily = get_daily_summary() or {}
        used_today = daily.get("hinge_right", 0)
        remaining = max(0, DAILY_LIKE_LIMIT - used_today)
        effective_max = min(max_swipes, remaining, DAILY_LIKE_LIMIT)

        if remaining <= 0:
            logger.warning("Daily like limit reached (50/day).")
            return {"liked": 0, "passed": 0, "errors": 0, "commented": 0}

        page = self._get_page()

        async def _session_loop() -> None:
            for i in range(effective_max):
                try:
                    # Wait for a profile card
                    try:
                        await page.locator(SELECTORS["card"]).first.wait_for(
                            state="visible", timeout=10_000,
                        )
                    except Exception:
                        logger.info("No more profiles in feed, ending session.")
                        break

                    card = await self._get_current_card(page)

                    # Decide: comment on prompt, like photo, or skip
                    if (
                        card["has_prompt"]
                        and random.random() < like_ratio
                        and self.ai_service_url
                    ):
                        await self._like_with_comment(page, card)
                    elif random.random() < like_ratio:
                        await self._like_photo(page, card)
                    else:
                        await self._skip(page, card)

                    # Record like in rate limiter
                    if self.liked + self.commented > (
                        daily.get("hinge_right", 0)
                    ):
                        record_swipe("hinge", "right")

                    # Human-like delay between actions
                    await asyncio.sleep(random.uniform(1.5, 4.0))

                except Exception as exc:
                    logger.warning("Feed iteration %d failed: %s", i, exc)
                    self.errors += 1
                    continue

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_session_loop())
        finally:
            loop.close()

        return {
            "liked": self.liked,
            "passed": self.passed,
            "errors": self.errors,
            "commented": self.commented,
        }

    # ------------------------------------------------------------------
    # Card extraction
    # ------------------------------------------------------------------

    @staticmethod
    async def _get_current_card(page) -> dict:
        """Extract profile data from the currently visible card."""
        card: dict = {
            "has_prompt": False,
            "prompt_text": None,
            "prompt_response": None,
            "photos": [],
            "name": None,
        }

        # Name
        try:
            name_el = page.locator(SELECTORS["name"]).first
            card["name"] = (
                await name_el.text_content(timeout=3_000) or ""
            ).strip()
        except Exception:
            pass

        # Prompt
        try:
            prompt_block = page.locator(SELECTORS["prompt_block"]).first
            await prompt_block.wait_for(state="visible", timeout=2_000)
            card["has_prompt"] = True

            try:
                q_el = page.locator(SELECTORS["prompt_question"]).first
                card["prompt_text"] = (
                    await q_el.text_content(timeout=2_000) or ""
                ).strip()
            except Exception:
                pass

            try:
                a_el = page.locator(SELECTORS["prompt_answer"]).first
                card["prompt_response"] = (
                    await a_el.text_content(timeout=2_000) or ""
                ).strip()
            except Exception:
                pass
        except Exception:
            pass

        # Photos
        try:
            photo_els = page.locator(SELECTORS["photo"])
            count = await photo_els.count()
            for idx in range(min(count, 6)):
                src = await photo_els.nth(idx).get_attribute(
                    "src", timeout=1_000,
                )
                if src:
                    card["photos"].append(src)
        except Exception:
            pass

        return card

    # ------------------------------------------------------------------
    # Actions
    # ------------------------------------------------------------------

    async def _like_photo(self, page, card: dict) -> None:
        """Like the current profile by clicking the like/heart button."""
        await page.locator(SELECTORS["like_btn"]).first.click(timeout=10_000)
        self.liked += 1
        logger.info("Liked photo for %s", card.get("name", "unknown"))

    async def _skip(self, page, card: dict) -> None:
        """Skip the current profile."""
        await page.locator(SELECTORS["skip_btn"]).first.click(timeout=10_000)
        self.passed += 1
        logger.info("Skipped %s", card.get("name", "unknown"))

    # ------------------------------------------------------------------
    # AI prompt comment generation
    # ------------------------------------------------------------------

    def _generate_prompt_comment(
        self, prompt_text: str, prompt_response: str | None = None,
    ) -> str | None:
        """Generate a short AI comment for a Hinge prompt.

        Returns the comment string or None if AI is unavailable.
        """
        if not self.ai_service_url:
            return None

        user_prompt = f"Their prompt: {prompt_text}"
        if prompt_response:
            user_prompt += f"\nTheir answer: {prompt_response}"

        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        payload = {
            "model": "llama3.2",
            "messages": messages,
            "stream": False,
            "options": {"temperature": 0.8, "num_predict": 100},
        }

        try:
            resp = _requests.post(
                self.ai_service_url, json=payload, timeout=10,
            )
            resp.raise_for_status()
            comment = resp.json()["message"]["content"].strip()

            # Truncate to 150 chars
            if len(comment) > 150:
                comment = comment[:147] + "..."

            # Quality gate: reject if too many emojis, quotes, or >2 sentences
            emoji_count = sum(1 for c in comment if ord(c) > 0x1F600)
            sentence_count = (
                comment.count(".") + comment.count("!") + comment.count("?")
            )
            if emoji_count >= 3 or sentence_count > 2 or '"' in comment:
                # Regenerate with stricter prompt
                strict_messages = [
                    {"role": "system", "content": _SYSTEM_PROMPT + _STRICT_SUFFIX},
                    {"role": "user", "content": user_prompt},
                ]
                payload["messages"] = strict_messages
                resp = _requests.post(
                    self.ai_service_url, json=payload, timeout=10,
                )
                resp.raise_for_status()
                comment = resp.json()["message"]["content"].strip()
                if len(comment) > 150:
                    comment = comment[:147] + "..."

            return comment

        except Exception as exc:
            logger.warning("AI comment generation failed: %s", exc)
            return None

    async def _like_with_comment(self, page, card: dict) -> None:
        """Like a prompt with an AI-generated comment.

        Falls back to _like_photo if comment generation or UI interaction fails.
        """
        comment = self._generate_prompt_comment(
            card["prompt_text"], card.get("prompt_response"),
        )

        if comment is None:
            await self._like_photo(page, card)
            return

        try:
            # Click "Add a comment" button if present
            try:
                comment_btn = page.locator(SELECTORS["comment_btn"]).first
                await comment_btn.click(timeout=5_000)
            except Exception:
                pass  # Input may already be visible

            # Fill in the comment
            input_el = page.locator(SELECTORS["comment_input"]).first
            await input_el.wait_for(state="visible", timeout=5_000)
            await input_el.fill(comment)

            # Small delay to simulate typing
            time.sleep(random.uniform(0.3, 0.8))

            # Submit
            await page.locator(SELECTORS["send_btn"]).first.click(
                timeout=5_000,
            )

            self.liked += 1
            self.commented += 1
            logger.info(
                "Liked with comment for %s: %s",
                card.get("name", "unknown"),
                comment[:50] + "..." if len(comment) > 50 else comment,
            )

        except Exception as exc:
            logger.warning(
                "Comment interaction failed, falling back to photo like: %s",
                exc,
            )
            await self._like_photo(page, card)
