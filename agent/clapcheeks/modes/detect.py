"""Detect which automation mode to use based on config and environment."""
from __future__ import annotations


def detect_mode(config: dict) -> str:
    """Return the automation mode string.

    Priority:
    1. config["force_mode"] if set
    2. Default to "mac-cloud"
    """
    if config.get("force_mode"):
        return config["force_mode"]
    return "mac-cloud"
