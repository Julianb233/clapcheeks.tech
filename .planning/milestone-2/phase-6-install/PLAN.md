---
phase: 06-install
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/pyproject.toml
  - agent/setup.py
  - agent/clapcheeks/__init__.py
  - agent/clapcheeks/cli.py
  - agent/clapcheeks/config.py
  - agent/clapcheeks/daemon.py
  - agent/clapcheeks/auth.py
  - agent/clapcheeks/launchd.py
  - web/public/install.sh
autonomous: true

must_haves:
  truths:
    - "curl -fsSL https://clapcheeks.tech/install.sh | bash installs the agent on a clean macOS 12+ machine"
    - "clapcheeks setup opens the browser for auth and stores the token locally"
    - "clapcheeks agent starts a background daemon that auto-starts on login via launchd"
    - "The install script refuses to run on non-macOS or macOS < 12"
    - "The install script installs Python 3.9+ via Homebrew if missing"
  artifacts:
    - path: "web/public/install.sh"
      provides: "One-command installer served by Vercel"
    - path: "agent/pyproject.toml"
      provides: "Modern Python package metadata with clapcheeks entry point"
    - path: "agent/clapcheeks/cli.py"
      provides: "Click CLI with setup, status, and agent subcommands"
    - path: "agent/clapcheeks/auth.py"
      provides: "Browser-based CLI auth flow"
    - path: "agent/clapcheeks/launchd.py"
      provides: "Launchd plist generation and management"
    - path: "agent/clapcheeks/daemon.py"
      provides: "Background agent daemon entry point"
  key_links:
    - from: "web/public/install.sh"
      to: "agent/pyproject.toml"
      via: "pip install from GitHub subdirectory"
      pattern: "pip.*install.*clapcheeks"
    - from: "agent/clapcheeks/cli.py setup"
      to: "agent/clapcheeks/auth.py"
      via: "opens browser to clapcheeks.tech/auth/cli, polls for token"
      pattern: "clapcheeks.tech/auth/cli"
    - from: "agent/clapcheeks/launchd.py"
      to: "agent/clapcheeks/daemon.py"
      via: "launchd plist ProgramArguments points to clapcheeks agent"
      pattern: "clapcheeks.*agent"
---

<objective>
Create the one-command install flow for the Clap Cheeks local agent.

Purpose: Users run a single curl command to install the clapcheeks CLI, authenticate via browser, and start a background daemon that auto-launches on login. This is the primary distribution mechanism for the local agent.

Output: A working install.sh served at clapcheeks.tech/install.sh, a pip-installable clapcheeks package, browser-based auth flow, and launchd-managed background daemon.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@agent/outward/cli.py — Existing CLI structure (click-based, will be ported to clapcheeks namespace)
@agent/outward/config.py — Existing config pattern (~/.outward/config.yaml, keyring token storage)
@agent/outward/setup/wizard.py — Existing setup wizard (will be replaced with browser-based auth)
@agent/setup.py — Existing setup.py (will be replaced by pyproject.toml)
@agent/requirements.txt — Current dependencies
@web/public/install.sh — Existing stub installer (will be rewritten)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create clapcheeks Python package with pyproject.toml and CLI skeleton</name>
  <files>
    agent/pyproject.toml
    agent/clapcheeks/__init__.py
    agent/clapcheeks/cli.py
    agent/clapcheeks/config.py
    agent/clapcheeks/auth.py
    agent/clapcheeks/daemon.py
    agent/clapcheeks/launchd.py
  </files>
  <action>
  NOTE: The existing agent code lives in agent/outward/. We are creating a NEW package namespace agent/clapcheeks/ that will become the primary CLI. The outward/ package remains as-is for now — clapcheeks/ wraps and extends it.

  1. Create agent/pyproject.toml:
     - [build-system] requires setuptools>=68
     - [project] name="clapcheeks", version="0.1.0", requires-python=">=3.9"
     - Dependencies: click>=8.1, rich>=13.0, requests>=2.31, pyyaml>=6.0, keyring>=24.0
     - [project.scripts] clapcheeks = "clapcheeks.cli:main"
     - Do NOT delete agent/setup.py — it still serves the outward package

  2. Create agent/clapcheeks/__init__.py:
     - __version__ = "0.1.0"

  3. Create agent/clapcheeks/config.py:
     - CONFIG_DIR = Path.home() / ".clapcheeks"
     - CONFIG_FILE = CONFIG_DIR / "config.yaml"
     - DEFAULTS: api_url="https://api.clapcheeks.tech", agent_token="", dashboard_url="https://clapcheeks.tech/dashboard"
     - load() -> dict, save(config: dict), save_agent_token(token: str) using keyring with file fallback, get_agent_token() -> str | None
     - Follow the exact pattern from agent/outward/config.py but with .clapcheeks paths

  4. Create agent/clapcheeks/auth.py:
     - generate_cli_session_id() -> str (random 32-char hex)
     - open_browser_auth(session_id: str) -> None: opens https://clapcheeks.tech/auth/cli?session={session_id} in default browser using webbrowser.open()
     - poll_for_token(session_id: str, api_url: str, timeout: int = 300) -> str | None:
       - Polls GET {api_url}/auth/cli/poll?session={session_id} every 2 seconds
       - Returns token string when response has {"status": "authenticated", "token": "..."}
       - Returns None after timeout
       - Show a rich spinner while polling with "Waiting for browser login..."
     - This is the browser-based auth flow: user's browser opens the auth page, they log in, the server associates the session_id with their account, and the CLI polls until it gets the token back.

  5. Create agent/clapcheeks/daemon.py:
     - run_daemon() function: the background agent loop
     - On startup: load config, verify token exists (exit with error if not)
     - Main loop: every 60 seconds, call a heartbeat endpoint POST {api_url}/agent/heartbeat with Authorization header
     - Log to ~/.clapcheeks/daemon.log using standard logging module
     - Handle SIGTERM gracefully (set a shutdown flag, exit loop cleanly)
     - This is a placeholder daemon — real functionality (iMessage sync, auto-swipe) comes in later phases

  6. Create agent/clapcheeks/launchd.py:
     - PLIST_PATH = Path.home() / "Library/LaunchAgents/tech.clapcheeks.agent.plist"
     - PLIST_LABEL = "tech.clapcheeks.agent"
     - generate_plist(python_path: str) -> str: returns XML plist string
       - Label: tech.clapcheeks.agent
       - ProgramArguments: [python_path, "-m", "clapcheeks.daemon"]
       - RunAtLoad: true
       - KeepAlive: true
       - StandardOutPath: ~/.clapcheeks/daemon.log
       - StandardErrorPath: ~/.clapcheeks/daemon.log
       - WorkingDirectory: ~/.clapcheeks
     - install_launchd() -> None: writes plist, runs launchctl load
     - uninstall_launchd() -> None: runs launchctl unload, deletes plist
     - is_running() -> bool: checks launchctl list for the label

  7. Create agent/clapcheeks/cli.py:
     - Click group: main() with version option
     - Subcommand: setup
       a. Print welcome banner with rich Panel
       b. Call open_browser_auth(session_id) from auth.py
       c. Poll for token with spinner
       d. On success: save token via config.save_agent_token(), print success
       e. On timeout: print error message with manual token instructions
       f. Ask if user wants to enable auto-start daemon
       g. If yes: call install_launchd() and start it
     - Subcommand: status — show version, auth status (token present?), daemon running (launchd check)
     - Subcommand: agent start — install launchd plist and load it
     - Subcommand: agent stop — unload launchd plist
     - Do NOT port the swipe/converse/menu/sync commands — those stay in outward CLI for now
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.cli import main; print('CLI imports OK')"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.auth import generate_cli_session_id, open_browser_auth, poll_for_token; print('Auth imports OK')"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.launchd import generate_plist; print(generate_plist('/usr/bin/python3')[:50])"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.daemon import run_daemon; print('Daemon imports OK')"
    Verify pyproject.toml has [project.scripts] clapcheeks = "clapcheeks.cli:main"
  </verify>
  <done>
    - agent/clapcheeks/ package exists with __init__.py, cli.py, config.py, auth.py, daemon.py, launchd.py
    - agent/pyproject.toml defines clapcheeks entry point and metadata
    - All modules import without errors
    - generate_plist() returns valid XML with tech.clapcheeks.agent label
    - CLI has setup, status, agent start, agent stop subcommands
  </done>
</task>

<task type="auto">
  <name>Task 2: Rewrite install.sh with full macOS detection, Homebrew/Python auto-install, and daemon setup</name>
  <files>web/public/install.sh</files>
  <action>
  Rewrite web/public/install.sh from scratch. The script must be safe, idempotent, and work on a clean macOS 12+ machine.

  Structure the script in this exact order:

  1. HEADER AND BRANDING:
     - #!/bin/bash with set -e
     - Version variable: CLAPCHEEKS_VERSION="0.1.0"
     - Color variables (RED, GREEN, YELLOW, PURPLE, BOLD, NC)
     - ASCII art banner for "Clap Cheeks" (keep it tasteful — just the name in block letters)
     - Print version and URL

  2. MACOS VERSION CHECK:
     - Check uname == Darwin, exit 1 if not macOS
     - Parse macOS version: sw_vers -productVersion
     - Extract major version number
     - Require macOS 12+ (Monterey), exit 1 with clear error if older
     - Print: "macOS {version} detected (check mark)"

  3. HOMEBREW CHECK AND INSTALL:
     - Check if brew is in PATH
     - If missing, print message and auto-install: /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
     - After install, add brew to PATH for current session (eval the shellenv)
     - Print: "Homebrew ready (check mark)"

  4. PYTHON CHECK AND INSTALL:
     - Check for python3 in PATH
     - If missing, install via: brew install python@3.11
     - If found, check version >= 3.9 using: python3 -c 'import sys; exit(0 if sys.version_info >= (3,9) else 1)'
     - If version too old, install python@3.11 via brew
     - Print: "Python {version} ready (check mark)"

  5. INSTALL CLAPCHEEKS PACKAGE:
     - Create ~/.clapcheeks/ directory
     - pip3 install clapcheeks from GitHub: pip3 install --upgrade "git+https://github.com/Julianb233/clapcheeks.tech.git#subdirectory=agent"
     - Verify install: clapcheeks --version
     - Print: "clapcheeks CLI installed (check mark)"

  6. RUN SETUP:
     - Print message: "Opening browser for account setup..."
     - Run: clapcheeks setup
     - This will handle the browser auth flow interactively

  7. SUCCESS MESSAGE:
     - Print success panel with:
       - "Clap Cheeks installed successfully!"
       - "Your agent is running in the background"
       - "Dashboard: https://clapcheeks.tech/dashboard"
       - "Commands: clapcheeks status, clapcheeks agent stop"

  IMPORTANT: Use -e flag with echo for color codes. Use unicode checkmarks (✓) and crosses (✗) for status. The script must be readable and well-commented.

  Do NOT use `set -o pipefail` — some commands intentionally use || fallbacks.
  </action>
  <verify>
    bash -n /opt/agency-workspace/clapcheeks.tech/web/public/install.sh  (syntax check — must pass)
    grep -q "sw_vers" /opt/agency-workspace/clapcheeks.tech/web/public/install.sh  (macOS version check present)
    grep -q "brew install" /opt/agency-workspace/clapcheeks.tech/web/public/install.sh  (Homebrew install present)
    grep -q "python.*3.9\|3,9" /opt/agency-workspace/clapcheeks.tech/web/public/install.sh  (Python version check)
    grep -q "clapcheeks setup" /opt/agency-workspace/clapcheeks.tech/web/public/install.sh  (runs setup)
    grep -q "launchd\|daemon\|background" /opt/agency-workspace/clapcheeks.tech/web/public/install.sh  (daemon reference)
  </verify>
  <done>
    - install.sh passes bash -n syntax check
    - Script checks macOS 12+ (rejects older/non-macOS)
    - Script installs Homebrew if missing
    - Script installs Python 3.9+ if missing (via brew)
    - Script pip-installs clapcheeks from GitHub
    - Script runs clapcheeks setup (browser auth + daemon start)
    - Script prints success message with dashboard URL
  </done>
</task>

</tasks>

<verification>
1. bash -n web/public/install.sh — syntax valid
2. python3 -c "from clapcheeks.cli import main" — package imports
3. python3 -c "from clapcheeks.launchd import generate_plist; p = generate_plist('/usr/bin/python3'); assert 'tech.clapcheeks.agent' in p" — plist generation works
4. pyproject.toml has correct entry point: clapcheeks = "clapcheeks.cli:main"
5. install.sh contains all 6 required stages (macOS check, brew, python, pip install, setup, success)
</verification>

<success_criteria>
- A user on macOS 12+ can run `curl -fsSL https://clapcheeks.tech/install.sh | bash` and get a working clapcheeks CLI
- `clapcheeks setup` opens the browser for auth and stores the token in keychain
- `clapcheeks agent start` installs a launchd plist that auto-starts the daemon on login
- `clapcheeks status` shows version, auth status, and daemon running state
- The install script gracefully handles missing Homebrew and Python by auto-installing them
- The install script refuses to run on non-macOS or macOS < 12
</success_criteria>

<output>
After completion, create `.planning/milestone-2/phase-6-install/06-01-SUMMARY.md`
</output>
