---
phase: 12-tinder
plan: 01
type: execute
wave: 1
depends_on: ["11-playwright"]
files_modified:
  - agent/clapcheeks/platforms/__init__.py
  - agent/clapcheeks/platforms/tinder.py
  - agent/clapcheeks/ai/opener.py
  - agent/clapcheeks/ai/__init__.py
autonomous: true

must_haves:
  truths:
    - "User can run `clapcheeks swipe --platform tinder` and Tinder opens in a Playwright browser"
    - "If not logged in, user sees instructions to manually authenticate, then automation resumes"
    - "Swipe loop runs with human-like random delays (0.5-2s) and respects like_ratio"
    - "Match modals are detected and new matches are recorded"
    - "Daily swipe count is enforced at 100 max via rate_limiter"
    - "New matches receive an AI-generated opener message"
  artifacts:
    - path: "agent/clapcheeks/platforms/__init__.py"
      provides: "Platform package init"
    - path: "agent/clapcheeks/platforms/tinder.py"
      provides: "TinderClient with login, swipe, match detection"
      exports: ["TinderClient"]
    - path: "agent/clapcheeks/ai/__init__.py"
      provides: "AI package init"
    - path: "agent/clapcheeks/ai/opener.py"
      provides: "AI opener message generation"
      exports: ["generate_opener"]
  key_links:
    - from: "agent/clapcheeks/cli.py"
      to: "agent/clapcheeks/platforms/tinder.py"
      via: "from clapcheeks.platforms.tinder import TinderClient"
      pattern: "TinderClient\\(driver="
    - from: "agent/clapcheeks/platforms/tinder.py"
      to: "agent/clapcheeks/session/rate_limiter.py"
      via: "rate limiter check before each swipe"
      pattern: "rate_limiter"
    - from: "agent/clapcheeks/platforms/tinder.py"
      to: "agent/clapcheeks/ai/opener.py"
      via: "generate opener on match detection"
      pattern: "generate_opener"
---

<objective>
Implement Tinder browser automation for the Clap Cheeks CLI agent.

Purpose: Enable `clapcheeks swipe --platform tinder` to automatically log in, swipe profiles with human-like behavior, detect matches, and send AI-generated opener messages — all running locally via Playwright.

Output: Working TinderClient class that integrates with the existing CLI swipe command, plus an AI opener generator.
</objective>

<context>
@.planning/ROADMAP.md
@.planning/milestone-3/README.md
@agent/clapcheeks/cli.py (lines 91-168 — swipe command, already imports TinderClient)
@agent/clapcheeks/profile.py (Profile dataclass with pref_age_min/max, like_ratio)
@agent/clapcheeks/config.py (load/save config from ~/.clapcheeks/config.yaml)
@agent/clapcheeks/imessage/ai_reply.py (existing Ollama pattern to follow for opener.py)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create platforms package and TinderClient</name>
  <files>
    agent/clapcheeks/platforms/__init__.py
    agent/clapcheeks/platforms/tinder.py
  </files>
  <action>
Create `agent/clapcheeks/platforms/__init__.py` as empty init file.

Create `agent/clapcheeks/platforms/tinder.py` with class `TinderClient`:

**Constructor:**
- `__init__(self, driver)` — stores Playwright driver (from Phase 11 browser module). The `driver` is a Playwright Page object passed from `SessionManager.get_driver()`.

**`login(self) -> bool`:**
- Navigate to `https://tinder.com`
- Check if already logged in by looking for the swipe card container (selector: `[class*="recsCardboard"]` or aria-label containing "recommendation"). Try multiple selectors with short timeout (5s).
- If logged in, return True
- If not logged in: print clear instructions to console ("Please log in manually in the browser window. Waiting..."), then poll every 3s for the logged-in selector (timeout 120s). Return True on success, False on timeout.
- No hardcoded credentials, no automated login — manual auth only on first run, session persists after.

**`run_swipe_session(self, like_ratio: float = 0.5, max_swipes: int = 30) -> dict`:**
- Call `self.login()` first. If login fails, return `{"liked": 0, "passed": 0, "errors": 1, "new_matches": []}`.
- Import `clapcheeks.session.rate_limiter` and check daily remaining swipes for "tinder" platform. Cap `max_swipes` to whatever remains under the 100/day limit.
- Loop up to `max_swipes` times:
  - Wait for profile card to be visible (selector: `[class*="recsCardboard"]` or `[data-testid="gamepad"]`, timeout 10s). If timeout, break loop (no more profiles).
  - Extract minimal profile data: name from `[itemprop="name"]` or `span.Typs(display1)`, age from nearby text. Wrap in try/except — extraction failure is non-fatal, just pass empty dict.
  - Call `self._should_like(profile_data, like_ratio)` to decide swipe direction.
  - If like: click the Like button (selector: `button[aria-label="Like"]` or `[data-testid="gamepad-like"]`). If pass: click Nope button (`button[aria-label="Nope"]` or `[data-testid="gamepad-nope"]`).
  - After each swipe, call `self._detect_match()` — if match found, record it.
  - Add random delay: `random.uniform(0.5, 2.0)` seconds between swipes.
  - Increment rate limiter count via `rate_limiter.record_swipe("tinder")`.
  - Track counts in local vars: `liked`, `passed`, `errors`, `new_matches` list.
  - Wrap each swipe iteration in try/except — on error, increment `errors`, continue loop.
- Return `{"liked": liked, "passed": passed, "errors": errors, "new_matches": new_matches}`.

**`_should_like(self, profile_data: dict, like_ratio: float) -> bool`:**
- If profile_data has age and user Profile has pref_age_min/max set (non-default), check age is in range. If out of range, return False.
- Otherwise, use `random.random() < like_ratio` to decide. This keeps it simple — Phase 15 (controller) will add smarter logic.

**`_detect_match(self) -> str | None`:**
- Check for match modal overlay (selector: `[class*="matchAnimation"]`, `[aria-label*="match"]`, or text containing "It's a Match"). Use short timeout (2s).
- If match modal found: extract match name if visible, dismiss modal (click "Send Message" or "Keep Swiping" button — prefer Keep Swiping via `[aria-label*="Keep Swiping"]`).
- Return match name string or None.

**Selector resilience notes:**
- Always try multiple selectors with fallbacks. Use `page.locator("sel1, sel2, sel3").first` pattern.
- Prefer aria-label and data-testid over CSS class names.
- Tinder frequently changes class names; aria-labels are more stable.
- Add a module-level dict `SELECTORS` mapping logical names to CSS selector strings for easy maintenance.

**Import pattern:** Follow existing codebase — `from __future__ import annotations`, type hints, logging via `logging.getLogger(__name__)`.
  </action>
  <verify>
- `python -c "from clapcheeks.platforms.tinder import TinderClient; print('OK')"` succeeds
- TinderClient has methods: login, run_swipe_session, _should_like, _detect_match
- No hardcoded credentials in the file
- `grep -c "random.uniform" agent/clapcheeks/platforms/tinder.py` returns at least 1 (human-like delays)
- `grep -c "rate_limiter" agent/clapcheeks/platforms/tinder.py` returns at least 1 (rate limiting)
  </verify>
  <done>
TinderClient class exists with login (manual auth flow), run_swipe_session (loop with delays and rate limiting), _should_like (ratio + age filter), and _detect_match (modal handling). The existing `cli.py` swipe command can instantiate and use it without changes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create AI opener message generator</name>
  <files>
    agent/clapcheeks/ai/__init__.py
    agent/clapcheeks/ai/opener.py
  </files>
  <action>
Create `agent/clapcheeks/ai/__init__.py` as empty init file.

Create `agent/clapcheeks/ai/opener.py` with function `generate_opener`:

**`generate_opener(match_name: str, profile_data: dict | None = None, model: str | None = None) -> str`:**
- Load config via `clapcheeks.config.load()` to get default model.
- Default model: `config.get("ai_model", "llama3.2")` — same pattern as `imessage/ai_reply.py`.
- Try Ollama first (local inference, no data leaves device):
  - `import ollama`
  - System prompt: "You are helping craft a dating app opener message. Write a short, fun, personalized first message. Keep it 1-2 sentences max. Be genuine and playful, not generic or cheesy. Reply with ONLY the message text."
  - If profile_data has name, age, bio, or interests — include in user message: "Write an opener for {name}. Their profile mentions: {details}."
  - If no profile_data, use: "Write a fun opener for someone named {match_name} on Tinder."
  - Call `ollama.chat(model=model, messages=[...], options={"temperature": 0.9})`
  - Return response content stripped.
- On Ollama `ConnectionError`: try Claude API fallback if `ANTHROPIC_API_KEY` env var exists.
  - Use `anthropic.Anthropic()` client with `messages.create(model="claude-haiku-4-5-20251001", max_tokens=100, ...)` — cheapest model for short generation.
  - Same prompt structure.
- On all failures: return a safe fallback string: f"Hey {match_name}! How's your week going?" — never crash, always return something.

Follow the exact code style of `imessage/ai_reply.py`: logging, try/except ImportError for optional deps, `from __future__ import annotations`.
  </action>
  <verify>
- `python -c "from clapcheeks.ai.opener import generate_opener; print('OK')"` succeeds
- `grep -c "ollama" agent/clapcheeks/ai/opener.py` returns at least 1
- `grep -c "fallback" agent/clapcheeks/ai/opener.py` returns at least 1 (graceful degradation)
- No API keys hardcoded in the file
  </verify>
  <done>
`generate_opener()` function exists, tries Ollama first (local), falls back to Claude API if available, and always returns a usable string. Follows the same pattern as the existing `imessage/ai_reply.py`.
  </done>
</task>

<task type="auto">
  <name>Task 3: Wire opener into TinderClient match flow and add integration test</name>
  <files>
    agent/clapcheeks/platforms/tinder.py
    agent/tests/test_tinder.py
  </files>
  <action>
**Wire opener into TinderClient:**
- In `_detect_match()`, after detecting a match modal: call `generate_opener(match_name, profile_data)` from `clapcheeks.ai.opener`.
- If the match modal has a "Send Message" input/button, type the generated opener and send it. Selectors to try: `textarea[placeholder*="message"]`, `[data-testid="chat-input"]`, `[aria-label*="message"]`.
- If sending fails (no input found, element not interactable), log warning and dismiss modal anyway — opener generation failure must never block the swipe loop.
- Store the opener text in the returned match dict: `{"name": match_name, "opener": opener_text}`.
- Update `new_matches` list items to be dicts instead of plain strings.

**Add unit test:**
Create `agent/tests/test_tinder.py`:
- Test `_should_like()` with various inputs:
  - `like_ratio=1.0` always returns True
  - `like_ratio=0.0` always returns False
  - With profile_data age outside pref range, returns False regardless of ratio
- Test `run_swipe_session()` return format — mock the driver to avoid real browser.
  - Use `unittest.mock.MagicMock` for the driver parameter.
  - Verify return dict has keys: `liked`, `passed`, `errors`, `new_matches`.
  - Verify login failure (mocked) returns error result.
- Test `generate_opener()` fallback — mock ollama ImportError, mock anthropic ImportError, verify fallback string returned.
- Use `pytest` style, follow existing `agent/tests/test_profile.py` patterns.
  </action>
  <verify>
- `cd /opt/agency-workspace/clapcheeks.tech/agent && python -m pytest tests/test_tinder.py -v` passes all tests
- `grep "generate_opener" agent/clapcheeks/platforms/tinder.py` confirms wiring
- `grep "new_matches" agent/clapcheeks/platforms/tinder.py` shows match dicts not just strings
  </verify>
  <done>
TinderClient sends AI openers on match detection. Unit tests verify swipe decision logic, return format, login failure handling, and opener fallback behavior. All tests pass.
  </done>
</task>

</tasks>

<verification>
1. `python -c "from clapcheeks.platforms.tinder import TinderClient; print('import OK')"` — module imports clean
2. `python -c "from clapcheeks.ai.opener import generate_opener; print('import OK')"` — opener imports clean
3. `cd agent && python -m pytest tests/test_tinder.py -v` — all unit tests pass
4. `grep -r "hardcoded\|password\|secret" agent/clapcheeks/platforms/tinder.py agent/clapcheeks/ai/opener.py` — no credentials
5. `python -c "from clapcheeks.cli import main"` — CLI still loads without error (no circular imports)
</verification>

<success_criteria>
- TinderClient fully implements the interface expected by cli.py swipe command (constructor takes driver, run_swipe_session returns {liked, passed, errors, new_matches})
- Manual auth flow works: prints instructions, waits for user login, resumes automation
- Swipe loop has human-like delays (0.5-2s random) between each action
- Rate limiter enforces 100 swipes/day cap for tinder platform
- Match detection finds and dismisses match modals
- AI opener generates personalized messages via Ollama (local) with Claude fallback
- All unit tests pass
- No hardcoded credentials anywhere
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-12-tinder/12-01-SUMMARY.md`
</output>
