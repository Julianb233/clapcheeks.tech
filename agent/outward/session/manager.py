"""Session manager — orchestrates mode selection and platform routing."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from outward.modes import MODE_CLOUD, MODE_USB, MODE_WIFI
from outward.modes.detect import detect_mode

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class SessionManager:
    """Manages the automation session lifecycle for all platforms.

    Picks the right mode, starts required services, and provides
    a unified interface for platform automation.
    """

    def __init__(self, config: dict) -> None:
        self.config = config
        self._mode: str | None = None
        self._appium_proc = None

    @property
    def mode(self) -> str:
        if self._mode is None:
            self._mode = detect_mode(self.config, force=self.config.get("force_mode"))
        return self._mode

    def start(self) -> None:
        """Start required services for the selected mode."""
        logger.info("Starting session in mode: %s", self.mode)

        if self.mode in (MODE_USB, MODE_WIFI):
            self._start_appium()

    def stop(self) -> None:
        """Gracefully stop all services."""
        if self._appium_proc:
            self._appium_proc.terminate()
            self._appium_proc = None
            logger.info("Appium server stopped.")

    def _start_appium(self) -> None:
        from outward.setup.wda import start_appium_server
        self._appium_proc = start_appium_server()
        if not self._appium_proc:
            logger.warning("Appium failed to start — falling back to cloud mode")
            self._mode = MODE_CLOUD

    def get_driver(self, platform: str):
        """Get the appropriate automation driver for a platform + mode."""
        from outward.modes.detect import get_phone_udid

        if self.mode == MODE_USB:
            from outward.modes.iphone_usb import iPhoneUSBDriver
            udid = self.config.get("phone_udid") or get_phone_udid()
            return iPhoneUSBDriver(platform=platform, udid=udid)

        elif self.mode == MODE_WIFI:
            from outward.modes.iphone_wifi import iPhoneWiFiDriver
            phone_ip = self.config.get("phone_wifi_ip", "")
            return iPhoneWiFiDriver(platform=platform, phone_ip=phone_ip)

        else:
            from outward.modes.mac_cloud import MacCloudDriver
            api_key = self.config.get("browserbase_api_key", "")
            return MacCloudDriver(platform=platform, api_key=api_key)

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *args):
        self.stop()
