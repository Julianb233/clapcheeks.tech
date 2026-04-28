"""Tests for clapcheeks.safety.presence — physical-world presence gate.

Verifies all branches:
- pause flag → False
- force flag → True (overrides everything else)
- outside active hours → False
- mac not on home subnet → False
- iphone not on LAN (no ping, no ARP) → False
- iphone present via ping → True
- iphone present via ARP only → True
- fail-open behavior when env vars empty
"""
from __future__ import annotations
import os
import subprocess
from importlib import reload
from unittest.mock import patch, MagicMock

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reload_presence(env: dict | None = None):
    """Reload the presence module so module-level os.environ reads pick up overrides."""
    import clapcheeks.safety.presence as p
    if env is not None:
        with patch.dict(os.environ, env, clear=False):
            reload(p)
    else:
        reload(p)
    return p


def _mk_completed(stdout: str = "", stderr: str = "", returncode: int = 0):
    cp = MagicMock(spec=subprocess.CompletedProcess)
    cp.stdout = stdout
    cp.stderr = stderr
    cp.returncode = returncode
    return cp


@pytest.fixture(autouse=True)
def _cleanup_flags():
    """Make sure flag files don't leak between tests."""
    for f in ("/tmp/clapcheeks-paused", "/tmp/clapcheeks-force-on"):
        try:
            os.remove(f)
        except FileNotFoundError:
            pass
    yield
    for f in ("/tmp/clapcheeks-paused", "/tmp/clapcheeks-force-on"):
        try:
            os.remove(f)
        except FileNotFoundError:
            pass


# ---------------------------------------------------------------------------
# Flag file gates
# ---------------------------------------------------------------------------

class TestFlagGates:
    def test_pause_flag_blocks(self):
        p = _reload_presence({
            "MY_IPHONE_LAN_IP": "",
            "HOME_SUBNET_PREFIX": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        with open(p.PAUSE_FLAG, "w") as f:
            f.write("paused")
        active, reason = p.should_be_active()
        assert active is False
        assert "pause" in reason.lower()

    def test_force_flag_overrides_everything(self):
        p = _reload_presence({
            "MY_IPHONE_LAN_IP": "10.0.0.99",
            "HOME_SUBNET_PREFIX": "192.168.99.",
            "CC_ACTIVE_HOURS_START": "23",
            "CC_ACTIVE_HOURS_END": "23",
        })
        with open(p.FORCE_FLAG, "w") as f:
            f.write("force")
        active, reason = p.should_be_active()
        assert active is True
        assert "force" in reason.lower()

    def test_pause_flag_takes_priority_over_force(self):
        p = _reload_presence({})
        with open(p.PAUSE_FLAG, "w") as f:
            f.write("paused")
        with open(p.FORCE_FLAG, "w") as f:
            f.write("force")
        active, reason = p.should_be_active()
        assert active is False
        assert "pause" in reason.lower()


# ---------------------------------------------------------------------------
# Active hours
# ---------------------------------------------------------------------------

class TestActiveHours:
    def test_within_active_hours(self):
        p = _reload_presence({
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
            "MY_IPHONE_LAN_IP": "",
            "HOME_SUBNET_PREFIX": "",
        })
        assert p._within_active_hours() is True

    def test_outside_active_hours_blocks(self):
        import datetime as dt
        now_hour = dt.datetime.now().hour
        bad = (now_hour + 12) % 24
        if now_hour == bad:
            pytest.skip("Test hour collision; rerun")
        p = _reload_presence({
            "CC_ACTIVE_HOURS_START": str(bad),
            "CC_ACTIVE_HOURS_END": str(bad),
            "MY_IPHONE_LAN_IP": "",
            "HOME_SUBNET_PREFIX": "",
        })
        active, reason = p.should_be_active()
        assert active is False
        assert "active hours" in reason.lower()


# ---------------------------------------------------------------------------
# Subnet detection
# ---------------------------------------------------------------------------

class TestSubnet:
    def test_subnet_unconfigured_fail_open(self):
        p = _reload_presence({
            "HOME_SUBNET_PREFIX": "",
            "MY_IPHONE_LAN_IP": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        assert p._mac_on_home_subnet() is True

    def test_subnet_match(self):
        p = _reload_presence({
            "HOME_SUBNET_PREFIX": "192.168.1.",
            "MY_IPHONE_LAN_IP": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        with patch("clapcheeks.safety.presence.subprocess.run") as mock_run:
            mock_run.return_value = _mk_completed(
                stdout="inet 192.168.1.42 netmask 0xffffff00 broadcast 192.168.1.255",
            )
            assert p._mac_on_home_subnet() is True

    def test_subnet_mismatch(self):
        p = _reload_presence({
            "HOME_SUBNET_PREFIX": "192.168.1.",
            "MY_IPHONE_LAN_IP": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        with patch("clapcheeks.safety.presence.subprocess.run") as mock_run:
            mock_run.return_value = _mk_completed(
                stdout="inet 10.0.0.5 netmask 0xff000000 broadcast 10.255.255.255",
            )
            assert p._mac_on_home_subnet() is False

    def test_subnet_subprocess_exception_fail_open(self):
        p = _reload_presence({
            "HOME_SUBNET_PREFIX": "192.168.1.",
            "MY_IPHONE_LAN_IP": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        with patch(
            "clapcheeks.safety.presence.subprocess.run",
            side_effect=OSError("ifconfig missing"),
        ):
            assert p._mac_on_home_subnet() is True


# ---------------------------------------------------------------------------
# iPhone on LAN
# ---------------------------------------------------------------------------

class TestIPhoneOnLAN:
    def test_iphone_unconfigured_fail_open(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": ""})
        assert p._iphone_on_lan() is True

    def test_iphone_present_via_ping(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": "192.168.1.55"})

        def fake_run(cmd, *args, **kwargs):
            if "ping" in cmd[0]:
                return _mk_completed(returncode=0)
            return _mk_completed(returncode=1)

        with patch("clapcheeks.safety.presence.subprocess.run", side_effect=fake_run):
            assert p._iphone_on_lan() is True

    def test_iphone_present_via_arp_when_ping_fails(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": "192.168.1.55"})

        def fake_run(cmd, *args, **kwargs):
            if "ping" in cmd[0]:
                return _mk_completed(returncode=1)
            if "arp" in cmd[0]:
                return _mk_completed(
                    stdout="? (192.168.1.55) at aa:bb:cc:dd:ee:ff on en0 [ethernet]",
                )
            return _mk_completed(returncode=1)

        with patch("clapcheeks.safety.presence.subprocess.run", side_effect=fake_run):
            assert p._iphone_on_lan() is True

    def test_iphone_absent_no_ping_no_arp(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": "192.168.1.55"})

        def fake_run(cmd, *args, **kwargs):
            if "ping" in cmd[0]:
                return _mk_completed(returncode=1)
            if "arp" in cmd[0]:
                return _mk_completed(stdout="192.168.1.55 (no entry)")
            return _mk_completed(returncode=1)

        with patch("clapcheeks.safety.presence.subprocess.run", side_effect=fake_run):
            assert p._iphone_on_lan() is False

    def test_iphone_absent_arp_incomplete(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": "192.168.1.55"})

        def fake_run(cmd, *args, **kwargs):
            if "ping" in cmd[0]:
                return _mk_completed(returncode=1)
            if "arp" in cmd[0]:
                return _mk_completed(
                    stdout="? (192.168.1.55) at (incomplete) on en0 [ethernet]",
                )
            return _mk_completed(returncode=1)

        with patch("clapcheeks.safety.presence.subprocess.run", side_effect=fake_run):
            assert p._iphone_on_lan() is False

    def test_iphone_arp_broadcast_mac_rejected(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": "192.168.1.55"})

        def fake_run(cmd, *args, **kwargs):
            if "ping" in cmd[0]:
                return _mk_completed(returncode=1)
            if "arp" in cmd[0]:
                return _mk_completed(
                    stdout="? (192.168.1.55) at ff:ff:ff:ff:ff:ff on en0 [ethernet]",
                )
            return _mk_completed(returncode=1)

        with patch("clapcheeks.safety.presence.subprocess.run", side_effect=fake_run):
            assert p._iphone_on_lan() is False

    def test_iphone_subprocess_exception_handled(self):
        p = _reload_presence({"MY_IPHONE_LAN_IP": "192.168.1.55"})
        with patch(
            "clapcheeks.safety.presence.subprocess.run",
            side_effect=OSError("ping missing"),
        ):
            assert p._iphone_on_lan() is False


# ---------------------------------------------------------------------------
# Top-level should_be_active integration
# ---------------------------------------------------------------------------

class TestShouldBeActive:
    def test_all_clear_returns_active(self):
        p = _reload_presence({
            "MY_IPHONE_LAN_IP": "",
            "HOME_SUBNET_PREFIX": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        active, reason = p.should_be_active()
        assert active is True
        assert "ok" in reason.lower()

    def test_subnet_failure_blocks(self):
        p = _reload_presence({
            "MY_IPHONE_LAN_IP": "",
            "HOME_SUBNET_PREFIX": "192.168.99.",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })
        with patch("clapcheeks.safety.presence.subprocess.run") as mock_run:
            mock_run.return_value = _mk_completed(stdout="inet 10.0.0.1")
            active, reason = p.should_be_active()
            assert active is False
            assert "subnet" in reason.lower()

    def test_iphone_failure_blocks(self):
        p = _reload_presence({
            "MY_IPHONE_LAN_IP": "192.168.1.55",
            "HOME_SUBNET_PREFIX": "",
            "CC_ACTIVE_HOURS_START": "0",
            "CC_ACTIVE_HOURS_END": "23",
        })

        def fake_run(cmd, *args, **kwargs):
            if "ping" in cmd[0]:
                return _mk_completed(returncode=1)
            if "arp" in cmd[0]:
                return _mk_completed(stdout="(no entry)")
            return _mk_completed(returncode=1)

        with patch("clapcheeks.safety.presence.subprocess.run", side_effect=fake_run):
            active, reason = p.should_be_active()
            assert active is False
            assert "iphone" in reason.lower()
