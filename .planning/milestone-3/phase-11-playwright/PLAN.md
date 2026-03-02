---
phase: 11-playwright
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/clapcheeks/browser/__init__.py
  - agent/clapcheeks/browser/driver.py
  - agent/clapcheeks/browser/stealth.py
  - agent/clapcheeks/browser/session.py
  - agent/clapcheeks/session/manager.py
  - agent/clapcheeks/cli.py
  - agent/requirements.txt
autonomous: true

must_haves:
  truths:
    - "Playwright chromium can be installed via `clapcheeks browser install`"
    - "Browser launches with anti-detection measures (no webdriver flag, randomized viewport, rotated user-agent)"
    - "Browser sessions (cookies, localStorage) persist across runs per platform"
    - "SessionManager uses the browser driver for mac-cloud mode"
  artifacts:
    - path: "agent/clapcheeks/browser/__init__.py"
      provides: "Package exports for BrowserDriver, StealthConfig, SessionStore"
    - path: "agent/clapcheeks/browser/driver.py"
      provides: "Async Playwright browser manager with launch/close/context creation"
      exports: ["BrowserDriver"]
    - path: "agent/clapcheeks/browser/stealth.py"
      provides: "Anti-detection config: viewport randomization, user-agent rotation, webdriver flag removal, human-like delays"
      exports: ["StealthConfig", "apply_stealth", "REALISTIC_USER_AGENTS"]
    - path: "agent/clapcheeks/browser/session.py"
      provides: "Persist and restore browser context (cookies, localStorage) per platform"
      exports: ["SessionStore"]
    - path: "agent/clapcheeks/session/manager.py"
      provides: "SessionManager that integrates BrowserDriver for browser-based automation"
      exports: ["SessionManager"]
  key_links:
    - from: "agent/clapcheeks/browser/driver.py"
      to: "agent/clapcheeks/browser/stealth.py"
      via: "apply_stealth called during context creation"
      pattern: "apply_stealth"
    - from: "agent/clapcheeks/browser/driver.py"
      to: "agent/clapcheeks/browser/session.py"
      via: "SessionStore loads/saves cookies on context open/close"
      pattern: "SessionStore"
    - from: "agent/clapcheeks/session/manager.py"
      to: "agent/clapcheeks/browser/driver.py"
      via: "SessionManager creates BrowserDriver for get_driver()"
      pattern: "BrowserDriver"
    - from: "agent/clapcheeks/cli.py"
      to: "playwright install chromium"
      via: "browser install CLI command runs subprocess"
      pattern: "playwright install"
---

<objective>
Set up local Playwright browser automation framework with anti-detection measures for the Clap Cheeks dating co-pilot.

Purpose: Enable browser-based automation of dating apps (Tinder, Bumble, Hinge) running locally on macOS, with stealth measures to avoid bot detection and persistent sessions to avoid re-login.

Output: `agent/clapcheeks/browser/` package with driver, stealth, and session modules; `clapcheeks browser install` CLI command; SessionManager integration.
</objective>

<context>
@agent/clapcheeks/cli.py — existing Click CLI with `swipe`, `status`, `converse` commands
@agent/clapcheeks/config.py — config loader, CONFIG_DIR = ~/.clapcheeks
@agent/requirements.txt — already has playwright>=1.44
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create browser package with driver, stealth, and session modules</name>
  <files>
    agent/clapcheeks/browser/__init__.py
    agent/clapcheeks/browser/driver.py
    agent/clapcheeks/browser/stealth.py
    agent/clapcheeks/browser/session.py
  </files>
  <action>
Create `agent/clapcheeks/browser/` package with four files:

**stealth.py** — Anti-detection configuration:
- `REALISTIC_USER_AGENTS`: list of 5+ recent Chrome macOS user-agent strings (Chrome 120-125 on macOS)
- `StealthConfig` dataclass with fields: `viewport_width` (random 1280-1920), `viewport_height` (computed from width at 16:9/16:10 ratio), `user_agent` (random from list), `locale` (default "en-US"), `timezone_id` (default "America/Los_Angeles")
- `apply_stealth(page)` async function that:
  - Runs `page.add_init_script()` to delete `navigator.webdriver` and override `navigator.plugins` to look non-empty
  - Sets realistic `navigator.platform` to "MacIntel"
- `human_delay()` async function: `asyncio.sleep(random.uniform(0.5, 2.0))` for use between actions

**session.py** — Session persistence:
- `SESSION_DIR = Path.home() / ".clapcheeks" / "sessions"` (mkdir on init)
- `SessionStore` class with `__init__(self, platform: str)` storing path as `SESSION_DIR / f"{platform}.json"`
- `async save(self, context: BrowserContext)` — extracts cookies via `context.cookies()`, saves to JSON file
- `async load(self, context: BrowserContext)` — reads JSON, calls `context.add_cookies(cookies)` if file exists
- Handle missing/corrupt session files gracefully (log warning, start fresh)

**driver.py** — Playwright browser manager:
- `BrowserDriver` class using async Playwright
- `__init__(self, platform: str, headless: bool = False)` — stores platform, headless flag, creates StealthConfig
- `async launch(self) -> Page`:
  - Start async Playwright
  - Launch Chromium with args: `--disable-blink-features=AutomationControlled`, `--no-first-run`, `--no-default-browser-check`
  - Create context with StealthConfig viewport size, user_agent, locale, timezone_id
  - Load session via SessionStore
  - Create page, apply_stealth(page)
  - Return page
- `async close(self)`:
  - Save session via SessionStore
  - Close browser and stop Playwright
- Implement `async __aenter__` / `async __aexit__` for context manager usage

**__init__.py** — Exports: `BrowserDriver`, `StealthConfig`, `SessionStore`
  </action>
  <verify>
    python -c "from clapcheeks.browser import BrowserDriver, StealthConfig, SessionStore; print('imports OK')"
    python -c "from clapcheeks.browser.stealth import REALISTIC_USER_AGENTS, human_delay; assert len(REALISTIC_USER_AGENTS) >= 5; print('stealth OK')"
  </verify>
  <done>
    browser/ package exists with driver.py, stealth.py, session.py all importable.
    StealthConfig produces randomized viewport (1280-1920 width) and user-agent.
    SessionStore reads/writes to ~/.clapcheeks/sessions/{platform}.json.
    BrowserDriver launches Chromium with anti-detection args and stealth scripts.
  </done>
  <commit>feat(11): add browser package with Playwright driver, stealth, and session persistence</commit>
</task>

<task type="auto">
  <name>Task 2: Add `clapcheeks browser install` CLI command</name>
  <files>
    agent/clapcheeks/cli.py
  </files>
  <action>
Add a `browser` Click group to cli.py with an `install` subcommand:

```python
@main.group()
def browser() -> None:
    """Manage local browser for dating app automation."""
    pass

@browser.command()
def install() -> None:
    """Install Chromium browser for Playwright automation."""
    import subprocess
    import sys
    console.print("[bold green]Installing Chromium for Playwright...[/bold green]")
    result = subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=False,
    )
    if result.returncode == 0:
        console.print("[green]Chromium installed successfully.[/green]")
    else:
        console.print("[red]Failed to install Chromium. Run manually:[/red]")
        console.print("  [cyan]python -m playwright install chromium[/cyan]")
        raise SystemExit(1)
```

Register the `browser` group on `main`. This gives us `clapcheeks browser install`.
  </action>
  <verify>
    python -c "from clapcheeks.cli import main; print('cli imports OK')"
    clapcheeks browser install --help
  </verify>
  <done>
    `clapcheeks browser install` command exists and runs `playwright install chromium` via subprocess.
    Success/failure messages displayed to user.
  </done>
  <commit>feat(11): add `clapcheeks browser install` CLI command</commit>
</task>

<task type="auto">
  <name>Task 3: Create SessionManager integrating BrowserDriver</name>
  <files>
    agent/clapcheeks/session/__init__.py
    agent/clapcheeks/session/manager.py
  </files>
  <action>
Create `agent/clapcheeks/session/` package (note: `session/rate_limiter.py` is referenced in cli.py, so check if it exists elsewhere and move/create as needed).

**session/__init__.py** — empty or minimal exports.

**session/manager.py** — `SessionManager` class:
- `__init__(self, config: dict)`:
  - Store config
  - Detect mode via `clapcheeks.modes.detect.detect_mode(config)` or `config.get("force_mode")`
  - Store `self.mode`
  - `self._drivers: dict[str, BrowserDriver] = {}`
- `get_driver(self, platform: str = "tinder")`:
  - If mode is `mac-cloud`:
    - Create `BrowserDriver(platform=platform, headless=False)` if not already cached
    - Run `asyncio.get_event_loop().run_until_complete(driver.launch())` to get page
    - Cache and return the driver
  - For other modes (iphone-usb, iphone-wifi): raise NotImplementedError or return existing Appium driver logic
- `__enter__` / `__exit__`:
  - On exit, close all cached BrowserDrivers (run async close in event loop)
- `close_all(self)`:
  - Iterate `self._drivers`, run `driver.close()` for each

This wires the browser package into the existing CLI flow where `cli.py` calls `mgr = SessionManager(config)` then `mgr.get_driver(plat)`.

Note: Check if `clapcheeks.session.rate_limiter` exists already (imported in cli.py line 13). If it exists elsewhere (flat file), create a re-export or move it into `session/`. If it doesn't exist yet, create a stub `session/rate_limiter.py` with `get_daily_summary() -> dict | None` returning `None` so imports don't break.
  </action>
  <verify>
    python -c "from clapcheeks.session.manager import SessionManager; print('SessionManager OK')"
    python -c "from clapcheeks.session.rate_limiter import get_daily_summary; print('rate_limiter OK')"
  </verify>
  <done>
    SessionManager exists at clapcheeks/session/manager.py.
    get_driver() returns a BrowserDriver-backed page for mac-cloud mode.
    Context manager properly closes all drivers on exit.
    Existing cli.py imports (SessionManager, rate_limiter) continue working.
  </done>
  <commit>feat(11): create SessionManager with BrowserDriver integration</commit>
</task>

</tasks>

<verification>
- All imports resolve: `python -c "from clapcheeks.browser import BrowserDriver, StealthConfig, SessionStore"`
- CLI command exists: `clapcheeks browser install --help` shows usage
- SessionManager imports: `python -c "from clapcheeks.session.manager import SessionManager"`
- Existing CLI commands still work: `clapcheeks --help`, `clapcheeks status --help`
</verification>

<success_criteria>
- browser/ package with driver.py, stealth.py, session.py all importable
- Anti-detection: no navigator.webdriver, randomized viewport 1280-1920, 5+ realistic user-agents
- Session persistence at ~/.clapcheeks/sessions/{platform}.json
- `clapcheeks browser install` CLI command runs playwright install chromium
- SessionManager.get_driver() returns a Playwright-backed driver for mac-cloud mode
- No regressions in existing CLI commands
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-11-playwright/11-01-SUMMARY.md`
</output>
