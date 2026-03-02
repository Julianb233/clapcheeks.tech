"""Mac Cloud mode driver — Browserbase cloud browser.

No iPhone required. Used when:
  - No iPhone is connected/reachable
  - User explicitly chooses cloud mode
  - As fallback if iPhone modes fail

Uses Browserbase to run a real Chromium browser in the cloud.
Great for Bumble (API too fragile) and Tinder/Hinge auth token refresh.
"""
from __future__ import annotations

import logging
import os
import time

logger = logging.getLogger(__name__)

BROWSERBASE_WS_URL = "wss://connect.browserbase.com"

PLATFORM_URLS = {
    "tinder": "https://tinder.com/app/recs",
    "bumble": "https://bumble.com/en/app",
    "hinge":  "https://hinge.co/app",
}


class MacCloudDriver:
    """Automates dating apps via Browserbase cloud browser.

    Implements the same swipe_right/swipe_left/send_message interface
    as the iPhone drivers so platform code is mode-agnostic.
    """

    def __init__(self, platform: str, api_key: str = "") -> None:
        self.platform = platform
        self.api_key = api_key or os.environ.get("BROWSERBASE_API_KEY", "")
        self._browser = None
        self._page = None
        self._session_id: str | None = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.disconnect()

    def connect(self) -> None:
        """Launch a Browserbase cloud browser session."""
        if not self.api_key:
            raise ValueError(
                "Browserbase API key not set.\n"
                "Get one at https://browserbase.com and run: outward setup"
            )

        try:
            from browserbase import Browserbase
            from playwright.sync_api import sync_playwright
        except ImportError:
            raise RuntimeError(
                "Install: pip install browserbase playwright && "
                "python -m playwright install chromium"
            )

        logger.info("Creating Browserbase session for %s...", self.platform)

        bb = Browserbase(api_key=self.api_key)
        session = bb.sessions.create(project_id=None)
        self._session_id = session.id

        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.connect_over_cdp(
            f"{BROWSERBASE_WS_URL}?apiKey={self.api_key}&sessionId={self._session_id}"
        )

        context = self._browser.contexts[0]
        self._page = context.new_page()

        platform_url = PLATFORM_URLS.get(self.platform, "https://tinder.com")
        logger.info("Navigating to %s", platform_url)
        self._page.goto(platform_url, wait_until="domcontentloaded", timeout=30_000)

        # Allow time for dynamic content
        time.sleep(3)

    def disconnect(self) -> None:
        try:
            if self._browser:
                self._browser.close()
            if self._pw:
                self._pw.stop()
        except Exception:
            pass
        self._browser = None
        self._page = None

    def swipe_right(self) -> bool:
        """Click the Like button on the web UI."""
        return self._click_action_button("like")

    def swipe_left(self) -> bool:
        """Click the Pass/Nope button on the web UI."""
        return self._click_action_button("pass")

    def _click_action_button(self, action: str) -> bool:
        if not self._page:
            return False
        try:
            import random

            # Tinder web selectors (updated based on current UI)
            selectors = {
                "tinder": {
                    "like": '[aria-label="Like"]',
                    "pass": '[aria-label="Nope"]',
                },
                "bumble": {
                    "like": '[data-qa-role="encounters-action-like"]',
                    "pass": '[data-qa-role="encounters-action-dislike"]',
                },
                "hinge": {
                    "like": '[aria-label="Like"]',
                    "pass": '[aria-label="Skip"]',
                },
            }

            platform_selectors = selectors.get(self.platform, selectors["tinder"])
            selector = platform_selectors.get(action)
            if not selector:
                return False

            btn = self._page.wait_for_selector(selector, timeout=8_000)
            if btn:
                # Move mouse to button naturally before clicking
                btn.hover()
                time.sleep(random.uniform(0.1, 0.4))
                btn.click()
                return True
        except Exception as exc:
            logger.warning("Cloud swipe (%s) failed: %s", action, exc)
        return False

    def send_message(self, text: str) -> bool:
        """Type and send a message in an open conversation."""
        if not self._page:
            return False
        try:
            import random

            # Click message input
            field = self._page.wait_for_selector(
                "textarea, [role='textbox'], [data-qa-role='message-input']",
                timeout=8_000
            )
            field.click()
            time.sleep(random.uniform(0.3, 0.8))

            # Type with human-like delays between characters
            for char in text:
                field.type(char, delay=random.randint(40, 120))

            time.sleep(random.uniform(0.5, 1.5))

            # Send
            send_btn = self._page.query_selector(
                '[aria-label="Send"], [data-qa-role="send-message"]'
            )
            if send_btn:
                send_btn.click()
                return True

            # Fallback: press Enter
            field.press("Enter")
            return True
        except Exception as exc:
            logger.error("Cloud send_message failed: %s", exc)
            return False

    def extract_auth_token(self) -> str | None:
        """Extract the Tinder auth token from browser localStorage.

        Used by the API client to avoid re-authenticating via browser
        on subsequent runs.
        """
        if self.platform != "tinder" or not self._page:
            return None
        try:
            token = self._page.evaluate(
                "() => localStorage.getItem('TinderWeb/access-token')"
            )
            if token:
                logger.info("Extracted Tinder auth token from localStorage")
            return token
        except Exception as exc:
            logger.warning("Could not extract auth token: %s", exc)
            return None

    def screenshot(self) -> bytes | None:
        if not self._page:
            return None
        try:
            return self._page.screenshot()
        except Exception:
            return None

    def get_session_url(self) -> str | None:
        """Get the Browserbase live view URL for debugging."""
        if self._session_id and self.api_key:
            return f"https://browserbase.com/sessions/{self._session_id}"
        return None

    @property
    def is_connected(self) -> bool:
        return self._page is not None
