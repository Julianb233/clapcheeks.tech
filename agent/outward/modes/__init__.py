"""Automation mode selection for Outward.

Three modes in priority order:
  1. iphone-usb    — iPhone via USB cable (most reliable)
  2. iphone-wifi   — iPhone wirelessly over LAN (cable-free)
  3. mac-cloud     — Browserbase cloud browser (no phone needed)
"""
from __future__ import annotations

MODE_USB = "iphone-usb"
MODE_WIFI = "iphone-wifi"
MODE_CLOUD = "mac-cloud"

MODE_LABELS = {
    MODE_USB: "iPhone (USB cable) — most reliable",
    MODE_WIFI: "iPhone (WiFi wireless) — cable-free",
    MODE_CLOUD: "Mac Cloud (Browserbase) — no phone needed",
}

MODE_DESCRIPTIONS = {
    MODE_USB: (
        "Automates the real Tinder/Bumble/Hinge iOS app on your iPhone via USB. "
        "Indistinguishable from a real user. Best detection avoidance."
    ),
    MODE_WIFI: (
        "Same as USB but wireless after one-time setup. "
        "Phone and Mac must be on the same WiFi network."
    ),
    MODE_CLOUD: (
        "Runs a cloud browser via Browserbase. No iPhone needed. "
        "Works anywhere. ~$1-3/month per user."
    ),
}


def get_mode_label(mode: str) -> str:
    return MODE_LABELS.get(mode, mode)
