"""Patched driver: use chromium.launch_persistent_context() which is the correct
API for --user-data-dir. Playwright >=1.40 rejects passing --user-data-dir as an
arg to chromium.launch() — it raises the error we were seeing on every 4h tick."""
from __future__ import annotations

from pathlib import Path

from clapcheeks.browser.stealth import StealthConfig, apply_stealth
from clapcheeks.browser.session import SessionStore

BROWSER_PROFILE_DIR = Path.home() / ".clapcheeks" / "browser-profile"


class BrowserDriver:
    """Launch and manage a Playwright Chromium persistent-context browser."""

    def __init__(self, platform: str, headless: bool = False) -> None:
        self.platform = platform
        self.headless = headless
        self.stealth = StealthConfig()
        self.session_store = SessionStore(platform)
        self._playwright = None
        self._context = None
        self._page = None

    async def launch(self):
        from playwright.async_api import async_playwright

        BROWSER_PROFILE_DIR.mkdir(parents=True, exist_ok=True)

        self._playwright = await async_playwright().start()

        launch_kwargs = dict(
            user_data_dir=str(BROWSER_PROFILE_DIR),
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
            viewport={
                "width": self.stealth.viewport_width,
                "height": self.stealth.viewport_height,
            },
            user_agent=self.stealth.user_agent,
            locale=self.stealth.locale,
            timezone_id=self.stealth.timezone_id,
        )

        # Prefer system Chrome, fall back to bundled Chromium
        try:
            self._context = await self._playwright.chromium.launch_persistent_context(
                channel="chrome",
                **launch_kwargs,
            )
        except Exception:
            self._context = await self._playwright.chromium.launch_persistent_context(
                **launch_kwargs,
            )

        await self.session_store.load(self._context)
        self._page = self._context.pages[0] if self._context.pages else await self._context.new_page()
        await apply_stealth(self._page)
        return self._page

    async def close(self) -> None:
        if self._context:
            await self.session_store.save(self._context)
            await self._context.close()
        if self._playwright:
            await self._playwright.stop()
        self._page = None
        self._context = None
        self._playwright = None

    async def __aenter__(self):
        return await self.launch()

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
