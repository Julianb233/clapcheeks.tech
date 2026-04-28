"""Tests for clapcheeks.daemon fcntl singleton lock.

Verifies:
- _acquire_singleton_lock succeeds when no other holder
- a second process attempting to acquire the lock exits with code 1
"""
from __future__ import annotations
import os
import subprocess
import sys
import textwrap

import pytest


def test_lock_acquires_when_free(tmp_path, monkeypatch):
    """Calling _acquire_singleton_lock directly succeeds when nothing holds the lock."""
    lock_file = str(tmp_path / "test-daemon.lock")
    # Patch the LOCK_FILE constant before import
    import clapcheeks.daemon as daemon
    monkeypatch.setattr(daemon, "LOCK_FILE", lock_file)
    # Reset module-level fp so re-acquire doesn't error
    monkeypatch.setattr(daemon, "_lock_fp", None)
    daemon._acquire_singleton_lock()
    assert os.path.exists(lock_file)
    # PID written
    with open(lock_file) as f:
        pid_str = f.read().strip()
    assert pid_str == str(os.getpid())
    # Cleanup: release lock by closing the fp
    daemon._lock_fp.close()
    daemon._lock_fp = None


def test_second_process_exits_when_lock_held(tmp_path):
    """Spawn two subprocesses that both try to grab the lock; second one must exit 1."""
    lock_file = str(tmp_path / "test-daemon-2.lock")
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    holder_script = textwrap.dedent(f"""
        import sys, os, time
        sys.path.insert(0, {repo_root!r})
        import clapcheeks.daemon as d
        d.LOCK_FILE = {lock_file!r}
        d._lock_fp = None
        d._acquire_singleton_lock()
        # Hold the lock for a bit so the second process can attempt
        sys.stdout.write("HELD\\n")
        sys.stdout.flush()
        time.sleep(5)
    """)

    challenger_script = textwrap.dedent(f"""
        import sys, os
        sys.path.insert(0, {repo_root!r})
        import clapcheeks.daemon as d
        d.LOCK_FILE = {lock_file!r}
        d._lock_fp = None
        d._acquire_singleton_lock()
        sys.stdout.write("ACQUIRED\\n")
    """)

    # Start the holder
    holder = subprocess.Popen(
        [sys.executable, "-c", holder_script],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    try:
        # Wait for it to print HELD so we know the lock is taken
        line = holder.stdout.readline()
        assert "HELD" in line, f"holder did not acquire lock; got {line!r}"

        # Now try to acquire from a second process — must fail with exit 1
        challenger = subprocess.run(
            [sys.executable, "-c", challenger_script],
            capture_output=True,
            text=True,
            timeout=10,
        )
        assert challenger.returncode == 1, (
            f"challenger should have exited 1, got {challenger.returncode}; "
            f"stdout={challenger.stdout!r} stderr={challenger.stderr!r}"
        )
        assert "already running" in challenger.stderr.lower()
    finally:
        holder.terminate()
        try:
            holder.wait(timeout=3)
        except subprocess.TimeoutExpired:
            holder.kill()
