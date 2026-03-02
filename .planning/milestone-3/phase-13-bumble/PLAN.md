---
phase: 13-bumble
plan: 01
type: execute
wave: 1
depends_on:
  - 11-playwright
  - 12-tinder
files_modified:
  - agent/clapcheeks/platforms/bumble.py
  - agent/clapcheeks/platforms/bumble_api.py
  - agent/clapcheeks/platforms/bumble_web.py
  - agent/clapcheeks/session/rate_limiter.py
autonomous: true

must_haves:
  truths:
    - "BumbleClient auto-selects between web (Track A) and API (Track B) backends"
    - "Track B (direct API) works without any browser, using reverse-engineered endpoints"
    - "Track A (Playwright web) intercepts API calls and falls back to DOM for actions"
    - "Both tracks implement the same BumbleBackend interface and are swappable"
    - "User can run a Bumble swipe session with human-like delays via either track"
    - "Bumble daily limit of 75 swipes is enforced by rate limiter"
    - "User can check the match queue for pending matches"
    - "User can send AI-generated opener messages to matches where it is their turn"
    - "Session persists across runs so user only authenticates manually once"
    - "run_swipe_session returns {liked, passed, errors, openers_sent} dict"
  artifacts:
    - path: "agent/clapcheeks/platforms/bumble.py"
      provides: "BumbleClient facade with backend auto-selection, BumbleBackend ABC"
      exports: ["BumbleClient", "BumbleBackend"]
    - path: "agent/clapcheeks/platforms/bumble_api.py"
      provides: "APIBumbleBackend — direct HTTP API client (Track B, long-term)"
      exports: ["APIBumbleBackend"]
    - path: "agent/clapcheeks/platforms/bumble_web.py"
      provides: "PlaywrightBumbleBackend — browser automation with API interception (Track A, bridge)"
      exports: ["PlaywrightBumbleBackend"]
    - path: "agent/clapcheeks/session/rate_limiter.py"
      provides: "Bumble-specific daily limit (75 swipes)"
      contains: "bumble"
  key_links:
    - from: "agent/clapcheeks/platforms/bumble.py"
      to: "agent/clapcheeks/platforms/bumble_api.py"
      via: "imports APIBumbleBackend as default backend"
      pattern: "from clapcheeks.platforms.bumble_api import APIBumbleBackend"
    - from: "agent/clapcheeks/platforms/bumble.py"
      to: "agent/clapcheeks/platforms/bumble_web.py"
      via: "imports PlaywrightBumbleBackend as fallback when driver provided"
      pattern: "from clapcheeks.platforms.bumble_web import PlaywrightBumbleBackend"
    - from: "agent/clapcheeks/platforms/bumble.py"
      to: "agent/clapcheeks/session/rate_limiter.py"
      via: "checks remaining swipes before each action"
      pattern: "rate_limiter.*bumble|check_limit.*bumble|can_swipe"
    - from: "agent/clapcheeks/platforms/bumble.py"
      to: "agent/clapcheeks/ai/opener.py"
      via: "generates first message for matches"
      pattern: "generate_opener|OpenerGenerator"
    - from: "agent/clapcheeks/cli.py"
      to: "agent/clapcheeks/platforms/bumble.py"
      via: "swipe command imports BumbleClient"
      pattern: "from clapcheeks.platforms.bumble import BumbleClient"
---

<objective>
Implement a dual-track BumbleClient that works both NOW (via Playwright web automation
while bumble.com exists) and AFTER the web shutdown (via direct API calls to Bumble's
reverse-engineered HTTP endpoints).

**Why dual-track:** Bumble has officially announced the web app will be discontinued.
The web UI could redirect to "download the app" at any time. A pure-web automation
approach (like the original Phase 13 plan) has a shrinking lifespan. The direct API
approach is the long-term solution.

**Architecture:** An abstract `BumbleBackend` interface with two implementations:
- **Track A — PlaywrightBumbleBackend** (`bumble_web.py`): Browser automation with
  API response interception. Works while web exists. Captures session tokens for
  potential Track B handoff.
- **Track B — APIBumbleBackend** (`bumble_api.py`): Pure HTTP client using Bumble's
  `mwebapi.phtml` endpoint with MD5 request signing. No browser needed. Survives
  web shutdown.

The public `BumbleClient` facade auto-selects the backend: if a Playwright driver is
provided, use Track A; otherwise, use Track B. The CLI import
`from clapcheeks.platforms.bumble import BumbleClient` remains unchanged.

Output:
- `agent/clapcheeks/platforms/bumble.py` — BumbleClient facade + BumbleBackend ABC
- `agent/clapcheeks/platforms/bumble_api.py` — Track B (direct API)
- `agent/clapcheeks/platforms/bumble_web.py` — Track A (Playwright web)
- Updated `agent/clapcheeks/session/rate_limiter.py` with Bumble limits
</objective>

<context>
@.planning/milestone-3/phase-13-bumble/RESEARCH.md (Bumble API details, DataDome, web shutdown)
@.planning/ROADMAP.md (Phase 13 definition)
@.planning/milestone-3/README.md (Milestone 3 overview)
@agent/clapcheeks/platforms/tinder.py (TinderClient pattern to follow)
@agent/clapcheeks/cli.py (swipe command already imports BumbleClient at line 126)
</context>

<tasks>

<task type="auto">
  <name>Task 1: BumbleBackend ABC and BumbleClient facade</name>
  <files>
    agent/clapcheeks/platforms/bumble.py
  </files>
  <action>
Rewrite `agent/clapcheeks/platforms/bumble.py` to be the abstraction layer.

**BumbleBackend (ABC)**

Define the abstract interface that both Track A and Track B implement:

```python
from abc import ABC, abstractmethod
from typing import Optional

class BumbleBackend(ABC):
    @abstractmethod
    def authenticate(self) -> bool: ...

    @abstractmethod
    def get_encounters(self, count: int = 20) -> list[dict]: ...

    @abstractmethod
    def vote(self, user_id: str, like: bool) -> bool: ...

    @abstractmethod
    def get_matches(self) -> list[dict]: ...

    @abstractmethod
    def send_message(self, chat_id: str, message: str) -> bool: ...
```

**BumbleClient (facade)**

The public class that the CLI and rest of the codebase uses:

```python
class BumbleClient:
    def __init__(self, driver=None, backend: str = "auto"):
        if backend == "api" or (backend == "auto" and driver is None):
            from clapcheeks.platforms.bumble_api import APIBumbleBackend
            self._backend = APIBumbleBackend()
        else:
            from clapcheeks.platforms.bumble_web import PlaywrightBumbleBackend
            self._backend = PlaywrightBumbleBackend(driver)
```

**BumbleClient methods** (delegate to backend + add human behavior + rate limiting):

- `login(self)` — calls `self._backend.authenticate()`. Persists session to
  `~/.clapcheeks/bumble_state.json`.

- `run_swipe_session(self, like_ratio=0.5, max_swipes=30) -> dict` — Main swipe loop:
  1. Call `self.login()`.
  2. Check rate limiter: `remaining = can_swipe("bumble")`. If 0, return early.
  3. Cap max_swipes to remaining.
  4. Get encounters via `self._backend.get_encounters(max_swipes)`.
  5. For each encounter, add human-like delay `random.uniform(1.5, 4.0)` seconds.
  6. Decide like/pass based on `like_ratio` (with `random.uniform(-0.05, 0.05)` jitter).
  7. Call `self._backend.vote(user_id, like)`.
  8. Call `record_swipe("bumble", "right" if liked else "left")`.
  9. Every 8-15 swipes, add long pause `random.uniform(5.0, 15.0)` seconds.
  10. After loop, call `self._check_and_send_openers()`.
  11. Return `{"liked": N, "passed": N, "errors": N, "openers_sent": N}`.

- `check_beehive(self) -> list[dict]` — calls `self._backend.get_matches()`,
  filters to `user_turn=True` only, returns actionable matches.

- `send_opener(self, match: dict) -> str | None` — generates opener via
  `from clapcheeks.ai.opener import generate_opener`, calls
  `self._backend.send_message(match["chat_id"], opener)`. Returns opener text on
  success, None on failure.

- `_check_and_send_openers(self) -> int` — private method called after swipe session.
  Gets actionable matches, sends up to 5 openers with `random.uniform(10.0, 30.0)`
  second delays between them.

**IMPORTANT:** The existing bumble.py has a working implementation with DOM selectors
and a class structure. Preserve the SELECTORS dict and move it to bumble_web.py.
The new bumble.py should be the clean facade layer only.
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.platforms.bumble import BumbleClient, BumbleBackend; print('facade import OK')"`

Verify BumbleBackend is abstract: `python -c "from clapcheeks.platforms.bumble import BumbleBackend; import inspect; assert inspect.isabstract(BumbleBackend); print('ABC OK')"`

Verify BumbleClient has all methods: `python -c "from clapcheeks.platforms.bumble import BumbleClient; assert all(hasattr(BumbleClient, m) for m in ['login', 'run_swipe_session', 'check_beehive', 'send_opener']); print('methods OK')"`
  </verify>
  <done>
    - BumbleBackend ABC with authenticate, get_encounters, vote, get_matches, send_message
    - BumbleClient facade auto-selects backend (API if no driver, Playwright if driver)
    - run_swipe_session delegates to backend with human-like delays and rate limiting
    - check_beehive and send_opener work via backend abstraction
    - _check_and_send_openers capped at 5 per session with 10-30s delays
    - CLI import `from clapcheeks.platforms.bumble import BumbleClient` unchanged
  </done>
</task>

<task type="auto">
  <name>Task 2: Track B — APIBumbleBackend (direct API client)</name>
  <files>
    agent/clapcheeks/platforms/bumble_api.py
  </files>
  <action>
Create `agent/clapcheeks/platforms/bumble_api.py` — the long-term API client that
works without a browser.

**THIS IS THE PRIORITY IMPLEMENTATION.** Track B is the future-proof approach.

**Reference:** henrydatei/bumble-api (api.py) and orestis-z/bumble-bot (bot.py).

**Constants:**

```python
BUMBLE_API_URL = "https://bumble.com/mwebapi.phtml"
SIGNING_SECRET = "whitetelevisionbulbelectionroofhorseflying"
SESSION_FILE = Path.home() / ".clapcheeks" / "bumble_api_session.json"

# Message type IDs
MSG_APP_STARTUP = 2
MSG_ENCOUNTERS_VOTE = 80
MSG_GET_ENCOUNTERS = 81
MSG_OPEN_CHAT = 102
MSG_SEND_MESSAGE = 104
MSG_GET_USER_LIST = 245
MSG_GET_USER = 403

# Vote values
VOTE_LIKE = 2
VOTE_PASS = 3

# Projection field IDs for user profiles
PROFILE_PROJECTIONS = [210, 370, 200, 230, 490, 540, 530, 560, 291, 732]
```

**APIBumbleBackend class** (implements BumbleBackend):

**_sign_request(self, body_str: str) -> str**
- Compute `hashlib.md5((body_str + SIGNING_SECRET).encode()).hexdigest()`.

**_make_request(self, message_type: int, body_content: dict) -> dict**
- Build the protobuf-like JSON wrapper:
  ```python
  payload = {
      "$gpb": "badoo.bma.BadooMessage",
      "body": [body_content],
      "message_id": self._next_msg_id(),
      "message_type": message_type,
      "version": 1,
      "is_background": False,
  }
  ```
- Serialize to JSON string.
- Sign with `_sign_request()`.
- Set headers:
  - `Content-Type: application/json`
  - `X-Pingback: <signature>`
  - `X-Message-type: <message_type>`
  - `x-use-session-cookie: 1`
  - `Cookie: session=<token>`
  - `User-Agent: <realistic browser UA>`
- POST to `BUMBLE_API_URL`.
- If response status is 401, clear session and raise `AuthenticationError`.
- Return parsed JSON response.

**authenticate(self) -> bool**
- Load session from `SESSION_FILE` if it exists.
- Test session with a lightweight API call (e.g., `SERVER_APP_STARTUP`).
- If session is valid, return True.
- If session is invalid or missing, prompt user:
  `"No valid Bumble session. Please provide your session token (from browser cookies): "`
- Save new session to `SESSION_FILE`.
- Return True on success.

**Session acquisition instructions (print to user on first run):**
```
To get your Bumble session token:
1. Open bumble.com in your browser (or mobile app with dev tools)
2. Open Developer Tools > Application > Cookies
3. Find the cookie named "session"
4. Copy its value and paste it here
```

**get_encounters(self, count: int = 20) -> list[dict]**
- Call `_make_request(MSG_GET_ENCOUNTERS, {...})` with `number: count` and projection fields.
- Parse response body for `client_encounters.results[]`.
- For each result, extract: `user_id`, `name`, `age`, `bio`, `photo_urls`, `distance`.
- Return list of encounter dicts.

**vote(self, user_id: str, like: bool) -> bool**
- Call `_make_request(MSG_ENCOUNTERS_VOTE, {...})` with `person_id: user_id` and
  `vote: VOTE_LIKE if like else VOTE_PASS`.
- Return True if response indicates success.

**get_matches(self) -> list[dict]**
- Call `_make_request(MSG_GET_USER_LIST, {...})` with `section: 200` (conversations).
- Parse response for match list.
- For each match, determine `user_turn` from conversation state (check if last message
  was from the other person or if no messages exist and user can send).
- Extract `chat_id`, `name`, `user_turn`, `last_message_time`.
- Return list of match dicts.

**send_message(self, chat_id: str, message: str) -> bool**
- Call `_make_request(MSG_SEND_MESSAGE, {...})` with `chat_instance_id: chat_id`
  and `mssg: message`.
- Return True if response indicates success.

**Error handling:**
- Wrap all API calls in try/except.
- On 401: clear session, raise `AuthenticationError`.
- On 403 (signature failure): log error suggesting signing secret may have changed.
- On network errors: log and return empty results / False.
- All errors logged with `logger.error(...)`.
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.platforms.bumble_api import APIBumbleBackend; print('API backend import OK')"`

Verify implements BumbleBackend: `python -c "from clapcheeks.platforms.bumble_api import APIBumbleBackend; from clapcheeks.platforms.bumble import BumbleBackend; assert issubclass(APIBumbleBackend, BumbleBackend); print('implements BumbleBackend OK')"`

Verify signing: `python -c "from clapcheeks.platforms.bumble_api import APIBumbleBackend; b = APIBumbleBackend.__new__(APIBumbleBackend); sig = b._sign_request('test'); import hashlib; expected = hashlib.md5(b'testwhitetelevisionbulbelectionroofhorseflying').hexdigest(); assert sig == expected; print('signing OK')"`
  </verify>
  <done>
    - APIBumbleBackend implements BumbleBackend with all 5 abstract methods
    - MD5 request signing with known secret "whitetelevisionbulbelectionroofhorseflying"
    - All 7 message types defined as constants
    - Session persistence to ~/.clapcheeks/bumble_api_session.json
    - Interactive session token acquisition on first run
    - 401 detection with session invalidation
    - 403 detection with signing secret warning
    - No browser dependency — works post-web-shutdown
  </done>
</task>

<task type="auto">
  <name>Task 3: Track A — PlaywrightBumbleBackend (web automation + API interception)</name>
  <files>
    agent/clapcheeks/platforms/bumble_web.py
  </files>
  <action>
Create `agent/clapcheeks/platforms/bumble_web.py` — the browser-based backend that
works while bumble.com exists.

**Move the SELECTORS dict from the existing bumble.py into this file.**

**PlaywrightBumbleBackend class** (implements BumbleBackend):

```python
SELECTORS = {
    "card": '[data-qa-role="encounters-card"], .encounters-story-profile',
    "name": '[data-qa-role="encounters-card-name"], .encounters-story-profile__name',
    "like": '[data-qa-role="encounters-action-like"], button.encounters-action--like',
    "dislike": '[data-qa-role="encounters-action-dislike"], button.encounters-action--dislike',
    "match_modal": '[data-qa-role="match-popup"], .encounters-match',
    "match_dismiss": '[data-qa-role="match-popup-close"], .encounters-match__cta',
    "chat_tab": '[data-qa-role="chat-list"], a[href*="/app/connections"]',
    "chat_item": '[data-qa-role="chat-list-item"], .contacts-item',
    "chat_item_name": '[data-qa-role="chat-list-item-name"], .contacts-item__name',
    "user_turn_badge": '[data-qa-role="your-turn"], .conversations-your-turn, :text("Your turn")',
    "expiry_timer": '.conversations-expiry, [data-qa-role="expiry-timer"]',
    "message_input": '[data-qa-role="messenger-input"], textarea.messenger-input',
    "send_button": '[data-qa-role="messenger-send"], button.messenger-send',
}
```

**__init__(self, driver)**
- Store driver, set `self.base_url = "https://bumble.com/app"`.
- Initialize `self._captured_session = None` for API interception.
- Set up API response interception on the page.

**_setup_api_interception(self, page)**
- Register `page.on("request", ...)` handler to capture:
  - Session cookie from API requests
  - Request headers for potential Track B handoff
- Register `page.on("response", ...)` handler to capture:
  - `SERVER_GET_ENCOUNTERS` responses (structured profile data)
  - Match list responses
- Store captured data in `self._api_cache`.

**authenticate(self) -> bool**
- Navigate to `self.base_url`.
- Check if already logged in (look for encounters card).
- If not logged in, prompt: "Please log in to Bumble in the browser window. Press Enter when done."
- Wait for swipe UI to appear.
- Save storage state to `~/.clapcheeks/bumble_state.json`.
- Also save any captured session token to `~/.clapcheeks/bumble_api_session.json`
  (enables Track B handoff).
- Return True.

**get_encounters(self, count: int = 20) -> list[dict]**
- If `_api_cache` has intercepted encounter data, use that (structured, reliable).
- Otherwise, wait for card selector, extract name from DOM.
- Return list of encounter dicts with `user_id` (if available from API) or
  `element_handle` (for DOM-based interaction).

**vote(self, user_id: str, like: bool) -> bool**
- Click the like or dislike button via DOM selector.
- Wait for card transition (next card or match modal).
- If match modal appears, dismiss it.
- Return True on success, False on timeout.

**get_matches(self) -> list[dict]**
- Navigate to connections page (`/app/connections`).
- Scan chat list items.
- For each item: extract name, detect "Your turn" badge, detect expiry timer.
- Build match dicts with `chat_id` (from element or URL), `name`, `user_turn`, `expires_in`.
- Return list of matches.

**send_message(self, chat_id: str, message: str) -> bool**
- Click on the match/chat item to open conversation.
- Wait for message input to be visible.
- Type message with human-like keystroke delays: `page.type(selector, text, delay=random.randint(30, 80))`.
- Click send button or press Enter.
- Wait 1-2s to confirm message appeared.
- Navigate back to match list.
- Return True on success.

**Web shutdown detection:**
- In `authenticate()`, after navigating to bumble.com, check for:
  - Redirect to app store / download page
  - "Bumble web has been discontinued" message
  - Missing encounters UI after 30s
- If detected, log warning: "Bumble web appears to be shut down. Switch to API backend with: BumbleClient(backend='api')"
- Return False.
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.platforms.bumble_web import PlaywrightBumbleBackend; print('web backend import OK')"`

Verify implements BumbleBackend: `python -c "from clapcheeks.platforms.bumble_web import PlaywrightBumbleBackend; from clapcheeks.platforms.bumble import BumbleBackend; assert issubclass(PlaywrightBumbleBackend, BumbleBackend); print('implements BumbleBackend OK')"`

Verify SELECTORS exist: `python -c "from clapcheeks.platforms.bumble_web import SELECTORS; assert len(SELECTORS) >= 10; print('selectors OK')"`
  </verify>
  <done>
    - PlaywrightBumbleBackend implements BumbleBackend with all 5 abstract methods
    - SELECTORS dict moved from old bumble.py (data-qa-role primary, class fallback)
    - API response interception via page.on("response") for structured data
    - Session token capture for Track B handoff
    - Web shutdown detection with user-friendly warning
    - Human-like keystroke delays for message typing (30-80ms per char)
    - Storage state persistence for session reuse
  </done>
</task>

<task type="auto">
  <name>Task 4: Bumble rate limit registration</name>
  <files>
    agent/clapcheeks/session/rate_limiter.py
  </files>
  <action>
Update the rate limiter module (created in Phase 12 for Tinder) to include
Bumble-specific daily limits.

The rate limiter should already have a pattern like:
```python
DAILY_LIMITS = {
    "tinder": 100,
}
```

Add Bumble:
```python
DAILY_LIMITS = {
    "tinder": 100,
    "bumble": 75,
}
```

Verify the existing `can_swipe(platform)` and `record_swipe(platform, direction)`
functions work with "bumble" as the platform key. The rate limiter stores daily
counts in `~/.clapcheeks/rate_limits.json` with date-keyed entries. No structural
changes needed — just adding the "bumble" entry to DAILY_LIMITS.

If the rate limiter uses a different structure, adapt accordingly but ensure:
- `can_swipe("bumble")` returns remaining swipes (75 - today's count), or bool
- `record_swipe("bumble", "right"|"left")` increments today's count
- `get_daily_summary()` includes bumble counts (CLI status command uses this)

Also ensure `__init__.py` exists at `agent/clapcheeks/platforms/` so the package
is importable. Create it if missing (empty file).
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.session.rate_limiter import can_swipe, record_swipe; print('rate_limiter OK')"`

Verify bumble limit: `python -c "from clapcheeks.session.rate_limiter import DAILY_LIMITS; assert DAILY_LIMITS.get('bumble') == 75; print('bumble limit OK')"`
  </verify>
  <done>
    - DAILY_LIMITS includes "bumble": 75
    - can_swipe("bumble") returns remaining swipes for today
    - record_swipe("bumble", direction) tracks Bumble swipes
    - get_daily_summary() includes bumble platform counts
    - agent/clapcheeks/platforms/__init__.py exists
  </done>
</task>

</tasks>

<verification>
1. BumbleClient imports: `from clapcheeks.platforms.bumble import BumbleClient` succeeds
2. BumbleBackend is abstract: `inspect.isabstract(BumbleBackend)` is True
3. APIBumbleBackend imports: `from clapcheeks.platforms.bumble_api import APIBumbleBackend` succeeds
4. PlaywrightBumbleBackend imports: `from clapcheeks.platforms.bumble_web import PlaywrightBumbleBackend` succeeds
5. Backend auto-selection: `BumbleClient()` (no driver) uses APIBumbleBackend
6. Backend auto-selection: `BumbleClient(driver=mock)` uses PlaywrightBumbleBackend
7. Rate limiter: `can_swipe("bumble")` returns truthy on fresh day
8. No hardcoded credentials or session tokens in any file
9. MD5 signing test: `_sign_request("test")` matches expected hash
10. Human-like delays present: grep for `random.uniform` shows 3+ occurrences in bumble.py
11. Session persistence: both `bumble_state.json` and `bumble_api_session.json` paths referenced
12. Web shutdown detection: bumble_web.py checks for redirect/shutdown on authenticate()
</verification>

<success_criteria>
- `BumbleClient()` (no driver) creates an API-backed client that works post-web-shutdown
- `BumbleClient(driver=driver)` creates a web-backed client for current use
- `BumbleClient(backend="api")` forces API mode regardless of driver
- Both backends implement identical BumbleBackend interface
- `clapcheeks swipe --platform bumble` runs a Bumble swipe session via either track
- Rate limiter enforces 75 swipes/day for Bumble
- After swiping, match queue is checked and openers sent to actionable matches
- Session persists across runs via ~/.clapcheeks/ state files
- run_swipe_session returns complete results dict {liked, passed, errors, openers_sent}
- Track B (API) works without any browser installed
- Track A (web) captures session tokens for Track B handoff
- Track A detects web shutdown and warns user to switch to Track B
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-13-bumble/SUMMARY.md`
</output>
