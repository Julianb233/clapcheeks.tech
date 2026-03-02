"""iPhone WiFi mode driver — Appium XCUITest over local WiFi network.

Cable-free after one-time USB setup. Requires:
  - WDA previously installed via USB (run setup wizard once with USB)
  - iPhone and Mac on the same WiFi network
  - WDA running on the phone (started by Appium on first USB session, persists)
  - phone_wifi_ip set in config (~/.outward/config.yaml)
"""
from __future__ import annotations

import logging
import random

logger = logging.getLogger(__name__)

APPIUM_URL = "http://localhost:4723"
WDA_PORT = 8100

BUNDLE_IDS = {
    "tinder": "com.cardify.tinder",
    "bumble": "com.bumble.app",
    "hinge":  "co.hinge.app",
}


class iPhoneWiFiDriver:
    """Automates a dating app on an iPhone over WiFi via WDA.

    Same interface as iPhoneUSBDriver — all platform code is
    mode-agnostic and works with either driver.
    """

    def __init__(self, platform: str, phone_ip: str) -> None:
        self.platform = platform
        self.phone_ip = phone_ip
        self._driver = None

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, *args):
        self.disconnect()

    def connect(self) -> None:
        """Start Appium session connecting to WDA over WiFi."""
        try:
            from appium import webdriver
            from appium.options.ios import XCUITestOptions
        except ImportError:
            raise RuntimeError("Run: pip install Appium-Python-Client")

        if not self.phone_ip:
            raise ValueError("phone_wifi_ip not set in config. Run: outward setup")

        bundle_id = BUNDLE_IDS.get(self.platform)
        if not bundle_id:
            raise ValueError(f"Unknown platform: {self.platform}")

        options = XCUITestOptions()
        options.platform_name = "iOS"
        options.automation_name = "XCUITest"
        options.bundle_id = bundle_id
        options.no_reset = True
        options.full_reset = False
        options.new_command_timeout = 300
        options.use_prebuilt_wda = True    # Don't rebuild WDA — use existing install

        # Key: tell Appium to connect to WDA on the phone's WiFi IP
        # instead of tunneling over USB
        options.set_capability("appium:wdaBaseUrl", f"http://{self.phone_ip}:{WDA_PORT}")

        logger.info(
            "Connecting to iPhone over WiFi (platform=%s, ip=%s:%d)",
            self.platform, self.phone_ip, WDA_PORT
        )
        self._driver = webdriver.Remote(APPIUM_URL, options=options)
        logger.info("WiFi session started: %s", self._driver.session_id)

    def disconnect(self) -> None:
        if self._driver:
            try:
                self._driver.quit()
            except Exception:
                pass
            self._driver = None

    def swipe_right(self) -> bool:
        return self._swipe("right")

    def swipe_left(self) -> bool:
        return self._swipe("left")

    def _swipe(self, direction: str) -> bool:
        if not self._driver:
            return False
        try:
            size = self._driver.get_window_size()
            w, h = size["width"], size["height"]

            sx = w // 2 + random.randint(-20, 20)
            sy = h // 2 + random.randint(-30, 30)
            ex = int(w * 0.85) if direction == "right" else int(w * 0.15)
            duration = random.randint(200, 400)

            self._driver.swipe(sx, sy, ex, sy, duration)
            return True
        except Exception as exc:
            logger.error("WiFi swipe failed: %s", exc)
            return False

    def get_current_profile(self) -> dict | None:
        if not self._driver:
            return None
        try:
            elements = self._driver.find_elements(
                "class name", "XCUIElementTypeStaticText"
            )
            texts = [el.text for el in elements if el.text]
            return {"text_elements": texts[:5]} if texts else None
        except Exception:
            return None

    def send_message(self, text: str) -> bool:
        if not self._driver:
            return False
        try:
            field = self._driver.find_element("class name", "XCUIElementTypeTextView")
            field.click()
            field.send_keys(text)
            btn = self._driver.find_element("accessibility id", "Send")
            btn.click()
            return True
        except Exception as exc:
            logger.error("WiFi send_message failed: %s", exc)
            return False

    def screenshot(self) -> bytes | None:
        if not self._driver:
            return None
        try:
            return self._driver.get_screenshot_as_png()
        except Exception:
            return None

    @property
    def is_connected(self) -> bool:
        return self._driver is not None
