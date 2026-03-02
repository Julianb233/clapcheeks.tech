"""Persist and restore browser context (cookies, localStorage) per platform."""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SESSION_DIR = Path.home() / ".clapcheeks" / "sessions"


class SessionStore:
    """Save and load browser session data for a specific platform."""

    def __init__(self, platform: str) -> None:
        self.platform = platform
        self.path = SESSION_DIR / f"{platform}.json"
        SESSION_DIR.mkdir(parents=True, exist_ok=True)

    async def save(self, context) -> None:
        """Extract cookies from browser context and save to JSON."""
        try:
            cookies = await context.cookies()
            self.path.write_text(json.dumps(cookies, indent=2))
            logger.debug("Saved %d cookies for %s", len(cookies), self.platform)
        except Exception as exc:
            logger.warning("Failed to save session for %s: %s", self.platform, exc)

    async def load(self, context) -> None:
        """Load cookies from JSON and add to browser context."""
        if not self.path.exists():
            logger.debug("No saved session for %s", self.platform)
            return
        try:
            cookies = json.loads(self.path.read_text())
            if cookies:
                await context.add_cookies(cookies)
                logger.debug("Loaded %d cookies for %s", len(cookies), self.platform)
        except (json.JSONDecodeError, TypeError, KeyError) as exc:
            logger.warning(
                "Corrupt session file for %s, starting fresh: %s",
                self.platform,
                exc,
            )
        except Exception as exc:
            logger.warning("Failed to load session for %s: %s", self.platform, exc)
