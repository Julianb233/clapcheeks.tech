---
phase: 15-controller
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/clapcheeks/session/manager.py
  - agent/clapcheeks/session/rate_limiter.py
  - agent/clapcheeks/modes/__init__.py
  - agent/clapcheeks/modes/detect.py
  - agent/clapcheeks/browser/stealth.py
  - agent/clapcheeks/cli.py
autonomous: true

must_haves:
  truths:
    - "SessionManager works as a context manager (`with SessionManager(config) as mgr:`) and cleans up browser on exit"
    - "SessionManager.get_driver(platform) returns a Playwright browser page for the given platform"
    - "rate_limiter.check_limit(platform, action) enforces daily caps: tinder=100, bumble=75, hinge=50 and raises when exceeded"
    - "detect_mode(config) returns 'mac-cloud' as default mode (iphone modes deferred)"
    - "random_delay() sleeps with jitter between min/max; human_mouse_move() arcs to target element"
    - "`clapcheeks swipe` command uses SessionManager as context manager and respects rate limits"
  artifacts:
    - path: "agent/clapcheeks/session/manager.py"
      provides: "SessionManager class — context manager wrapping Playwright browser lifecycle"
    - path: "agent/clapcheeks/session/rate_limiter.py"
      provides: "check_limit() enforcement on top of existing record/summary functions"
    - path: "agent/clapcheeks/modes/__init__.py"
      provides: "MODE_LABELS dict mapping mode keys to display names"
    - path: "agent/clapcheeks/modes/detect.py"
      provides: "detect_mode(config) returning current automation mode"
    - path: "agent/clapcheeks/browser/stealth.py"
      provides: "random_delay() and human_mouse_move() stealth utilities"
  key_links:
    - from: "agent/clapcheeks/session/manager.py"
      to: "agent/clapcheeks/modes/detect.py"
      via: "detect_mode(config) call in __init__"
      pattern: "from clapcheeks\\.modes\\.detect import detect_mode"
    - from: "agent/clapcheeks/session/manager.py"
      to: "agent/clapcheeks/browser/"
      via: "get_driver() launches Playwright browser"
      pattern: "playwright.*launch|browser\\.new_page"
    - from: "agent/clapcheeks/cli.py"
      to: "agent/clapcheeks/session/manager.py"
      via: "swipe command uses `with SessionManager(config) as mgr:`"
      pattern: "with.*SessionManager"
    - from: "agent/clapcheeks/session/manager.py"
      to: "agent/clapcheeks/session/rate_limiter.py"
      via: "check_limit() called before each swipe action"
      pattern: "check_limit"
---

<objective>
Phase 15: Automation Controller — unified orchestration layer that ties together Playwright browser drivers (phase 11), platform clients (phases 12-14), rate limiting, human-like delays, and session management.

Purpose: The swipe command currently imports SessionManager and platform clients but these modules don't exist yet. This phase creates them so `clapcheeks swipe` actually works end-to-end with proper session lifecycle, rate limiting, and anti-detection stealth.

Output: Working SessionManager context manager, rate limit enforcement, mode detection, stealth delay utilities, and updated CLI wiring.
</objective>

<context>
@.planning/ROADMAP.md
@.planning/milestone-3/README.md
@agent/clapcheeks/cli.py — existing CLI with swipe command (lines 91-168) already importing SessionManager, platform clients, and modes
@agent/clapcheeks/config.py — config loader
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create mode detection and stealth utilities</name>
  <files>
    agent/clapcheeks/modes/__init__.py
    agent/clapcheeks/modes/detect.py
    agent/clapcheeks/browser/__init__.py
    agent/clapcheeks/browser/stealth.py
  </files>
  <action>
**agent/clapcheeks/modes/__init__.py** — Mode labels and exports:

```python
MODE_LABELS = {
    "iphone-usb": "iPhone (USB)",
    "iphone-wifi": "iPhone (Wi-Fi)",
    "mac-cloud": "Mac (Cloud Browser)",
}
```

Export `MODE_LABELS` from the package.

**agent/clapcheeks/modes/detect.py** — Mode detection:

```python
def detect_mode(config: dict) -> str:
```

Logic:
1. If `config.get("force_mode")` is set, return it directly
2. Otherwise return `"mac-cloud"` as default (iPhone modes are future work)

Keep it simple — no hardware detection yet. The function signature is stable; implementation will grow in future phases.

**agent/clapcheeks/browser/__init__.py** — Empty package init.

**agent/clapcheeks/browser/stealth.py** — Human-like delay utilities:

1. `async def random_delay(min_s: float = 0.5, max_s: float = 2.5) -> None`:
   - Calculate delay as `random.uniform(min_s, max_s)`
   - Add jitter: multiply by `random.uniform(0.8, 1.2)` to avoid perfectly uniform distributions
   - Clamp result to `[min_s, max_s * 1.2]` so jitter doesn't go below minimum
   - `await asyncio.sleep(delay)`

2. `async def human_mouse_move(page, target, steps: int = 10) -> None`:
   - Get target bounding box via `target.bounding_box()`
   - If bounding box is None, fall back to `target.click()` and return
   - Calculate target center point (x + width/2, y + height/2)
   - Get current mouse position (default to 0,0 if not tracked)
   - Move mouse in `steps` increments with slight random offset per step (bezier-like arc):
     - For each step i in range(steps):
       - t = (i + 1) / steps
       - x = start_x + (target_x - start_x) * t + random.uniform(-2, 2)
       - y = start_y + (target_y - start_y) * t + random.uniform(-3, 3)
       - `await page.mouse.move(x, y)`
       - `await asyncio.sleep(random.uniform(0.01, 0.03))`
   - Final `await target.click()`

Both functions use `import asyncio` and `import random`.
  </action>
  <verify>
    - `python -c "from clapcheeks.modes import MODE_LABELS; print(MODE_LABELS)"` prints the dict
    - `python -c "from clapcheeks.modes.detect import detect_mode; print(detect_mode({}))"` prints "mac-cloud"
    - `python -c "from clapcheeks.modes.detect import detect_mode; print(detect_mode({'force_mode': 'iphone-usb'}))"` prints "iphone-usb"
    - `python -c "from clapcheeks.browser.stealth import random_delay, human_mouse_move; print('imports ok')"` imports cleanly
  </verify>
  <done>
    Mode detection returns "mac-cloud" by default or honors force_mode override. MODE_LABELS maps all three modes to display names. Stealth utilities provide async random_delay with jitter and human_mouse_move with arc movement.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create SessionManager and update rate limiter</name>
  <files>
    agent/clapcheeks/session/__init__.py
    agent/clapcheeks/session/manager.py
    agent/clapcheeks/session/rate_limiter.py
  </files>
  <action>
**agent/clapcheeks/session/__init__.py** — Empty package init.

**agent/clapcheeks/session/rate_limiter.py** — Rate limiter with enforcement:

This file does not exist yet (the CLI imports from it but the module hasn't been created). Create it with:

1. Storage: `~/.clapcheeks/swipe_log.json` — JSON dict keyed by date string, each date maps platform to `{"right": N, "left": N}`.

2. `record_swipe(platform: str, direction: str) -> None`:
   - Load swipe log from disk (create if missing)
   - Increment today's count for platform+direction
   - Write back atomically (write .tmp then rename)

3. `check_limit(platform: str, action: str = "swipe") -> bool`:
   - Daily caps dict: `{"tinder": 100, "bumble": 75, "hinge": 50}`
   - Load today's counts for platform
   - total = right + left for today
   - If total >= cap for platform, raise `RateLimitExceeded(platform, total, cap)` with a clear message
   - Otherwise return True

4. `class RateLimitExceeded(Exception)`:
   - `__init__(self, platform, current, limit)` — store attrs
   - `__str__` returns `"Daily limit reached for {platform}: {current}/{limit} swipes"`

5. `get_daily_summary() -> dict`:
   - Load today's entry from swipe log
   - Return flat dict: `{"tinder_right": N, "tinder_left": N, "bumble_right": N, ...}`
   - Return empty dict if no activity today

**agent/clapcheeks/session/manager.py** — SessionManager:

```python
class SessionManager:
    def __init__(self, config: dict):
        self.config = config
        self.mode = detect_mode(config)
        self._browsers: dict[str, Any] = {}  # platform -> browser instance
        self._pages: dict[str, Any] = {}      # platform -> page instance

    def get_driver(self, platform: str = "default"):
        """Return a Playwright page for the given platform.

        Launches browser if not already running for this platform.
        Each platform gets its own browser context to isolate cookies/sessions.
        """
        if platform in self._pages:
            return self._pages[platform]

        from playwright.sync_api import sync_playwright

        pw = sync_playwright().start()
        browser = pw.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        )

        # Persistent context per platform for session reuse
        user_data_dir = Path.home() / ".clapcheeks" / "browser" / platform
        user_data_dir.mkdir(parents=True, exist_ok=True)

        context = browser.new_context(
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        self._browsers[platform] = (pw, browser, context)
        self._pages[platform] = page
        return page

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        for platform, (pw, browser, context) in self._browsers.items():
            try:
                context.close()
                browser.close()
                pw.stop()
            except Exception:
                pass
        self._browsers.clear()
        self._pages.clear()
        return False
```

Imports needed: `from pathlib import Path`, `from typing import Any`, `from clapcheeks.modes.detect import detect_mode`.

NOTE: Use `sync_playwright` (not async) because the CLI commands are synchronous. The stealth utilities in browser/stealth.py are async for future use but SessionManager itself is sync.
  </action>
  <verify>
    - `python -c "from clapcheeks.session.rate_limiter import check_limit, record_swipe, get_daily_summary, RateLimitExceeded; print('imports ok')"` imports cleanly
    - `python -c "from clapcheeks.session.manager import SessionManager; print('import ok')"` imports cleanly
    - `python -c "from clapcheeks.session.rate_limiter import check_limit; check_limit('tinder', 'swipe'); print('under limit')"` prints "under limit" (assuming fresh state)
  </verify>
  <done>
    SessionManager works as context manager, launches Playwright browsers per-platform with anti-detection args, and cleans up on exit. Rate limiter enforces daily caps (tinder=100, bumble=75, hinge=50) and raises RateLimitExceeded when exceeded. Swipe log persists to ~/.clapcheeks/swipe_log.json.
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire CLI swipe command to SessionManager and rate limiter</name>
  <files>
    agent/clapcheeks/cli.py
  </files>
  <action>
The existing `cli.py` swipe command (lines 91-168) already has the right structure — it imports SessionManager, creates platform clients, and runs swipe sessions. The key updates:

1. **Add rate limit check before each platform loop iteration** (inside the `for plat in platforms:` loop, before `driver = mgr.get_driver(plat)`):
   ```python
   from clapcheeks.session.rate_limiter import check_limit, RateLimitExceeded

   try:
       check_limit(plat, "swipe")
   except RateLimitExceeded as e:
       console.print(f"  [yellow]⚠[/yellow] {e}")
       continue
   ```

2. **Record swipes after each session** — after `results = client.run_swipe_session(...)`:
   ```python
   from clapcheeks.session.rate_limiter import record_swipe
   for _ in range(results.get('liked', 0)):
       record_swipe(plat, 'right')
   for _ in range(results.get('passed', 0)):
       record_swipe(plat, 'left')
   ```

3. **Fix the converse command** (lines 241-284): The `session.get_driver()` call on line 257 is missing the platform arg. Update to `session.get_driver(platform)`. Also wrap in context manager: use `with SessionManager(config) as session:` instead of bare `session = SessionManager(config)`.

4. Verify the existing imports at the top of cli.py (lines 11-13) match the module paths:
   - `from clapcheeks.modes import MODE_LABELS` — matches modes/__init__.py
   - `from clapcheeks.modes.detect import detect_mode` — matches modes/detect.py
   - `from clapcheeks.session.rate_limiter import get_daily_summary` — matches rate_limiter.py

These imports are already correct in the current cli.py; no changes needed there.
  </action>
  <verify>
    - `python -c "from clapcheeks.cli import main; print('cli imports ok')"` imports without error
    - `python -m clapcheeks --help` shows all commands including swipe, status, converse
    - `python -m clapcheeks swipe --help` shows --mode, --platform, --swipes, --like-ratio options
    - Grep cli.py for `check_limit` — should find the rate limit check in swipe command
    - Grep cli.py for `record_swipe` — should find swipe recording after session results
  </verify>
  <done>
    CLI swipe command checks rate limits before each platform, records swipes after each session, and uses SessionManager as context manager. Converse command fixed to pass platform to get_driver and use context manager. All imports resolve to the newly created modules.
  </done>
</task>

</tasks>

<verification>
1. **Import chain**: `python -c "from clapcheeks.cli import main"` succeeds — proves all modules (modes, session, browser) resolve correctly
2. **Context manager lifecycle**: SessionManager enters and exits without error when no Playwright is installed (should fail gracefully on import, not on __exit__)
3. **Rate limit enforcement**: Create test script that calls record_swipe 100 times for tinder, then check_limit should raise RateLimitExceeded
4. **Mode detection**: detect_mode({}) returns "mac-cloud"; detect_mode({"force_mode": "iphone-usb"}) returns "iphone-usb"
5. **File ownership**: No file is modified by more than one task (modes/ in T1, session/ in T2, cli.py in T3)
</verification>

<success_criteria>
- SessionManager works as `with SessionManager(config) as mgr:` context manager
- `mgr.get_driver("tinder")` returns a Playwright page (when Playwright is installed)
- Rate limiter enforces tinder=100, bumble=75, hinge=50 daily caps
- `detect_mode(config)` returns appropriate mode string
- `random_delay()` and `human_mouse_move()` are importable async stealth utilities
- `clapcheeks swipe` checks limits, runs sessions, records swipes, cleans up browsers
- All modules import cleanly: `from clapcheeks.cli import main` succeeds
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-15-controller/SUMMARY.md`
</output>
