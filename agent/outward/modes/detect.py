"""Auto-detect which automation mode is available on this system.

Priority: USB > WiFi > Cloud
Falls back gracefully if a mode is unavailable.
"""
from __future__ import annotations

import logging
import shutil
import socket
import subprocess
from pathlib import Path

from outward.modes import MODE_CLOUD, MODE_USB, MODE_WIFI

logger = logging.getLogger(__name__)


def detect_mode(config: dict, force: str | None = None) -> str:
    """Detect the best available automation mode.

    Args:
        config: Loaded user config dict.
        force: If set, skip detection and use this mode directly.

    Returns:
        One of: "iphone-usb", "iphone-wifi", "mac-cloud"
    """
    if force:
        logger.info("Mode forced: %s", force)
        return force

    # 1. Check USB-connected iPhone
    if _iphone_usb_connected():
        logger.info("Mode selected: iphone-usb (USB device detected)")
        return MODE_USB

    # 2. Check WiFi iPhone (config must have phone_wifi_ip)
    phone_ip = config.get("phone_wifi_ip", "")
    if phone_ip and _iphone_wifi_reachable(phone_ip):
        logger.info("Mode selected: iphone-wifi (WDA reachable at %s)", phone_ip)
        return MODE_WIFI

    # 3. Fall back to cloud
    logger.info("Mode selected: mac-cloud (no iPhone detected)")
    return MODE_CLOUD


def _iphone_usb_connected() -> bool:
    """Check if an iPhone is connected via USB using libimobiledevice."""
    # idevice_id is part of libimobiledevice — installed by brew
    if not shutil.which("idevice_id"):
        return False
    try:
        result = subprocess.run(
            ["idevice_id", "-l"],
            capture_output=True, text=True, timeout=5
        )
        udids = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
        return len(udids) > 0
    except Exception:
        return False


def _iphone_wifi_reachable(phone_ip: str, port: int = 8100, timeout: float = 3.0) -> bool:
    """Check if WDA HTTP server is reachable on the phone's WiFi IP."""
    try:
        sock = socket.create_connection((phone_ip, port), timeout=timeout)
        sock.close()
        return True
    except (socket.timeout, ConnectionRefusedError, OSError):
        return False


def get_phone_udid() -> str | None:
    """Get UDID of first connected USB iPhone."""
    if not shutil.which("idevice_id"):
        return None
    try:
        result = subprocess.run(
            ["idevice_id", "-l"],
            capture_output=True, text=True, timeout=5
        )
        udids = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
        return udids[0] if udids else None
    except Exception:
        return None


def get_phone_wifi_ip(udid: str | None = None) -> str | None:
    """Attempt to get the WiFi IP of the connected iPhone via ideviceinfo."""
    if not shutil.which("ideviceinfo"):
        return None
    try:
        cmd = ["ideviceinfo"]
        if udid:
            cmd += ["-u", udid]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        for line in result.stdout.splitlines():
            if "WiFiAddress" in line:
                # Format: "WiFiAddress: 192.168.1.42"
                return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return None
