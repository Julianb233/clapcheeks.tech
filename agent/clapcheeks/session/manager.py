"""SessionManager — orchestrates browser drivers per platform and mode."""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class SessionManager:
    """Manage automation sessions across platforms and modes."""

    def __init__(self, config: dict) -> None:
        self.config = config
        self._drivers: dict = {}

        # Detect mode
        if config.get("force_mode"):
            self.mode = config["force_mode"]
        else:
            from clapcheeks.modes.detect import detect_mode
            self.mode = detect_mode(config)

    def get_driver(self, platform: str = "tinder"):
        """Get or create a driver for the given platform.

        For mac-cloud mode, returns a Playwright BrowserDriver.
        For other modes, raises NotImplementedError.
        """
        if platform in self._drivers:
            return self._drivers[platform]

        if self.mode == "mac-cloud":
            from clapcheeks.browser.driver import BrowserDriver

            driver = BrowserDriver(platform=platform, headless=False)
            loop = asyncio.new_event_loop()
            page = loop.run_until_complete(driver.launch())
            self._drivers[platform] = driver
            return driver
        else:
            raise NotImplementedError(
                f"Mode '{self.mode}' is not yet supported. "
                "Use --mode mac-cloud or configure mac-cloud mode."
            )

    def close_all(self) -> None:
        """Close all cached browser drivers."""
        loop = asyncio.new_event_loop()
        for platform, driver in self._drivers.items():
            try:
                loop.run_until_complete(driver.close())
            except Exception as exc:
                logger.warning("Failed to close driver for %s: %s", platform, exc)
        loop.close()
        self._drivers.clear()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close_all()
