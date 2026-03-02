---
phase: 14-hinge
plan: 01
type: execute
wave: 1
depends_on:
  - "11-01"
  - "12-01"
files_modified:
  - agent/clapcheeks/platforms/hinge.py
  - agent/clapcheeks/session/rate_limiter.py
autonomous: true

must_haves:
  truths:
    - "clapcheeks swipe --platform hinge iterates through the Hinge feed, liking or skipping profiles"
    - "When a profile has a prompt, the AI generates a 1-2 sentence comment that feels human and natural"
    - "When a profile has no prompt or AI comment is skipped, the client likes the best photo instead"
    - "The session stops after 50 likes per day regardless of max_swipes setting"
    - "The session returns a results dict with liked, passed, errors, and commented counts"
  artifacts:
    - path: "agent/clapcheeks/platforms/hinge.py"
      provides: "HingeClient with login, swipe session, prompt comment generation, photo like, and comment like"
      exports: ["HingeClient"]
    - path: "agent/clapcheeks/session/rate_limiter.py"
      provides: "Daily rate limiter with per-platform limits (updated with Hinge 50/day cap)"
      contains: "hinge.*50"
  key_links:
    - from: "agent/clapcheeks/cli.py"
      to: "agent/clapcheeks/platforms/hinge.py"
      via: "dynamic import in swipe command when platform == 'hinge'"
      pattern: "from clapcheeks\\.platforms\\.hinge import HingeClient"
    - from: "agent/clapcheeks/platforms/hinge.py"
      to: "ai_service_url"
      via: "HTTP POST to Ollama/Claude for prompt comment generation"
      pattern: "requests\\.post.*ai_service_url"
    - from: "agent/clapcheeks/platforms/hinge.py"
      to: "agent/clapcheeks/session/rate_limiter.py"
      via: "check_limit and record_action calls to enforce 50/day"
      pattern: "rate_limiter|check_limit|record_action"
---

<objective>
Implement HingeClient for automated Hinge like/skip sessions with AI-generated prompt comments.

Purpose: Hinge is fundamentally different from Tinder/Bumble -- there is no swipe UI. Users "like" individual photos or respond to prompts with a comment. Prompt comments get significantly higher engagement, so the AI comment generation is the core differentiator. This phase builds the HingeClient that the CLI's `swipe --platform hinge` command already expects.

Output: A working `agent/clapcheeks/platforms/hinge.py` with HingeClient class, and updated rate limiter with Hinge's 50 likes/day cap.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/milestone-3/README.md
@agent/clapcheeks/cli.py — Lines 122-131 (swipe command creates HingeClient(driver, ai_service_url)), Lines 263-269 (converse command creates HingeClient for conversation management)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create HingeClient with login, feed iteration, and photo like</name>
  <files>
    agent/clapcheeks/platforms/__init__.py
    agent/clapcheeks/platforms/hinge.py
  </files>
  <action>
  Create the platforms package if it does not exist (empty __init__.py).

  Create agent/clapcheeks/platforms/hinge.py with class HingeClient:

  1. __init__(self, driver, ai_service_url=None):
     - Store driver (Playwright page/browser instance from Phase 11)
     - Store ai_service_url (Ollama or Claude endpoint for prompt comments)
     - HINGE_URL = "https://hinge.co/app"
     - DAILY_LIKE_LIMIT = 50
     - Initialize counters: liked=0, passed=0, errors=0, commented=0

  2. login(self):
     - Navigate to HINGE_URL
     - Check if already logged in by looking for the feed container (CSS selector for Hinge's main feed -- use a broad selector like '[class*="feed"], [data-testid*="feed"], main' and refine during execution)
     - If not logged in, print instructions for manual auth: "Please log in to Hinge in the browser window. Waiting..."
     - Wait for feed container to appear with a 120-second timeout (user logs in manually)
     - Add random delay 2-5 seconds after login detected
     - Return True on success, raise TimeoutError if login times out

  3. run_swipe_session(self, like_ratio=0.5, max_swipes=30):
     - Call login() first
     - Import and use rate_limiter to check remaining daily likes: remaining = get_remaining("hinge")
     - Effective max = min(max_swipes, remaining, DAILY_LIKE_LIMIT)
     - If remaining == 0, log warning "Daily like limit reached (50/day)" and return early with zero counts
     - Loop up to effective max iterations:
       a. Call _get_current_card() to extract card data from the current profile in view
       b. If card has a prompt and random() < like_ratio and ai_service_url is set:
          - Call _like_with_comment(card) -- like the prompt with an AI-generated comment
          - Increment commented counter
       c. Elif random() < like_ratio:
          - Call _like_photo(card) -- like the best photo
       d. Else:
          - Call _skip(card) -- skip/pass on this profile
          - Increment passed counter
       e. Record action in rate_limiter: record_action("hinge", "like" or "pass")
       f. Add human-like delay: random uniform 1.5-4.0 seconds between actions
       g. Wrap each iteration in try/except, increment errors on failure, continue
     - Return {"liked": self.liked, "passed": self.passed, "errors": self.errors, "commented": self.commented}

  4. _get_current_card(self):
     - Extract visible profile card data from the DOM
     - Look for prompt text elements (Hinge prompts are text blocks like "A life goal of mine..." with a response)
     - Look for photo elements
     - Return dict: {"has_prompt": bool, "prompt_text": str|None, "prompt_response": str|None, "photos": list[str], "name": str|None}
     - Use Playwright locators -- prefer data-testid attributes, fall back to semantic selectors
     - If extraction fails, return a minimal dict with has_prompt=False

  5. _like_photo(self, card):
     - Find and click the like/heart button on the current card
     - Use Playwright click with force=False (wait for element to be actionable)
     - Increment self.liked
     - Log: "Liked photo for {card.get('name', 'unknown')}"

  6. _skip(self, card):
     - Find and click the skip/X button on the current card
     - Increment self.passed
     - Log: "Skipped {card.get('name', 'unknown')}"

  Use Python logging module (logger = logging.getLogger("clapcheeks.hinge")).
  Use random.uniform for delays, random.random for like ratio decisions.
  Import time.sleep for delays.
  All Playwright interactions should use page.locator() with reasonable timeouts (10s default).
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.platforms.hinge import HingeClient; print('HingeClient imports OK')"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "import inspect; from clapcheeks.platforms.hinge import HingeClient; methods = [m for m in dir(HingeClient) if not m.startswith('__')]; assert 'login' in methods; assert 'run_swipe_session' in methods; assert '_generate_prompt_comment' in methods; assert '_like_photo' in methods; assert '_like_with_comment' in methods; print('All methods present:', methods)"
  </verify>
  <done>
    - agent/clapcheeks/platforms/hinge.py exists with HingeClient class
    - HingeClient has login(), run_swipe_session(), _get_current_card(), _like_photo(), _skip() methods
    - run_swipe_session returns {"liked", "passed", "errors", "commented"} dict
    - DAILY_LIKE_LIMIT = 50 is enforced
    - Human-like random delays between 1.5-4.0 seconds between actions
    - All methods import without errors
  </done>
</task>

<task type="auto">
  <name>Task 2: Add AI prompt comment generation and comment-like action</name>
  <files>
    agent/clapcheeks/platforms/hinge.py
  </files>
  <action>
  Add two methods to HingeClient in agent/clapcheeks/platforms/hinge.py:

  1. _generate_prompt_comment(self, prompt_text, prompt_response=None):
     - If ai_service_url is None, return None (graceful fallback -- caller will like photo instead)
     - Build a prompt for the AI:
       System: "You are a witty, charming person on a dating app. Write a short comment (1-2 sentences max) responding to someone's Hinge prompt. Be genuine, playful, and specific to what they wrote. Never be generic, creepy, or use pickup lines. Match the energy of what they wrote."
       User: f"Their prompt: {prompt_text}" + (f"\nTheir answer: {prompt_response}" if prompt_response else "")
     - POST to ai_service_url with JSON body:
       {"model": "llama3.2", "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}], "stream": false, "options": {"temperature": 0.8, "num_predict": 100}}
     - Parse response: response.json()["message"]["content"]
     - Strip the result, truncate to 150 chars if longer (Hinge has character limits)
     - If the AI response contains quotes, emojis spam (3+), or is longer than 2 sentences, regenerate once with a stricter prompt adding "Keep it to ONE sentence, no emojis"
     - On any exception (network error, timeout, bad response), log warning and return None
     - Timeout: 10 seconds for the HTTP request

  2. _like_with_comment(self, card):
     - Call _generate_prompt_comment(card["prompt_text"], card.get("prompt_response"))
     - If comment is None (AI unavailable or failed), fall back to _like_photo(card) and return
     - Find the prompt's comment/reply input on the card (Hinge shows a text input or "Add a comment" button near each prompt)
     - Click the comment input to focus it
     - Type the comment using page.locator().fill() or type() with a small delay (simulate typing)
     - Find and click the send/submit button for the comment
     - Increment self.liked and self.commented
     - Log: "Liked with comment for {card.get('name', 'unknown')}: {comment[:50]}..."
     - On any Playwright interaction failure, fall back to _like_photo(card)

  IMPORTANT constraints for prompt comments:
  - 1-2 sentences max, must feel human and natural
  - No generic compliments ("You're beautiful", "Nice pics")
  - No pickup lines or cheesy openers
  - Specific to what the person wrote in their prompt
  - Temperature 0.8 for creativity, but num_predict=100 to keep it short
  - Graceful fallback to photo like if AI is unavailable or comment interaction fails
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge import HingeClient
import inspect
src = inspect.getsource(HingeClient._generate_prompt_comment)
assert 'ai_service_url' in src, 'Must check ai_service_url'
assert '150' in src or 'truncate' in src.lower(), 'Must truncate long comments'
assert 'temperature' in src, 'Must set temperature'
print('Prompt comment generation OK')
"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge import HingeClient
import inspect
src = inspect.getsource(HingeClient._like_with_comment)
assert '_generate_prompt_comment' in src, 'Must call comment generator'
assert '_like_photo' in src, 'Must fall back to photo like'
print('Like with comment OK')
"
  </verify>
  <done>
    - _generate_prompt_comment sends prompt to Ollama/Claude via ai_service_url
    - Comments are 1-2 sentences, max 150 chars, specific to the prompt
    - Graceful fallback: if AI unavailable or comment fails, falls back to photo like
    - _like_with_comment types the comment into Hinge's UI and submits it
    - Temperature 0.8, num_predict 100 for short creative responses
  </done>
</task>

<task type="auto">
  <name>Task 3: Update rate limiter with Hinge 50/day cap and add platforms __init__ exports</name>
  <files>
    agent/clapcheeks/session/rate_limiter.py
    agent/clapcheeks/platforms/__init__.py
  </files>
  <action>
  1. Update agent/clapcheeks/session/rate_limiter.py:
     - If this file already exists (created in Phase 11/12), add Hinge to the PLATFORM_LIMITS dict:
       "hinge": {"daily_likes": 50}
     - If this file does not exist yet, create it with:
       - PLATFORM_LIMITS = {"tinder": {"daily_likes": 100}, "bumble": {"daily_likes": 75}, "hinge": {"daily_likes": 50}}
       - RATE_FILE = Path.home() / ".clapcheeks" / "rate_limits.json"
       - _load_data() -> dict: reads JSON file, returns empty dict if missing
       - _save_data(data: dict): writes JSON file
       - _get_today_key() -> str: returns today's date as "YYYY-MM-DD"
       - get_remaining(platform: str) -> int: returns remaining likes for platform today
       - record_action(platform: str, action: str): increments today's count for platform
       - get_daily_summary() -> dict: returns all platform counts for today (used by CLI status command)
       - Ensure the session/ directory and __init__.py exist
     - The rate limiter must be file-based (JSON in ~/.clapcheeks/) so it persists across sessions
     - Auto-reset counts each new day (check date key)

  2. Update agent/clapcheeks/platforms/__init__.py:
     - Add convenience imports: from clapcheeks.platforms.hinge import HingeClient
     - Only import what exists -- use try/except ImportError for each platform so missing platform files don't break the package

  3. Atomic commit with message: "feat(14-hinge): add Hinge rate limit (50/day) and platform exports"
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.session.rate_limiter import get_remaining, PLATFORM_LIMITS
assert 'hinge' in PLATFORM_LIMITS, 'Hinge must be in limits'
assert PLATFORM_LIMITS['hinge']['daily_likes'] == 50, 'Hinge limit must be 50'
remaining = get_remaining('hinge')
assert remaining == 50, f'Fresh day should have 50 remaining, got {remaining}'
print('Rate limiter OK: hinge limit =', PLATFORM_LIMITS['hinge']['daily_likes'])
"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.platforms import HingeClient; print('Platform import OK')"
  </verify>
  <done>
    - rate_limiter.py has Hinge with 50/day limit
    - get_remaining("hinge") returns correct count based on today's usage
    - record_action("hinge", "like") decrements remaining count
    - platforms/__init__.py exports HingeClient
    - Rate data persists in ~/.clapcheeks/rate_limits.json
  </done>
</task>

</tasks>

<verification>
1. python3 -c "from clapcheeks.platforms.hinge import HingeClient" -- imports clean
2. python3 -c "from clapcheeks.session.rate_limiter import get_remaining; assert get_remaining('hinge') == 50" -- rate limit works
3. python3 -c "from clapcheeks.platforms import HingeClient" -- package exports work
4. Inspect HingeClient: has login, run_swipe_session, _generate_prompt_comment, _like_photo, _like_with_comment, _skip methods
5. _generate_prompt_comment has 150-char truncation and graceful None fallback
6. run_swipe_session enforces min(max_swipes, remaining_daily, 50) ceiling
7. Human-like delays (1.5-4.0s) between every action
</verification>

<success_criteria>
- HingeClient instantiates with (driver, ai_service_url) matching cli.py line 130
- run_swipe_session returns {"liked", "passed", "errors", "commented"} matching cli.py line 133-142
- Prompt comments are 1-2 sentences, max 150 chars, generated via Ollama/Claude
- AI fallback: if ai_service_url is None or AI fails, likes photo instead of commenting
- Rate limit: max 50 likes/day enforced via persistent file-based counter
- All Playwright interactions use reasonable timeouts and human-like delays
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-14-hinge/14-01-SUMMARY.md`
</output>
