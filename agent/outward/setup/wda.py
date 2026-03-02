"""WebDriverAgent (WDA) manager.

WDA is Apple's UI testing framework. Appium builds it, signs it with your
developer certificate, and installs it on your iPhone. Once installed,
WDA can run over USB or WiFi.

One-time USB setup → then WiFi forever (until WDA cert expires):
  - Free Apple ID:        expires every 7 days
  - Paid Developer ($99): expires every 1 year
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import time

from outward.modes.detect import get_phone_udid, get_phone_wifi_ip

logger = logging.getLogger(__name__)

APPIUM_WDA_PORT = 8100
APPIUM_PORT = 4723


def check_appium_installed() -> bool:
    """Check if Appium CLI is installed."""
    return shutil.which("appium") is not None


def check_xcuitest_driver() -> bool:
    """Check if appium-xcuitest-driver is installed."""
    try:
        result = subprocess.run(
            ["appium", "driver", "list", "--installed"],
            capture_output=True, text=True, timeout=15
        )
        return "xcuitest" in result.stdout.lower()
    except Exception:
        return False


def install_xcuitest_driver() -> bool:
    """Install the xcuitest driver for Appium."""
    logger.info("Installing appium-xcuitest-driver...")
    try:
        result = subprocess.run(
            ["appium", "driver", "install", "xcuitest"],
            capture_output=True, text=True, timeout=120
        )
        return result.returncode == 0
    except Exception as exc:
        logger.error("Failed to install xcuitest driver: %s", exc)
        return False


def start_appium_server(port: int = APPIUM_PORT) -> subprocess.Popen | None:
    """Start Appium server in the background."""
    if not check_appium_installed():
        logger.error("Appium not installed. Run: npm install -g appium")
        return None
    try:
        proc = subprocess.Popen(
            ["appium", "--port", str(port), "--log-level", "error"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(3)  # Wait for Appium to boot
        logger.info("Appium server started on port %d (pid %d)", port, proc.pid)
        return proc
    except Exception as exc:
        logger.error("Failed to start Appium: %s", exc)
        return None


def enable_wifi_mode(udid: str) -> str | None:
    """Enable WDA WiFi mode on a USB-connected device.

    After calling this, you can disconnect the USB cable and connect
    to WDA over WiFi at http://{phone_ip}:8100.

    Returns the iPhone's WiFi IP address, or None on failure.
    """
    phone_ip = get_phone_wifi_ip(udid)
    if not phone_ip:
        logger.warning("Could not determine phone WiFi IP. Is WiFi enabled on the phone?")
        return None
    logger.info("Phone WiFi IP: %s — WDA accessible at http://%s:%d", phone_ip, phone_ip, APPIUM_WDA_PORT)
    return phone_ip


def check_wda_health(host: str = "localhost", port: int = APPIUM_WDA_PORT) -> bool:
    """Check if WDA HTTP server is responding."""
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/status", timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False
