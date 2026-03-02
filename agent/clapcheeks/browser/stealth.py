"""Anti-detection configuration for browser automation."""
from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field

REALISTIC_USER_AGENTS = [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
]


def _random_viewport() -> tuple[int, int]:
    width = random.randint(1280, 1920)
    # Pick either 16:9 or 16:10 ratio
    ratio = random.choice([9 / 16, 10 / 16])
    height = int(width * ratio)
    return width, height


@dataclass
class StealthConfig:
    viewport_width: int = field(default_factory=lambda: 0)
    viewport_height: int = field(default_factory=lambda: 0)
    user_agent: str = field(default_factory=lambda: random.choice(REALISTIC_USER_AGENTS))
    locale: str = "en-US"
    timezone_id: str = "America/Los_Angeles"

    def __post_init__(self) -> None:
        if self.viewport_width == 0 or self.viewport_height == 0:
            self.viewport_width, self.viewport_height = _random_viewport()


STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' });
Object.defineProperty(navigator, 'plugins', {
    get: () => [1, 2, 3, 4, 5],
});
"""


async def apply_stealth(page) -> None:
    """Inject anti-detection scripts into a Playwright page."""
    await page.add_init_script(STEALTH_INIT_SCRIPT)


async def human_delay() -> None:
    """Sleep a random human-like interval between actions."""
    await asyncio.sleep(random.uniform(0.5, 2.0))
