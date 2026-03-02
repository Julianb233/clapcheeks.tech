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
  - agent/clapcheeks/session/rate_limiter.py
autonomous: true

must_haves:
  truths:
    - "User can run a Bumble swipe session with human-like delays"
    - "Bumble daily limit of 75 swipes is enforced by rate limiter"
    - "User can check the Beehive queue for pending matches"
    - "User can send AI-generated opener messages to matches where it is their turn"
    - "Session persists across runs so user only authenticates manually once"
    - "run_swipe_session returns {liked, passed, errors, openers_sent} dict"
  artifacts:
    - path: "agent/clapcheeks/platforms/bumble.py"
      provides: "BumbleClient with login, swipe, beehive, and opener methods"
      exports: ["BumbleClient"]
    - path: "agent/clapcheeks/session/rate_limiter.py"
      provides: "Bumble-specific daily limit (75 swipes)"
      contains: "bumble"
  key_links:
    - from: "agent/clapcheeks/platforms/bumble.py"
      to: "agent/clapcheeks/session/rate_limiter.py"
      via: "checks remaining swipes before each action"
      pattern: "rate_limiter.*bumble|check_limit.*bumble"
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
Implement BumbleClient — the Bumble dating app automation client using the
Playwright browser driver from Phase 11. Supports swiping, Beehive match queue
scanning, and AI-generated first messages.

Purpose: Bumble is the second major dating platform. Its "women message first"
mechanic requires special handling — the client must detect whose turn it is to
message and only send openers when it is the user's turn.

Output: `agent/clapcheeks/platforms/bumble.py` with full BumbleClient class,
plus Bumble-specific rate limit registration in the session rate limiter.
</objective>

<context>
@.planning/ROADMAP.md (Phase 13 definition)
@.planning/milestone-3/README.md (Milestone 3 overview)
@agent/clapcheeks/cli.py (swipe command already imports BumbleClient at line 126)
</context>

<tasks>

<task type="auto">
  <name>Task 1: BumbleClient core — login and swipe session</name>
  <files>
    agent/clapcheeks/platforms/bumble.py
  </files>
  <action>
Create `agent/clapcheeks/platforms/bumble.py` with class `BumbleClient`.

Follow the same interface pattern established by TinderClient in Phase 12.
The CLI already expects `BumbleClient(driver=driver)` and calls
`client.run_swipe_session(like_ratio=..., max_swipes=...)`.

**__init__(self, driver)**
- Store the Playwright browser driver (from Phase 11 SessionManager).
- Set `self.base_url = "https://bumble.com/app"`.
- Import and use rate limiter: `from clapcheeks.session.rate_limiter import check_limit, record_swipe`.

**login(self)**
- Navigate to `self.base_url`.
- Check if already logged in by looking for the main feed selector
  (e.g., `[data-qa-role="encounters-card"]` or `.encounters-story-profile`).
- If not logged in, print instructions for manual auth:
  "Please log in to Bumble in the browser window. Press Enter when done."
- Wait for the user to authenticate (Bumble uses phone number + SMS or social login).
- After login detected, save cookies/storage state via Playwright's
  `context.storage_state(path=storage_path)` to `~/.clapcheeks/bumble_state.json`.
- On subsequent runs, load storage state first to skip manual login.

**run_swipe_session(self, like_ratio=0.5, max_swipes=30) -> dict**
- Call `self.login()` first.
- Check rate limiter: `remaining = check_limit("bumble")`. If 0, return early
  with `{liked: 0, passed: 0, errors: 0, openers_sent: 0, reason: "daily_limit"}`.
- Cap `max_swipes` to `min(max_swipes, remaining)`.
- Main loop for `max_swipes` iterations:
  1. Wait for profile card to be visible (selector: `[data-qa-role="encounters-card"]`
     or fallback `.encounters-story-profile`). Use `page.wait_for_selector()` with
     10s timeout. If timeout, break loop (no more profiles).
  2. Add random human-like delay: `random.uniform(1.5, 4.0)` seconds.
  3. Decide like/pass based on `like_ratio` using `random.random() < like_ratio`.
  4. If LIKE: click the like button (selector: `[data-qa-role="encounters-action-like"]`
     or fallback `button.encounters-action--like`).
     If PASS: click the pass button (selector: `[data-qa-role="encounters-action-dislike"]`
     or fallback `button.encounters-action--dislike`).
  5. Record swipe: `record_swipe("bumble", "right" if liked else "left")`.
  6. Check for match popup after like: look for match modal
     (selector: `.encounters-match` or `[data-qa-role="match-popup"]`).
     If found, dismiss it (click continue/close button), increment match counter.
  7. Add inter-swipe delay: `random.uniform(0.8, 2.5)` seconds.
  8. Wrap each iteration in try/except to catch selector timeouts, increment error counter.
- After loop, call `self.check_beehive()` and `self._send_pending_openers()`.
- Return `{"liked": N, "passed": N, "errors": N, "openers_sent": N, "new_matches": [...]}`.

**Selector strategy:** Prefer `data-qa-role` and `data-testid` attributes first,
fall back to semantic aria-labels, then class-based selectors as last resort.
Bumble uses `data-qa-role` extensively. Define selectors as class constants at the
top of BumbleClient for easy updates if Bumble changes their DOM.

**Human-like behavior:**
- Random delays between actions (already specified above).
- Occasional longer pauses: every 8-15 swipes, pause for `random.uniform(5.0, 15.0)` seconds.
- Randomize the like_ratio slightly per decision: `random.random() < like_ratio + random.uniform(-0.05, 0.05)`.
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.platforms.bumble import BumbleClient; print('BumbleClient import OK')"`

Verify the class has required methods: `python -c "from clapcheeks.platforms.bumble import BumbleClient; assert all(hasattr(BumbleClient, m) for m in ['login', 'run_swipe_session', 'check_beehive', 'send_opener']); print('methods OK')"`
  </verify>
  <done>
    - BumbleClient class exists with login(), run_swipe_session(), check_beehive(), send_opener()
    - login() persists session to ~/.clapcheeks/bumble_state.json
    - run_swipe_session() returns {liked, passed, errors, openers_sent} dict
    - Human-like delays between all actions (1.5-4s per swipe, periodic long pauses)
    - Selectors use data-qa-role first, with fallback selectors defined as class constants
  </done>
</task>

<task type="auto">
  <name>Task 2: Beehive queue scanner and AI opener integration</name>
  <files>
    agent/clapcheeks/platforms/bumble.py
  </files>
  <action>
Add two methods to BumbleClient (in the same file created in Task 1):

**check_beehive(self) -> list[dict]**
- Navigate to the Beehive / matches queue. Bumble's match queue is accessible via
  the matches tab (selector: `[data-qa-role="chat-list"]` or nav item linking to
  `/app/connections`).
- Scan the list of pending matches. For each match entry:
  - Extract match name (from `.encounters-match__name` or `[data-qa-role="chat-list-item-name"]`).
  - Detect if it is the USER's turn to send first message. On Bumble:
    - For heterosexual matches: women message first. If user is male, they CANNOT
      send the first message — they must wait. If user is female, they MUST send first.
    - Detect "Your turn" / "Their turn" indicator in the match card DOM.
    - Look for expiry timer (24h countdown) — selector: `.conversations-expiry`
      or text containing time remaining.
  - Build match dict: `{"name": str, "user_turn": bool, "expires_in": str | None, "match_element": element_handle}`.
- Return list of match dicts where `user_turn=True` (actionable matches only).
- Log total matches found and how many are actionable.

**send_opener(self, match: dict) -> str | None**
- Takes a match dict from check_beehive().
- Click on the match to open the conversation view.
- Wait for message input to be visible (selector: `[data-qa-role="messenger-input"]`
  or `textarea.messenger-input`).
- Generate opener using AI:
  ```python
  from clapcheeks.ai.opener import generate_opener
  opener = generate_opener(match_name=match["name"], platform="bumble")
  ```
  The `ai/opener.py` module exists from Phase 12 — it takes a match name and
  platform and returns a contextual first message string.
- Type the opener into the message input with human-like keystroke delays:
  use `page.type(selector, text, delay=random.randint(30, 80))` to simulate typing.
- Press Enter or click send button (selector: `[data-qa-role="messenger-send"]`).
- Wait briefly (1-2s) to confirm message appeared in conversation.
- Navigate back to match list.
- Return the opener text on success, None on failure.

**_send_pending_openers(self) -> int**
- Private method called at end of run_swipe_session().
- Call check_beehive() to get actionable matches.
- For each actionable match (user_turn=True), call send_opener().
- Add random delay between openers: `random.uniform(10.0, 30.0)` seconds
  (longer delay here since sending messages is more sensitive to rate detection).
- Return count of successfully sent openers.
- Cap at 5 openers per session to avoid triggering anti-spam detection.
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.platforms.bumble import BumbleClient; bc = type('MockBC', (), {'check_beehive': BumbleClient.check_beehive, 'send_opener': BumbleClient.send_opener}); print('beehive + opener methods OK')"`

Grep for data-qa-role usage: `grep -c 'data-qa-role' agent/clapcheeks/platforms/bumble.py` should return 5+.
  </verify>
  <done>
    - check_beehive() scans match queue and returns actionable matches with user_turn flag
    - send_opener() generates AI opener via ai/opener.py and types it with human-like delays
    - _send_pending_openers() runs after swipe session, capped at 5 per session
    - Match expiry detection (24h countdown) captured in match dict
    - Longer delays between opener sends (10-30s) to avoid anti-spam
  </done>
</task>

<task type="auto">
  <name>Task 3: Bumble rate limit registration</name>
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

Verify the existing `check_limit(platform)` and `record_swipe(platform, direction)`
functions work with "bumble" as the platform key. The rate limiter stores daily
counts in `~/.clapcheeks/rate_limits.json` with date-keyed entries. No structural
changes needed — just adding the "bumble" entry to DAILY_LIMITS.

If the rate limiter uses a different structure, adapt accordingly but ensure:
- `check_limit("bumble")` returns remaining swipes (75 - today's count)
- `record_swipe("bumble", "right"|"left")` increments today's count
- `get_daily_summary()` includes bumble counts (CLI status command uses this)

Also ensure `__init__.py` exists at `agent/clapcheeks/platforms/` so the package
is importable. Create it if missing (empty file).
  </action>
  <verify>
Run: `cd /opt/agency-workspace/clapcheeks.tech/agent && python -c "from clapcheeks.session.rate_limiter import check_limit, record_swipe; print('rate_limiter OK')"`

Verify bumble limit: `python -c "from clapcheeks.session.rate_limiter import DAILY_LIMITS; assert DAILY_LIMITS.get('bumble') == 75; print('bumble limit OK')"`
  </verify>
  <done>
    - DAILY_LIMITS includes "bumble": 75
    - check_limit("bumble") returns remaining swipes for today
    - record_swipe("bumble", direction) tracks Bumble swipes
    - get_daily_summary() includes bumble platform counts
    - agent/clapcheeks/platforms/__init__.py exists
  </done>
</task>

</tasks>

<verification>
1. BumbleClient imports: `from clapcheeks.platforms.bumble import BumbleClient` succeeds
2. CLI integration: `clapcheeks swipe --platform bumble --help` shows options
3. Rate limiter: `check_limit("bumble")` returns 75 on a fresh day
4. No hardcoded credentials or tokens in bumble.py
5. All selectors use data-qa-role or aria-label (grep confirms no raw class-only selectors
   without a data-attribute fallback)
6. Human-like delays present: grep for `random.uniform` shows 3+ occurrences in bumble.py
7. Session persistence: bumble_state.json path referenced for cookie storage
</verification>

<success_criteria>
- `clapcheeks swipe --platform bumble` runs a Bumble swipe session with human-like delays
- Rate limiter enforces 75 swipes/day for Bumble
- After swiping, beehive is checked and openers sent to actionable matches
- Opener messages typed with keystroke simulation (30-80ms per character)
- Session persists across runs via ~/.clapcheeks/bumble_state.json
- run_swipe_session returns complete results dict {liked, passed, errors, openers_sent}
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-13-bumble/SUMMARY.md`
</output>
