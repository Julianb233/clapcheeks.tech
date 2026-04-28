"""Physical-world presence gate — bot only runs when operator is home + iPhone present + active hours.
Prevents Tinder/Hinge from fingerprinting auto-replies as off-network.
"""
from __future__ import annotations
import datetime
import logging
import os
import subprocess

logger = logging.getLogger("clapcheeks.safety.presence")

IPHONE_LAN_IP = os.environ.get("MY_IPHONE_LAN_IP", "")
HOME_SUBNET_PREFIX = os.environ.get("HOME_SUBNET_PREFIX", "")
ACTIVE_HOURS_START = int(os.environ.get("CC_ACTIVE_HOURS_START", "7"))
ACTIVE_HOURS_END = int(os.environ.get("CC_ACTIVE_HOURS_END", "23"))
PAUSE_FLAG = "/tmp/clapcheeks-paused"
FORCE_FLAG = "/tmp/clapcheeks-force-on"


def _mac_on_home_subnet() -> bool:
    if not HOME_SUBNET_PREFIX:
        return True  # not configured — fail open
    try:
        out = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=2).stdout
        return HOME_SUBNET_PREFIX in out
    except Exception:
        return True


def _iphone_on_lan() -> bool:
    """iPhone present if either ping responds OR ARP cache has it.
    iOS WiFi sleeps when locked, killing ping but leaving ARP for ~20min.
    """
    if not IPHONE_LAN_IP:
        return True  # not configured — fail open
    try:
        r = subprocess.run(["ping", "-c", "1", "-W", "800", IPHONE_LAN_IP],
                          capture_output=True, timeout=3)
        if r.returncode == 0:
            return True
    except Exception:
        pass
    try:
        r = subprocess.run(["arp", "-n", IPHONE_LAN_IP],
                          capture_output=True, text=True, timeout=2)
        out = r.stdout + r.stderr
        if "no entry" in out.lower() or "(incomplete)" in out.lower():
            return False
        if " at " in out and "ff:ff:ff:ff:ff:ff" not in out:
            return True
    except Exception:
        pass
    return False


def _within_active_hours() -> bool:
    h = datetime.datetime.now().hour
    return ACTIVE_HOURS_START <= h <= ACTIVE_HOURS_END


def should_be_active() -> tuple[bool, str]:
    """Return (active, reason). Use this to gate Tinder/Hinge swipe + auto-reply loops."""
    if os.path.exists(PAUSE_FLAG):
        return False, "manual pause flag set"
    if os.path.exists(FORCE_FLAG):
        return True, "force-on flag set (bypassing gates)"
    if not _within_active_hours():
        return False, f"outside active hours {ACTIVE_HOURS_START}-{ACTIVE_HOURS_END}"
    if not _mac_on_home_subnet():
        return False, "mac not on home subnet"
    if not _iphone_on_lan():
        return False, f"iphone not reachable on LAN ({IPHONE_LAN_IP})"
    return True, "ok: home + phone present + active hours"


if __name__ == "__main__":
    active, reason = should_be_active()
    print(f"active={active}  reason={reason}")
