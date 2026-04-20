"""Platform automation clients.

Two backends per dating app:
    - browser: Playwright automation (default fallback)
    - api:     iPhone-style REST/protobuf client (faster, less detectable)

Pick one via env vars:
    CLAPCHEEKS_HINGE_MODE   = api | browser
    CLAPCHEEKS_TINDER_MODE  = api | browser

If unset:
    - Hinge defaults to `api` when HINGE_AUTH_TOKEN is present, else `browser`.
    - Tinder defaults to `browser` until the protobuf schemas are wired up,
      even if TINDER_AUTH_TOKEN is set. Set CLAPCHEEKS_TINDER_MODE=api to opt in.

Use `get_platform_client(platform, driver, ...)` — don't import the classes
directly, so the factory can swap backends at runtime.
"""
from __future__ import annotations

import logging
import os
from typing import Any

# Keep these imports lazy / defensive — some backends need extra deps
# (requests is in base requirements; playwright is optional).
try:
    from clapcheeks.platforms.tinder import TinderClient
except ImportError:
    TinderClient = None  # type: ignore

try:
    from clapcheeks.platforms.bumble import BumbleClient
except ImportError:
    BumbleClient = None  # type: ignore

try:
    from clapcheeks.platforms.hinge import HingeClient
except ImportError:
    HingeClient = None  # type: ignore

try:
    from clapcheeks.platforms.grindr import GrindrClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.badoo import BadooClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.happn import HappnClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.okcupid import OKCupidClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.pof import POFClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.feeld import FeeldClient
except ImportError:
    pass

try:
    from clapcheeks.platforms.coffeemeetsbagel import CMBClient
except ImportError:
    pass


logger = logging.getLogger("clapcheeks.platforms")


def _resolve_mode(platform: str, token_env: str) -> str:
    """Return 'api' or 'browser' based on explicit env or token presence."""
    override = os.environ.get(f"CLAPCHEEKS_{platform.upper()}_MODE", "").strip().lower()
    if override in {"api", "browser"}:
        return override
    return "api" if os.environ.get(token_env) else "browser"


def get_platform_client(platform: str, driver: Any = None, **kwargs: Any) -> Any:
    """Return the appropriate platform client (API or browser).

    Args:
        platform: one of 'tinder', 'bumble', 'hinge', 'grindr', ...
        driver: Playwright driver (required for browser backend, ignored by API).
        **kwargs: forwarded to the backing client (e.g. ai_service_url for Hinge).
    """
    platform = platform.lower()

    if platform == "hinge":
        mode = _resolve_mode("hinge", "HINGE_AUTH_TOKEN")
        if mode == "api":
            try:
                from clapcheeks.platforms.hinge_api import HingeAPIClient
                logger.info("Hinge: using iPhone API backend.")
                return HingeAPIClient(driver=driver, **kwargs)
            except Exception as exc:
                logger.warning("Hinge API init failed (%s) — falling back to browser.", exc)
        if HingeClient is None:
            raise RuntimeError("HingeClient unavailable — install playwright.")
        return HingeClient(driver=driver, **kwargs)

    if platform == "tinder":
        mode = _resolve_mode("tinder", "TINDER_AUTH_TOKEN")
        if mode == "api":
            try:
                from clapcheeks.platforms.tinder_api import TinderAPIClient
                wire = os.environ.get("TINDER_WIRE_FORMAT", "json").lower()
                logger.info("Tinder: using API backend (%s wire).", wire)
                kwargs.pop("ai_service_url", None)
                return TinderAPIClient(driver=driver, **kwargs)
            except Exception as exc:
                logger.warning("Tinder API init failed (%s) — falling back to browser.", exc)
        if TinderClient is None:
            raise RuntimeError("TinderClient unavailable — install playwright.")
        kwargs.pop("ai_service_url", None)
        return TinderClient(driver=driver, **kwargs)

    if platform == "bumble":
        # Bumble stays on the browser / Chrome-extension path for now.
        if BumbleClient is None:
            raise RuntimeError("BumbleClient unavailable — install playwright.")
        kwargs.pop("ai_service_url", None)
        return BumbleClient(driver=driver, **kwargs)

    # Fall-through for less-maintained platforms — browser only
    registry = {
        "grindr": ("clapcheeks.platforms.grindr", "GrindrClient"),
        "badoo": ("clapcheeks.platforms.badoo", "BadooClient"),
        "happn": ("clapcheeks.platforms.happn", "HappnClient"),
        "okcupid": ("clapcheeks.platforms.okcupid", "OKCupidClient"),
        "pof": ("clapcheeks.platforms.pof", "POFClient"),
        "feeld": ("clapcheeks.platforms.feeld", "FeeldClient"),
        "cmb": ("clapcheeks.platforms.coffeemeetsbagel", "CMBClient"),
    }
    if platform not in registry:
        raise ValueError(f"Unknown platform: {platform}")
    module_path, cls_name = registry[platform]
    import importlib
    cls = getattr(importlib.import_module(module_path), cls_name)
    kwargs.pop("ai_service_url", None)
    return cls(driver=driver, **kwargs)
