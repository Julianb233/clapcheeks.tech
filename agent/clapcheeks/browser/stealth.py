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


async def random_delay(min_s: float = 0.5, max_s: float = 2.5) -> None:
    """Sleep a random duration with jitter to avoid uniform distributions."""
    delay = random.uniform(min_s, max_s)
    # Add jitter to avoid perfectly uniform distributions
    delay *= random.uniform(0.8, 1.2)
    # Clamp so jitter doesn't go below minimum
    delay = max(min_s, min(max_s * 1.2, delay))
    await asyncio.sleep(delay)


async def human_mouse_move(page, target, steps: int = 10) -> None:
    """Move mouse to target element in an arc with slight random offsets."""
    box = await target.bounding_box()
    if box is None:
        await target.click()
        return

    target_x = box["x"] + box["width"] / 2
    target_y = box["y"] + box["height"] / 2

    # Start from origin (0,0) — Playwright doesn't expose current mouse pos
    start_x, start_y = 0.0, 0.0

    for i in range(steps):
        t = (i + 1) / steps
        x = start_x + (target_x - start_x) * t + random.uniform(-2, 2)
        y = start_y + (target_y - start_y) * t + random.uniform(-3, 3)
        await page.mouse.move(x, y)
        await asyncio.sleep(random.uniform(0.01, 0.03))

    await target.click()
