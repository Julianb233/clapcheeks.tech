---
phase: 14-hinge
plan: 01
type: execute
wave: 1
depends_on:
  - "11-01"
  - "12-01"
files_modified:
  - agent/clapcheeks/platforms/hinge/__init__.py
  - agent/clapcheeks/platforms/hinge/client.py
  - agent/clapcheeks/platforms/hinge/api.py
  - agent/clapcheeks/platforms/hinge/auth.py
  - agent/clapcheeks/platforms/hinge/models.py
  - agent/clapcheeks/platforms/hinge/messaging.py
  - agent/clapcheeks/platforms/hinge/comments.py
  - agent/clapcheeks/session/rate_limiter.py
  - agent/clapcheeks/platforms/__init__.py
autonomous: true

must_haves:
  truths:
    - "HingeClient uses direct HTTP API calls to prod-api.hingeaws.net, NOT browser automation"
    - "Auth uses SMS verification flow with bearer token stored at ~/.clapcheeks/hinge_creds.json"
    - "run_swipe_session fetches recommendations via /rec/v2, likes via /rate/v2/initiate with ratingToken"
    - "Every like includes an AI-generated comment specific to the profile's prompt answer"
    - "Daily like limit is 8 for free tier, checked via /likelimit endpoint at session start"
    - "Messaging uses SendBird API with token exchange via /message/authenticate"
    - "The session returns a results dict with liked, passed, errors, and commented counts"
  artifacts:
    - path: "agent/clapcheeks/platforms/hinge/client.py"
      provides: "HingeClient orchestrator with login, run_swipe_session, run_conversation_session"
      exports: ["HingeClient"]
    - path: "agent/clapcheeks/platforms/hinge/api.py"
      provides: "HingeAPI low-level HTTP client with all endpoint methods"
      exports: ["HingeAPI"]
    - path: "agent/clapcheeks/platforms/hinge/auth.py"
      provides: "SMS auth flow, token storage, token validation"
      exports: ["authenticate_sms", "load_credentials", "validate_token"]
    - path: "agent/clapcheeks/platforms/hinge/models.py"
      provides: "Pydantic models for recommendations, profiles, prompts, likes"
      exports: ["Profile", "Prompt", "Photo", "Recommendation", "LikeLimit"]
    - path: "agent/clapcheeks/platforms/hinge/messaging.py"
      provides: "SendBird messaging integration for conversations"
      exports: ["HingeMessaging"]
    - path: "agent/clapcheeks/platforms/hinge/comments.py"
      provides: "AI comment generation for Hinge prompts"
      exports: ["generate_prompt_comment"]
  key_links:
    - from: "agent/clapcheeks/cli.py"
      to: "agent/clapcheeks/platforms/hinge/__init__.py"
      via: "dynamic import in swipe command when platform == 'hinge'"
      pattern: "from clapcheeks\\.platforms\\.hinge import HingeClient"
    - from: "agent/clapcheeks/platforms/hinge/client.py"
      to: "agent/clapcheeks/platforms/hinge/api.py"
      via: "HingeClient uses HingeAPI for all HTTP calls"
      pattern: "from .api import HingeAPI"
    - from: "agent/clapcheeks/platforms/hinge/client.py"
      to: "agent/clapcheeks/platforms/hinge/comments.py"
      via: "generate_prompt_comment called for each like"
      pattern: "from .comments import generate_prompt_comment"
    - from: "agent/clapcheeks/platforms/hinge/client.py"
      to: "agent/clapcheeks/session/rate_limiter.py"
      via: "check_limit and record_swipe calls to enforce daily cap"
      pattern: "rate_limiter|check_limit|record_swipe"
---

<objective>
Replace the broken Playwright-based HingeClient with a direct HTTP API client for Hinge's private REST API.

Purpose: Hinge has NO web app -- the existing hinge.py uses Playwright browser automation against a non-existent URL (hinge.co/app). This phase completely rewrites the Hinge integration to use direct HTTP API calls to prod-api.hingeaws.net, based on reverse-engineered endpoints from HingeSDK and squeaky-hinge projects.

The new client handles SMS authentication, profile browsing via recommendations API, liking with AI-generated comments, and SendBird messaging -- all without a browser.

Output: A working `agent/clapcheeks/platforms/hinge/` package with API client, auth flow, AI comment generation, and SendBird messaging. The CLI integration remains unchanged (same HingeClient constructor signature).
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/milestone-3/README.md
@.planning/milestone-3/phase-14-hinge/RESEARCH.md -- Contains all verified API endpoints, auth flow, headers, and code examples
@agent/clapcheeks/cli.py -- Lines 136-138 (HingeClient(driver=driver, ai_service_url=config.get('ai_service_url')))
@agent/clapcheeks/session/rate_limiter.py -- Existing rate limiter with DAILY_LIMITS and record_swipe/can_swipe
@agent/clapcheeks/platforms/__init__.py -- Package exports
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create Hinge API models and constants</name>
  <files>
    agent/clapcheeks/platforms/hinge/__init__.py
    agent/clapcheeks/platforms/hinge/models.py
  </files>
  <action>
  FIRST: Delete the old file agent/clapcheeks/platforms/hinge.py (it's the broken Playwright version).

  Create agent/clapcheeks/platforms/hinge/ as a package directory.

  Create agent/clapcheeks/platforms/hinge/models.py with dataclasses (not Pydantic -- keep dependencies minimal):

  ```python
  from __future__ import annotations
  from dataclasses import dataclass, field
  from typing import Optional

  # API constants
  BASE_URL = "https://prod-api.hingeaws.net"
  SENDBIRD_APP_ID = "3CDAD91C-1E0D-4A0D-BBEE-9671988BF9E9"

  # Device fingerprint defaults (Pixel 6a running Android 14)
  DEFAULT_HEADERS = {
      "x-app-version": "9.68.0",
      "x-os-version": "14",
      "x-os-version-code": "34",
      "x-device-model": "Pixel 6a",
      "x-device-model-code": "Pixel 6a",
      "x-device-manufacturer": "Google",
      "x-build-number": "168200482",
      "x-device-platform": "android",
      "accept-language": "en-US",
      "x-device-region": "US",
      "host": "prod-api.hingeaws.net",
      "connection": "Keep-Alive",
      "accept-encoding": "gzip",
      "user-agent": "okhttp/4.12.0",
      "content-type": "application/json; charset=UTF-8",
  }

  # Firebase/Identity config (from squeaky-hinge)
  FIREBASE_API_KEY = "AIzaSyB-apSzB00iSHaEIG-5nalT2DDVSAHcPXA"
  HINGE_ANDROID_PACKAGE = "co.hinge.app"
  HINGE_APK_SHA1 = "7D5F1D2ACE98A03B2C3A1A6B0DCB2B7F5D856F67"

  CREDS_FILE = Path.home() / ".clapcheeks" / "hinge_creds.json"

  @dataclass
  class HingeCredentials:
      token: str
      user_id: str
      install_id: str
      device_id: str
      session_id: str

  @dataclass
  class Photo:
      content_id: str
      url: str

  @dataclass
  class Prompt:
      question_id: str
      question_text: str
      response_text: str
      response_type: str = "text"  # "text" or "voice"

  @dataclass
  class Profile:
      subject_id: str
      rating_token: str
      name: str = ""
      age: int = 0
      photos: list[Photo] = field(default_factory=list)
      prompts: list[Prompt] = field(default_factory=list)
      raw_data: dict = field(default_factory=dict)

      @property
      def has_prompts(self) -> bool:
          return len(self.prompts) > 0

      @property
      def best_prompt(self) -> Optional[Prompt]:
          """Return the prompt with the longest response (most to comment on)."""
          if not self.prompts:
              return None
          return max(self.prompts, key=lambda p: len(p.response_text))

  @dataclass
  class LikeLimit:
      likes_left: int
      roses_left: int = 0
  ```

  Create agent/clapcheeks/platforms/hinge/__init__.py:
  ```python
  """Hinge private API client -- direct HTTP, no browser automation."""
  from clapcheeks.platforms.hinge.client import HingeClient

  __all__ = ["HingeClient"]
  ```

  IMPORTANT: Add `from pathlib import Path` to models.py for CREDS_FILE.
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.platforms.hinge.models import Profile, Prompt, Photo, LikeLimit, HingeCredentials, BASE_URL, DEFAULT_HEADERS, SENDBIRD_APP_ID; print('Models OK, BASE_URL:', BASE_URL)"
  </verify>
  <done>
    - agent/clapcheeks/platforms/hinge/ package created
    - Old hinge.py (Playwright version) deleted
    - models.py has dataclasses: Profile, Prompt, Photo, LikeLimit, HingeCredentials
    - Constants: BASE_URL, DEFAULT_HEADERS, SENDBIRD_APP_ID, FIREBASE_API_KEY, CREDS_FILE
    - __init__.py exports HingeClient (will fail import until client.py exists -- that's OK)
  </done>
</task>

<task type="auto">
  <name>Task 2: Create auth module with SMS login and token storage</name>
  <files>
    agent/clapcheeks/platforms/hinge/auth.py
  </files>
  <action>
  Create agent/clapcheeks/platforms/hinge/auth.py implementing token management:

  1. load_credentials() -> HingeCredentials | None:
     - Read CREDS_FILE (~/.clapcheeks/hinge_creds.json)
     - If file exists and is valid JSON, return HingeCredentials
     - If missing or invalid, return None

  2. save_credentials(creds: HingeCredentials) -> None:
     - Write credentials to CREDS_FILE as JSON
     - Ensure parent directory exists (mkdir parents=True)

  3. validate_token(creds: HingeCredentials) -> bool:
     - Make a lightweight GET request to {BASE_URL}/auth/settings with the bearer token
     - Use headers from DEFAULT_HEADERS plus Authorization and x-install-id
     - If 200, return True (token is valid)
     - If 401 or any error, return False

  4. authenticate_sms(phone_number: str) -> HingeCredentials:
     - IMPORTANT: This requires user interaction (SMS code input)
     - Use the HingeSDK direct SMS approach (simpler):
       a. Generate device_id = uuid4().hex[:16] and install_id = str(uuid4())
       b. POST to {BASE_URL}/auth/sms/v2/initiate with {"phoneNumber": phone_number, "deviceId": device_id}
          Headers: DEFAULT_HEADERS (no auth needed)
       c. Prompt user: sms_code = input("Enter SMS code: ")
       d. POST to {BASE_URL}/auth/sms/v2 with {"deviceId": device_id, "installId": install_id, "phoneNumber": phone_number, "otp": sms_code}
       e. Parse response: token = resp["token"], user_id = resp["playerId"], session_id = resp.get("sessionId") or str(uuid4())
       f. Create HingeCredentials, call save_credentials(), return it
     - On any HTTP error, raise with descriptive message
     - Use requests (sync) for auth -- it's a one-time sequential flow

  5. authenticate_manual(token: str, user_id: str, install_id: str = None, device_id: str = None) -> HingeCredentials:
     - For users who extracted token via mitmproxy
     - Create HingeCredentials with provided values (generate install_id/device_id if not given)
     - Call save_credentials()
     - Call validate_token() to verify
     - Return credentials

  Use logging module (logger = logging.getLogger("clapcheeks.hinge.auth")).
  Use requests library for sync HTTP in auth flow.
  All HTTP errors should be caught and re-raised with descriptive messages.
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge.auth import load_credentials, save_credentials, validate_token, authenticate_manual
print('Auth module imports OK')
# Test load_credentials returns None when no file exists
creds = load_credentials()
print('load_credentials (no file):', creds)
"
  </verify>
  <done>
    - auth.py has load_credentials, save_credentials, validate_token, authenticate_sms, authenticate_manual
    - Credentials stored at ~/.clapcheeks/hinge_creds.json
    - validate_token checks token against /auth/settings endpoint
    - authenticate_sms uses direct /auth/sms/v2 flow (HingeSDK pattern)
    - authenticate_manual for mitmproxy-captured tokens
  </done>
</task>

<task type="auto">
  <name>Task 3: Create low-level API client with all Hinge endpoints</name>
  <files>
    agent/clapcheeks/platforms/hinge/api.py
  </files>
  <action>
  Create agent/clapcheeks/platforms/hinge/api.py with class HingeAPI:

  1. __init__(self, creds: HingeCredentials):
     - Store credentials
     - Create httpx.Client (sync) with:
       - base_url = BASE_URL
       - headers = DEFAULT_HEADERS merged with auth headers:
         "authorization": f"Bearer {creds.token}"
         "x-install-id": creds.install_id
         "x-device-id": creds.device_id
         "x-session-id": creds.session_id
       - timeout = httpx.Timeout(15.0)
     - Note: Use SYNC httpx.Client (not AsyncClient) for simplicity -- the CLI is sync

  2. _request(self, method: str, path: str, **kwargs) -> dict:
     - Full URL = base_url + path
     - Call self.client.request(method, path, **kwargs)
     - If 401, log "Token expired" and raise AuthError
     - If not 2xx, log error and raise
     - Return response.json()
     - Log request: logger.debug("API %s %s", method, path)

  3. get_recommendations(self, active_today=False, new_here=False) -> list[Profile]:
     - POST /rec/v2 with {"playerId": self.creds.user_id, "activeToday": active_today, "newHere": new_here}
     - Parse response into list of Profile objects
     - Each recommendation has: subjectId, ratingToken, photos, prompts, name, etc.
     - IMPORTANT: The exact response schema may vary. Use defensive parsing:
       - Extract subjects from response (try keys: "subjects", "recommendations", "data")
       - For each subject, extract subjectId and ratingToken (required -- skip if missing)
       - Extract name from subject data (try "name", "firstName", etc.)
       - Extract photos: iterate "photos" or "content" array, create Photo(content_id, url)
       - Extract prompts: iterate "prompts" or "answers" array, create Prompt(question_id, question_text, response_text)
     - Log: "Fetched {n} recommendations"
     - Return list of Profile objects

  4. like_profile(self, subject_id: str, rating_token: str, comment: str = None, photo: dict = None, prompt: dict = None) -> dict:
     - POST /rate/v2/initiate
     - Payload (from HingeSDK api.py -- verified):
       {
           "ratingId": str(uuid4()),
           "ratingToken": rating_token,
           "subjectId": subject_id,
           "sessionId": self.creds.session_id,
           "rating": "note",
           "origin": "compatibles",
           "hasPairing": False,
           "created": datetime.utcnow().isoformat() + "Z",
           "initiatedWith": "standard",
           "content": {}  # populated below
       }
     - If comment: content["comment"] = comment
     - If photo: content["photo"] = photo
     - If prompt: content["prompt"] = prompt
     - Return response

  5. get_like_limit(self) -> LikeLimit:
     - GET /likelimit
     - Parse into LikeLimit(likes_left=resp.get("likesLeft", 8), roses_left=resp.get("rosesLeft", 0))
     - Handle missing keys gracefully -- default to 8 likes

  6. send_message(self, subject_id: str, message: str) -> dict:
     - POST /message/send
     - Payload (from HingeSDK api.py -- verified):
       {
           "subjectId": subject_id,
           "matchMessage": False,
           "origin": "Native Chat",
           "dedupId": str(uuid4()),
           "messageData": {"message": message},
           "messageType": "message",
           "ays": True
       }

  7. get_sendbird_token(self) -> tuple[str, str]:
     - POST /message/authenticate with {"refresh": False}
     - Return (sendbird_access_token, user_id)

  8. get_standouts(self) -> list[Profile]:
     - GET /standouts/v2
     - Parse same as recommendations

  9. get_account_info(self) -> dict:
     - GET /store/v2/account
     - Return raw response

  10. close(self):
      - self.client.close()

  Import: httpx, uuid, datetime, logging, and models from .models
  Use logger = logging.getLogger("clapcheeks.hinge.api")
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge.api import HingeAPI
import inspect
methods = [m for m in dir(HingeAPI) if not m.startswith('_')]
print('HingeAPI methods:', methods)
assert 'get_recommendations' in methods
assert 'like_profile' in methods
assert 'send_message' in methods
assert 'get_like_limit' in methods
assert 'get_sendbird_token' in methods
print('All expected methods present')
"
  </verify>
  <done>
    - HingeAPI class with httpx.Client and all endpoint methods
    - get_recommendations returns list[Profile] with defensive parsing
    - like_profile sends POST /rate/v2/initiate with ratingToken and optional comment
    - get_like_limit returns LikeLimit with remaining daily likes
    - send_message sends through Hinge's /message/send endpoint
    - get_sendbird_token exchanges Hinge token for SendBird access
    - 401 responses detected and raised as auth errors
  </done>
</task>

<task type="auto">
  <name>Task 4: Create AI comment generation module</name>
  <files>
    agent/clapcheeks/platforms/hinge/comments.py
  </files>
  <action>
  Create agent/clapcheeks/platforms/hinge/comments.py:

  1. SYSTEM_PROMPT constant:
     "You are a witty person on a dating app. Write a short comment (1 sentence, under 150 characters) responding to someone's Hinge prompt answer. Be genuine, specific to what they wrote, and playful. Never be generic, creepy, or use pickup lines. Match the energy of what they wrote. Output ONLY the comment text, nothing else."

  2. generate_prompt_comment(prompt: Prompt, ai_service_url: str, voice_context: str = None) -> str | None:
     - If ai_service_url is None or empty, return None
     - Build user message:
       f"Prompt question: {prompt.question_text}\nTheir answer: {prompt.response_text}"
     - If voice_context is provided (user's texting style from iMessage), add to system prompt:
       system += f"\n\nMatch this texting style: {voice_context}"
     - POST to ai_service_url with:
       {
           "model": "llama3.2",
           "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
           "stream": false,
           "options": {"temperature": 0.8, "num_predict": 100}
       }
     - Parse: response.json()["message"]["content"].strip()
     - Quality checks:
       a. Strip surrounding quotes if present
       b. If len > 150, truncate at last space before 147 chars and add "..."
       c. If contains 3+ emojis or is empty, regenerate once with stricter prompt (add "Keep it to ONE short sentence. No emojis. Under 100 characters.")
     - On any exception (timeout, network, parse error), log warning and return None
     - Timeout: 10 seconds for HTTP request
     - Return the comment string

  3. _count_emojis(text: str) -> int:
     - Count characters with ord > 0x1F600 (emoji range)
     - Simple heuristic, doesn't need to be perfect

  Use requests library (sync) for the AI service call.
  Use logger = logging.getLogger("clapcheeks.hinge.comments")
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge.comments import generate_prompt_comment, SYSTEM_PROMPT
from clapcheeks.platforms.hinge.models import Prompt
print('Comments module imports OK')
print('System prompt length:', len(SYSTEM_PROMPT))
assert '150' in SYSTEM_PROMPT or 'short' in SYSTEM_PROMPT.lower()
# Test with no AI URL returns None
result = generate_prompt_comment(Prompt('q1', 'A life goal of mine', 'Travel the world'), None)
assert result is None, 'Should return None when no AI URL'
print('Graceful None fallback OK')
"
  </verify>
  <done>
    - comments.py has generate_prompt_comment function
    - Generates unique AI comments for each prompt
    - 150 character limit enforced with truncation
    - Emoji spam detection and regeneration
    - Graceful None fallback when AI service unavailable
    - Voice context support for matching user's texting style
  </done>
</task>

<task type="auto">
  <name>Task 5: Create SendBird messaging module</name>
  <files>
    agent/clapcheeks/platforms/hinge/messaging.py
  </files>
  <action>
  Create agent/clapcheeks/platforms/hinge/messaging.py with class HingeMessaging:

  1. __init__(self, api: HingeAPI):
     - Store the API client reference
     - self._session_key = None
     - self._sendbird_token = None

  2. _ensure_sendbird_session(self):
     - If self._session_key is already set, return
     - Call api.get_sendbird_token() to get sendbird_access_token
     - Open WebSocket to:
       f"wss://ws-{SENDBIRD_APP_ID.lower()}.sendbird.com?" + urlencode({
           "ai": SENDBIRD_APP_ID,
           "user_id": self.api.creds.user_id,
           "access_token": sendbird_access_token
       })
     - Read first message, strip "LOGI" prefix, parse JSON
     - Extract session_key from parsed data["key"]
     - Close WebSocket (we only need the session key for REST calls)
     - Store self._session_key

  3. get_conversations(self, limit: int = 20) -> list[dict]:
     - Call _ensure_sendbird_session()
     - GET https://api-{SENDBIRD_APP_ID.lower()}.sendbird.com/v3/users/{user_id}/my_group_channels
     - Headers: {"Accept": "application/json", "Session-Key": self._session_key}
     - Params: {"show_member": "true", "limit": str(limit), "order": "latest_last_message",
                "show_read_receipt": "true", "show_delivery_receipt": "true",
                "hidden_mode": "unhidden_only", "unread_filter": "all"}
     - Return list of channel dicts from response["channels"]

  4. get_messages(self, channel_url: str, since_ts: int = 0, limit: int = 200) -> list[dict]:
     - Call _ensure_sendbird_session()
     - GET https://api-{SENDBIRD_APP_ID.lower()}.sendbird.com/v3/group_channels/{channel_url}/messages
     - Headers: {"Accept": "application/json", "Session-Key": self._session_key}
     - Params: {"message_ts": since_ts, "next_limit": limit}
     - Return list of messages from response["messages"]

  5. send_message(self, subject_id: str, message: str) -> dict:
     - Use the Hinge API directly (not SendBird) for sending:
     - Call self.api.send_message(subject_id, message)
     - This goes through /message/send which Hinge routes to SendBird internally

  Import: websocket, json, urllib.parse, logging, httpx
  Import SENDBIRD_APP_ID from .models
  Use logger = logging.getLogger("clapcheeks.hinge.messaging")
  Wrap WebSocket operations in try/except -- messaging failures should not crash the session
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge.messaging import HingeMessaging
import inspect
methods = [m for m in dir(HingeMessaging) if not m.startswith('_')]
print('HingeMessaging methods:', methods)
assert 'get_conversations' in methods
assert 'get_messages' in methods
assert 'send_message' in methods
print('Messaging module OK')
"
  </verify>
  <done>
    - HingeMessaging class handles all conversation operations
    - SendBird WebSocket session established on demand
    - get_conversations returns match inbox
    - get_messages returns message history for a channel
    - send_message uses Hinge /message/send endpoint
    - Session key cached after first WebSocket handshake
  </done>
</task>

<task type="auto">
  <name>Task 6: Create HingeClient orchestrator</name>
  <files>
    agent/clapcheeks/platforms/hinge/client.py
  </files>
  <action>
  Create agent/clapcheeks/platforms/hinge/client.py with class HingeClient:

  This is the main class that the CLI instantiates. It must match the constructor signature
  used in cli.py: HingeClient(driver=driver, ai_service_url=config.get('ai_service_url'))

  1. __init__(self, driver=None, ai_service_url=None):
     - IGNORE driver parameter (Hinge has no browser automation, but keep param for CLI compat)
     - Store ai_service_url
     - self.api = None  (initialized in login)
     - self.messaging = None
     - Initialize counters: liked=0, passed=0, errors=0, commented=0

  2. login(self) -> bool:
     - Load credentials from file: creds = load_credentials()
     - If creds is None:
       print("\n=== Hinge Authentication Required ===")
       print("Options:")
       print("  1. Enter bearer token (from mitmproxy/HTTP Toolkit)")
       print("  2. SMS login (requires phone number)")
       choice = input("Choice (1/2): ").strip()
       If choice == "2":
         phone = input("Phone number (e.g. +12345678901): ").strip()
         creds = authenticate_sms(phone)
       Else:
         token = input("Bearer token: ").strip()
         user_id = input("User ID: ").strip()
         creds = authenticate_manual(token, user_id)
     - Else, validate existing token:
       if not validate_token(creds):
         logger.warning("Stored token expired, re-authentication required")
         # Clear stored creds and recurse
         CREDS_FILE.unlink(missing_ok=True)
         return self.login()
     - Create self.api = HingeAPI(creds)
     - Create self.messaging = HingeMessaging(self.api)
     - logger.info("Hinge login successful for user %s", creds.user_id)
     - Return True

  3. run_swipe_session(self, like_ratio: float = 0.8, max_swipes: int = 8) -> dict:
     NOTE: Default max_swipes=8 (not 30) because free Hinge only has 8 likes/day.
     NOTE: Default like_ratio=0.8 (not 0.5) because with only 8 likes, users want to use most of them.

     - Call self.login() if self.api is None
     - Import rate_limiter: from clapcheeks.session.rate_limiter import can_swipe, record_swipe, check_limit
     - Check rate limit: try check_limit("hinge") except RateLimitExceeded -> log warning, return zeros
     - Get actual remaining likes from API: limit = self.api.get_like_limit()
       On error (network, auth), fall back to 8
     - effective_max = min(max_swipes, limit.likes_left)
     - If effective_max <= 0: log "No likes remaining today", return zeros
     - Fetch recommendations: profiles = self.api.get_recommendations()
     - If no profiles: log "No recommendations available", return zeros

     - Loop through profiles up to effective_max:
       try:
         profile = profiles[i] (if exhausted, fetch more recommendations)

         # Decision: like with comment, like photo, or skip
         if profile.has_prompts and random.random() < like_ratio and self.ai_service_url:
           # Like with AI comment on best prompt
           prompt = profile.best_prompt
           comment = generate_prompt_comment(prompt, self.ai_service_url)
           if comment:
             self.api.like_profile(
               subject_id=profile.subject_id,
               rating_token=profile.rating_token,
               comment=comment,
               prompt={"questionId": prompt.question_id, "response": prompt.response_text}
             )
             self.liked += 1
             self.commented += 1
             logger.info("Liked %s with comment: %s", profile.name, comment[:50])
           else:
             # AI failed -- like best photo instead
             if profile.photos:
               self.api.like_profile(
                 subject_id=profile.subject_id,
                 rating_token=profile.rating_token,
                 photo={"contentId": profile.photos[0].content_id}
               )
               self.liked += 1
               logger.info("Liked photo for %s (AI comment failed)", profile.name)
             else:
               self.passed += 1
         elif random.random() < like_ratio:
           # Like photo (no prompt or no AI)
           if profile.photos:
             self.api.like_profile(
               subject_id=profile.subject_id,
               rating_token=profile.rating_token,
               photo={"contentId": profile.photos[0].content_id}
             )
             self.liked += 1
             logger.info("Liked photo for %s", profile.name)
           else:
             self.passed += 1
         else:
           # Skip -- just don't interact, move to next
           self.passed += 1
           logger.info("Skipped %s", profile.name)

         # Record in rate limiter
         if self.liked > 0 or self.commented > 0:
           record_swipe("hinge", "right")

         # Human-like delay: 3-8 seconds between actions (slower than Tinder because fewer likes)
         time.sleep(random.uniform(3.0, 8.0))

       except Exception as exc:
         logger.warning("Error processing profile %d: %s", i, exc)
         self.errors += 1
         continue

     - Return {"liked": self.liked, "passed": self.passed, "errors": self.errors, "commented": self.commented}

  4. run_conversation_session(self, max_messages: int = 10) -> dict:
     - Call self.login() if self.api is None
     - conversations = self.messaging.get_conversations()
     - For each conversation with unread messages (up to max_messages):
       - Get latest messages
       - Identify conversations where match sent last message (we should reply)
       - Generate reply using AI if ai_service_url is set
       - Send reply via self.messaging.send_message()
     - Return {"conversations_checked": len(conversations), "messages_sent": sent_count}
     - This is a best-effort feature -- wrap everything in try/except

  Use logging module: logger = logging.getLogger("clapcheeks.hinge")
  Import: random, time, logging
  Import from sibling modules: .api, .auth, .models, .comments, .messaging
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.platforms.hinge.client import HingeClient
import inspect

# Verify constructor signature matches CLI expectation
sig = inspect.signature(HingeClient.__init__)
params = list(sig.parameters.keys())
assert 'driver' in params, 'Must accept driver param for CLI compat'
assert 'ai_service_url' in params, 'Must accept ai_service_url'
print('Constructor signature OK:', params)

# Verify methods exist
methods = [m for m in dir(HingeClient) if not m.startswith('_')]
assert 'login' in methods
assert 'run_swipe_session' in methods
print('All methods present:', methods)

# Verify it can be imported from package
from clapcheeks.platforms.hinge import HingeClient as HC2
print('Package import OK')
"
  </verify>
  <done>
    - HingeClient accepts (driver=None, ai_service_url=None) -- CLI compatible
    - login() handles token loading, validation, and auth (SMS or manual)
    - run_swipe_session defaults to max_swipes=8 with 0.8 like_ratio
    - Every like includes AI-generated comment when possible
    - Falls back to photo like when AI unavailable
    - Human-like delays 3-8 seconds between actions
    - Returns {"liked", "passed", "errors", "commented"} dict
    - run_conversation_session for managing match messaging
  </done>
</task>

<task type="auto">
  <name>Task 7: Update rate limiter and platform exports for Hinge 8/day cap</name>
  <files>
    agent/clapcheeks/session/rate_limiter.py
    agent/clapcheeks/platforms/__init__.py
  </files>
  <action>
  1. Update agent/clapcheeks/session/rate_limiter.py:
     - Change DAILY_LIMITS["hinge"]["right"] from 50 to 8
       (Free Hinge tier is 8 likes/day, not 50)
     - Change _AGGREGATE_CAPS["hinge"] from 50 to 8
     - Keep DAILY_LIMITS["hinge"]["left"] and ["messages"] as-is (200 and 20)
     - Do NOT change any other platform limits or any other code

  2. Update agent/clapcheeks/platforms/__init__.py:
     - Change the hinge import from:
       from clapcheeks.platforms.hinge import HingeClient
     - This already works because hinge/__init__.py re-exports HingeClient
     - No change needed if the try/except import already handles it

  3. Atomic commit: "fix(14-hinge): correct Hinge daily like limit to 8 (free tier)"
  </action>
  <verify>
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "
from clapcheeks.session.rate_limiter import DAILY_LIMITS, _AGGREGATE_CAPS
assert DAILY_LIMITS['hinge']['right'] == 8, f'Expected 8, got {DAILY_LIMITS[\"hinge\"][\"right\"]}'
assert _AGGREGATE_CAPS['hinge'] == 8, f'Expected 8, got {_AGGREGATE_CAPS[\"hinge\"]}'
print('Hinge rate limit corrected to 8/day')
"
    cd /opt/agency-workspace/clapcheeks.tech/agent && python3 -c "from clapcheeks.platforms import HingeClient; print('Platform import OK')"
  </verify>
  <done>
    - rate_limiter.py: Hinge daily right-swipe limit changed from 50 to 8
    - rate_limiter.py: Hinge aggregate cap changed from 50 to 8
    - platforms/__init__.py still exports HingeClient correctly
  </done>
</task>

</tasks>

<verification>
1. python3 -c "from clapcheeks.platforms.hinge import HingeClient" -- package imports clean
2. python3 -c "from clapcheeks.platforms.hinge.api import HingeAPI" -- API client imports
3. python3 -c "from clapcheeks.platforms.hinge.auth import load_credentials, authenticate_manual" -- auth imports
4. python3 -c "from clapcheeks.platforms.hinge.models import Profile, Prompt, BASE_URL" -- models import
5. python3 -c "from clapcheeks.platforms.hinge.comments import generate_prompt_comment" -- comments import
6. python3 -c "from clapcheeks.platforms.hinge.messaging import HingeMessaging" -- messaging imports
7. Inspect HingeClient: has login, run_swipe_session, run_conversation_session methods
8. HingeClient(driver=None, ai_service_url=None) matches CLI signature at cli.py:138
9. HingeAPI has get_recommendations, like_profile, send_message, get_like_limit, get_sendbird_token
10. rate_limiter.py has Hinge limit of 8 (not 50)
11. No Playwright/browser imports anywhere in hinge/ package
12. All AI comment generation has 150-char limit and graceful None fallback
13. Token stored at ~/.clapcheeks/hinge_creds.json
</verification>

<success_criteria>
- HingeClient instantiates with (driver, ai_service_url) matching cli.py line 138
- run_swipe_session returns {"liked", "passed", "errors", "commented"} matching CLI expectation
- ZERO Playwright/browser dependencies -- all interactions are HTTP API calls
- Auth flow supports both SMS login and manual token paste
- Token persisted in ~/.clapcheeks/hinge_creds.json and validated on startup
- Recommendations fetched via POST /rec/v2 with ratingToken extraction
- Likes sent via POST /rate/v2/initiate with comment, photo, or prompt content
- AI comment generation: unique per prompt, under 150 chars, with fallback
- SendBird messaging: conversation listing and message sending work
- Rate limit: 8 likes/day enforced (not 50)
- Human-like delays 3-8 seconds between API calls
</success_criteria>

<output>
After completion, create `.planning/milestone-3/phase-14-hinge/14-01-SUMMARY.md`
</output>
