"""Async Playwright browser manager with anti-detection and session persistence."""
from __future__ import annotations

from clapcheeks.browser.stealth import StealthConfig, apply_stealth
from clapcheeks.browser.session import SessionStore


class BrowserDriver:
    """Launch and manage a Playwright Chromium browser with stealth settings."""

    def __init__(self, platform: str, headless: bool = False) -> None:
        self.platform = platform
        self.headless = headless
        self.stealth = StealthConfig()
        self.session_store = SessionStore(platform)
        self._playwright = None
        self._browser = None
        self._context = None
        self._page = None

    async def launch(self):
        """Start Playwright, launch Chromium with anti-detection, return Page."""
        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()
        self._browser = await self._playwright.chromium.launch(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        )
        self._context = await self._browser.new_context(
            viewport={
                "width": self.stealth.viewport_width,
                "height": self.stealth.viewport_height,
            },
            user_agent=self.stealth.user_agent,
            locale=self.stealth.locale,
            timezone_id=self.stealth.timezone_id,
        )

        await self.session_store.load(self._context)

        self._page = await self._context.new_page()
        await apply_stealth(self._page)

        return self._page

    async def close(self) -> None:
        """Save session, close browser, and stop Playwright."""
        if self._context:
            await self.session_store.save(self._context)
        if self._browser:
            await self._browser.close()
        if self._playwright:
            await self._playwright.stop()
        self._page = None
        self._context = None
        self._browser = None
        self._playwright = None

    async def __aenter__(self):
        return await self.launch()

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.close()
