---
phase: 06-install
plan: 01
subsystem: agent-distribution
tags: [cli, installer, launchd, auth, python-packaging]
dependency-graph:
  requires: []
  provides: [clapcheeks-cli, install-script, browser-auth-flow, launchd-daemon]
  affects: [phase-07-imessage, phase-08-profile, phase-10-sync]
tech-stack:
  added: [click, rich, keyring, pyyaml, requests]
  patterns: [browser-based-cli-auth, launchd-daemon, pip-from-github-subdirectory]
key-files:
  created:
    - agent/pyproject.toml
    - agent/clapcheeks/__init__.py
    - agent/clapcheeks/cli.py
    - agent/clapcheeks/config.py
    - agent/clapcheeks/auth.py
    - agent/clapcheeks/daemon.py
    - agent/clapcheeks/launchd.py
  modified:
    - web/public/install.sh
decisions:
  - id: d-06-01
    title: "Separate clapcheeks package alongside outward"
    choice: "New agent/clapcheeks/ namespace, outward/ untouched"
    reason: "Plan specifies clapcheeks wraps/extends outward — keep both for now"
  - id: d-06-02
    title: "Deferred logging setup in daemon"
    choice: "Move logging.basicConfig into run_daemon() instead of module level"
    reason: "Module-level file logging fails if ~/.clapcheeks/ does not exist yet"
metrics:
  duration: "~8 minutes"
  completed: 2026-03-02
---

# Phase 6 Plan 1: Install Script & CLI Package Summary

**One-liner:** pip-installable clapcheeks CLI with browser auth, launchd daemon, and curl-pipe-bash installer for macOS 12+

## What Was Built

### Task 1: clapcheeks Python Package (767e01d)
Created a full CLI package under `agent/clapcheeks/` with:
- **pyproject.toml** — Modern Python packaging with `clapcheeks` entry point, requires-python >= 3.9
- **config.py** — `~/.clapcheeks/config.yaml` storage with keyring-backed token save/load
- **auth.py** — Browser-based auth: generates session ID, opens `clapcheeks.tech/auth/cli?session=...`, polls API until token returned
- **daemon.py** — Background heartbeat loop (60s interval) with SIGTERM graceful shutdown, logs to `~/.clapcheeks/daemon.log`
- **launchd.py** — Generates `tech.clapcheeks.agent` plist for RunAtLoad + KeepAlive, install/uninstall/is_running helpers
- **cli.py** — Click CLI with `setup` (browser auth + optional daemon enable), `status` (auth + daemon state), `agent start`, `agent stop`

### Task 2: install.sh Rewrite (837671e)
Complete rewrite of `web/public/install.sh` with 6-stage flow:
1. macOS 12+ version gate (rejects non-macOS and older versions)
2. Homebrew auto-install (supports Apple Silicon and Intel paths)
3. Python 3.9+ check with auto-install of python@3.11 via brew
4. pip install clapcheeks from GitHub subdirectory
5. Runs `clapcheeks setup` for interactive browser auth
6. Success panel with dashboard URL and command reference

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Module-level logging crashed on import**
- **Found during:** Task 1 verification
- **Issue:** `daemon.py` configured `logging.basicConfig(filename=...)` at module level, which fails with FileNotFoundError if `~/.clapcheeks/` doesn't exist
- **Fix:** Moved logging setup into `_setup_logging()` called from `run_daemon()`, which creates the directory first
- **Files modified:** `agent/clapcheeks/daemon.py`
- **Commit:** 767e01d (included in task commit)

## Commits

| Hash | Message | Files |
|------|---------|-------|
| 767e01d | feat(phase-6): create clapcheeks Python package with CLI skeleton | agent/pyproject.toml, agent/clapcheeks/*.py (7 files) |
| 837671e | feat(phase-6): rewrite install.sh with full macOS detection and auto-install | web/public/install.sh |

## Verification Results

- All clapcheeks modules import without errors
- `generate_plist()` returns valid XML with `tech.clapcheeks.agent` label
- `pyproject.toml` has correct entry point: `clapcheeks = "clapcheeks.cli:main"`
- `install.sh` passes `bash -n` syntax check
- install.sh contains all 6 required stages (macOS check, brew, python, pip install, setup, success)

## Next Phase Readiness

- The auth flow (`auth.py`) depends on server-side endpoints (`/auth/cli/poll`) which need to be implemented in the API
- The daemon heartbeat (`/agent/heartbeat`) endpoint also needs API-side implementation
- The `clapcheeks setup` command works end-to-end once those endpoints exist
- The `outward/` package remains untouched — migration/consolidation is a future task
