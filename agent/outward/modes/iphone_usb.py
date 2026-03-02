"""iPhone USB mode driver — Appium XCUITest over USB cable.

Most reliable mode. Requires:
  - iPhone connected via USB
  - Appium server running (started by session manager)
  - xcuitest driver installed (appium driver install xcuitest)
  - Xcode + Apple Developer account for WDA signing
"""
from __future__ import annotations

import logging
import time

logger = logging.getLogger(__name__)

APPIUM_URL = "http://localhost:4723"
WDA_PORT = 8100

# App bundle IDs
BUNDLE_IDS = {
    "tinder": "com.cardify.tinder",
    "bumble": "com.bumble.app",
    "hinge":  "co.hinge.app",
}


class iPhoneUSBDriver:
    """Automates a dating app on a USB-connected iPhone via Appium XCUITest."""

    def __init__(self, platform: str, udid: str | None = None) -> None:
        self.platform = platform
        self.udid = udid
        self._driver = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.disconnect()

    def connect(self) -> None:
        """Start Appium session with the connected iPhone."""
        try:
            from appium import webdriver
            from appium.options.ios import XCUITestOptions
        except ImportError:
            raise RuntimeError(
                "Appium-Python-Client not installed. Run: pip install Appium-Python-Client"
            )

        bundle_id = BUNDLE_IDS.get(self.platform)
        if not bundle_id:
            raise ValueError(f"Unknown platform: {self.platform}")

        options = XCUITestOptions()
        options.platform_name = "iOS"
        options.automation_name = "XCUITest"
        options.bundle_id = bundle_id
        options.wda_local_port = WDA_PORT
        options.no_reset = True           # Keep app state between sessions
        options.full_reset = False
        options.new_command_timeout = 300  # 5 min timeout for commands

        if self.udid:
            options.udid = self.udid

        logger.info("Connecting to iPhone via USB (platform=%s, udid=%s)", self.platform, self.udid)
        self._driver = webdriver.Remote(APPIUM_URL, options=options)
        logger.info("Appium session started: %s", self._driver.session_id)

    def disconnect(self) -> None:
        if self._driver:
            try:
                self._driver.quit()
            except Exception:
                pass
            self._driver = None

    def swipe_right(self) -> bool:
        """Swipe right (like) on the current profile."""
        return self._swipe(direction="right")

    def swipe_left(self) -> bool:
        """Swipe left (pass) on the current profile."""
        return self._swipe(direction="left")

    def _swipe(self, direction: str) -> bool:
        """Perform a swipe gesture on the profile card."""
        if not self._driver:
            return False
        try:
            size = self._driver.get_window_size()
            width = size["width"]
            height = size["height"]

            # Start from center, swipe left or right
            start_x = width // 2
            start_y = height // 2

            # Add small random offset to start point (human-like)
            import random
            start_x += random.randint(-20, 20)
            start_y += random.randint(-30, 30)

            if direction == "right":
                end_x = int(width * 0.85)
            else:
                end_x = int(width * 0.15)

            # Duration: 200-400ms, randomized
            duration = random.randint(200, 400)

            self._driver.swipe(start_x, start_y, end_x, start_y, duration)
            return True
        except Exception as exc:
            logger.error("Swipe failed: %s", exc)
            return False

    def get_current_profile(self) -> dict | None:
        """Extract profile info from the current card on screen."""
        if not self._driver:
            return None
        try:
            # Try to find name + age element (Tinder-style)
            elements = self._driver.find_elements(
                "class name", "XCUIElementTypeStaticText"
            )
            texts = [el.text for el in elements if el.text]
            if texts:
                return {"text_elements": texts[:5]}
        except Exception:
            pass
        return None

    def send_message(self, text: str) -> bool:
        """Send a message in an open conversation."""
        if not self._driver:
            return False
        try:
            # Find the message input field
            input_field = self._driver.find_element("class name", "XCUIElementTypeTextView")
            input_field.click()
            input_field.send_keys(text)

            # Find and tap send button
            send_btn = self._driver.find_element("accessibility id", "Send")
            send_btn.click()
            return True
        except Exception as exc:
            logger.error("Send message failed: %s", exc)
            return False

    def screenshot(self) -> bytes | None:
        """Capture a screenshot of the current app state."""
        if not self._driver:
            return None
        try:
            return self._driver.get_screenshot_as_png()
        except Exception:
            return None

    @property
    def is_connected(self) -> bool:
        return self._driver is not None
