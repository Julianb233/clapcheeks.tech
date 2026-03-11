"""Sentry error monitoring for the Clapcheeks CLI agent.

Initializes Sentry from the user's config or environment.
Gracefully no-ops if SENTRY_DSN is not set.
"""
from __future__ import annotations

import os


def init_sentry() -> None:
    """Initialize Sentry SDK if DSN is available."""
    dsn = os.environ.get("SENTRY_DSN", "")

    # Also check ~/.clapcheeks/.env for DSN
    if not dsn:
        try:
            from pathlib import Path
            env_file = Path.home() / ".clapcheeks" / ".env"
            if env_file.exists():
                for line in env_file.read_text().splitlines():
                    if line.startswith("SENTRY_DSN="):
                        dsn = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except Exception:
            pass

    if not dsn:
        return

    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=dsn,
            environment=os.environ.get("ENVIRONMENT", "production"),
            traces_sample_rate=0.0,  # No performance tracing for CLI
            send_default_pii=False,
            # Tag all events from the CLI agent
            release=f"clapcheeks-agent@{_get_version()}",
        )
    except Exception:
        pass  # Silently fail — never crash the CLI for monitoring


def _get_version() -> str:
    try:
        from clapcheeks import __version__
        return __version__
    except Exception:
        return "unknown"
