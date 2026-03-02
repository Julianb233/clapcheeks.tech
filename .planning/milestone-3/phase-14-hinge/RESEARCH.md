# Phase 14: Hinge Private API Automation -- Research

**Researched:** 2026-03-01
**Domain:** Hinge private API reverse engineering, SendBird messaging, AI comment generation
**Confidence:** HIGH (standard stack) / MEDIUM (API endpoints) / MEDIUM (auth flow)

## Summary

Hinge is a mobile-only dating app with NO web interface. The previous PLAN.md assumed browser automation via Playwright against `https://hinge.co/app` -- this URL does not exist and never has. The entire approach must be replaced with direct HTTP API calls to Hinge's private REST API at `https://prod-api.hingeaws.net`.

Two mature open-source projects have successfully reverse-engineered Hinge's API: **HingeSDK** (ReedGraff) provides a full Python SDK with auth, recommendations, liking, and messaging; **squeaky-hinge** (radian-software) provides auth flow, SendBird messaging integration, and conversation fetching. Both confirm that Hinge does NOT use certificate pinning, making token extraction via mitmproxy straightforward.

The authentication flow uses SMS verification (not Google Identity Platform OAuth as initially assumed). Users authenticate with their phone number, receive an SMS code, and exchange it for a bearer token. Messaging is handled entirely through SendBird's third-party API. Free users get only **8 likes per day** (not 50 as the old plan stated), making AI-powered comment generation critical -- every like must count.

**Primary recommendation:** Build a direct HTTP API client using `httpx` (async) based on HingeSDK's endpoint mapping. Implement SMS auth flow from squeaky-hinge. Use SendBird REST/WebSocket API for messaging. Generate AI comments via Ollama/Claude for every like.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx | >=0.27 | Async HTTP client for Hinge API | Async-native, connection pooling, timeout support |
| websocket-client | >=1.7 | SendBird WebSocket for messaging | Used by squeaky-hinge, proven with SendBird |
| ollama | >=0.3 | AI comment generation | Already in project requirements |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| requests | >=2.31 | Sync HTTP for auth flow | Auth is sequential, sync is simpler |
| pydantic | >=2.0 | API response models | Type-safe profile/recommendation parsing |

### Reference Projects (PRIMARY SOURCES)
| Project | URL | Status | What It Provides |
|---------|-----|--------|------------------|
| HingeSDK | github.com/ReedGraff/HingeSDK | Active (2025) | Full endpoint mapping, like/message/recommendations API, SMS auth |
| squeaky-hinge | github.com/radian-software/squeaky-hinge | Active (2024) | Auth flow source code, SendBird integration, conversation fetching |
| hinge-bot | github.com/DeepankarSehra/hinge-bot | Active (2025) | ADB alternative approach, Gemini AI integration pattern |

**Installation:**
```bash
pip install httpx websocket-client
```

## Architecture Patterns

### API-Direct Architecture (NOT browser automation)

```
agent/clapcheeks/platforms/hinge/
├── __init__.py          # Exports HingeClient
├── client.py            # HingeClient orchestrator class
├── api.py               # Raw HTTP API client (endpoints, headers)
├── auth.py              # SMS auth flow, token storage, refresh
├── models.py            # Pydantic models for API responses
├── messaging.py         # SendBird WebSocket/REST messaging
└── comments.py          # AI comment generation for prompts
```

### Key Architectural Differences from Tinder/Bumble

| Aspect | Tinder/Bumble | Hinge |
|--------|---------------|-------|
| Interface | Browser (Playwright) | Direct HTTP API |
| Auth | Manual browser login | SMS code + bearer token |
| Actions | DOM click events | REST API POST requests |
| Messaging | Browser DOM | SendBird REST/WebSocket |
| Driver | BrowserDriver required | No driver needed |
| Rate limit | 50-100 likes/day | 8 likes/day (free) |

### CLI Integration Pattern

The CLI at `cli.py:136-138` currently does:
```python
elif plat == "hinge":
    from clapcheeks.platforms.hinge import HingeClient
    client = HingeClient(driver=driver, ai_service_url=config.get('ai_service_url'))
```

The new HingeClient must accept `driver` parameter for backward compatibility but ignore it internally (it does not use browser automation). It should accept `ai_service_url` for comment generation. The constructor signature stays the same so the CLI does not need changes.

## Hinge API Endpoints (VERIFIED)

### Authentication Endpoints

**Source: squeaky-hinge auth.py (HIGH confidence -- verified source code)**

| Step | Method | URL | Purpose |
|------|--------|-----|---------|
| 1 | POST | `https://prod-api.hingeaws.net/identity/install` | Register installation UUID |
| 2 | GET | `https://identitytoolkit.googleapis.com/v1/recaptchaParams` | Get reCAPTCHA config |
| 3 | POST | `https://www.googleapis.com/identitytoolkit/v3/relyingparty/sendVerificationCode` | Send SMS code |
| 4 | POST | `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPhoneNumber` | Verify SMS, get JWT |
| 5 | POST | `https://prod-api.hingeaws.net/auth/sms` | Exchange JWT for Hinge token |

**Alternative SMS auth (from HingeSDK -- simpler, direct):**

| Step | Method | URL | Purpose |
|------|--------|-----|---------|
| 1 | POST | `https://prod-api.hingeaws.net/auth/sms/v2/initiate` | Initiate SMS send |
| 2 | POST | `https://prod-api.hingeaws.net/auth/sms/v2` | Verify OTP, get token |

### Core API Endpoints

**Source: HingeSDK api.py (HIGH confidence -- verified source code)**

| Method | Endpoint | Purpose | Notes |
|--------|----------|---------|-------|
| POST | `/rec/v2` | Get recommendations | Body: `{playerId, activeToday, newHere}` |
| POST | `/rate/v2/initiate` | Like a profile | Body: `{ratingId, ratingToken, subjectId, sessionId, rating, content}` |
| POST | `/message/send` | Send message to match | Body: `{subjectId, messageData, messageType}` |
| GET | `/standouts/v2` | Get standout profiles | Premium feature |
| GET | `/likelimit` | Get remaining likes | Returns `{likes_left, superlikes_left}` |
| GET | `/user/v2/public?ids=` | Get public user profiles | Comma-separated IDs |
| GET | `/content/v1/public?ids=` | Get public content | Photo/prompt content |
| GET | `/content/v1/settings` | User settings | |
| GET | `/auth/settings` | Auth settings | Shows linked auth methods |
| GET | `/store/v2/account` | Account/subscription info | |
| GET | `/user/v2/traits` | User traits | |
| GET | `/notification/v1/settings` | Notification prefs | |
| POST | `/message/authenticate` | Get SendBird token | Exchange Hinge token for SendBird access |

### SendBird Messaging Endpoints

**Source: squeaky-hinge conversations.py (HIGH confidence -- verified source code)**

| Method | URL | Purpose |
|--------|-----|---------|
| WebSocket | `wss://ws-{APP_ID}.sendbird.com` | Real-time messaging |
| GET | `https://api-{APP_ID}.sendbird.com/v3/users/{userId}/my_group_channels` | List conversations |
| GET | `https://api-{APP_ID}.sendbird.com/v3/group_channels/{channelUrl}/messages` | Get message history |

## Required Headers

**Source: HingeSDK client.py (HIGH confidence -- verified source code)**

```python
headers = {
    "authorization": f"Bearer {token}",
    "x-app-version": "9.68.0",           # Hinge app version
    "x-os-version": "14",                 # Android OS version
    "x-os-version-code": "34",
    "x-device-model": "Pixel 6a",
    "x-device-model-code": "Pixel 6a",
    "x-device-manufacturer": "Google",
    "x-build-number": "168200482",
    "x-device-platform": "android",
    "x-install-id": install_id,           # UUID from registration
    "x-device-id": device_id,             # Persistent device ID
    "x-session-id": session_id,           # Session UUID
    "accept-language": "en-US",
    "x-device-region": "US",
    "host": "prod-api.hingeaws.net",
    "connection": "Keep-Alive",
    "accept-encoding": "gzip",
    "user-agent": "okhttp/4.12.0",
    "content-type": "application/json; charset=UTF-8",
}
```

## Configuration Constants

**Source: squeaky-hinge squeaky_hinge_config.py (HIGH confidence -- verified source code)**

```python
hinge_app_version = "9.2.1"              # May need updating
hinge_device_platform = "android"
hinge_android_package = "co.hinge.app"
hinge_apk_sha1sum = "7D5F1D2ACE98A03B2C3A1A6B0DCB2B7F5D856F67"
firebase_web_api_key = "AIzaSyB-apSzB00iSHaEIG-5nalT2DDVSAHcPXA"
sendbird_application_id = "3CDAD91C-1E0D-4A0D-BBEE-9671988BF9E9"
```

## Like Mechanics (CRITICAL)

**Source: HingeSDK api.py (HIGH confidence)**

Liking on Hinge is fundamentally different from Tinder/Bumble swipes:

1. **You like a specific ITEM** (photo or prompt), not the whole profile
2. Each like requires a `subjectId` (target user) and `ratingToken` (from recommendations response)
3. You can attach a `comment` to any like
4. The `content` field in the like payload specifies WHAT you liked:
   - `{"comment": "Your witty comment"}` -- comment on a prompt
   - `{"photo": {"contentId": "..."}}` -- like a specific photo
   - `{"prompt": {"questionId": "...", "response": "..."}}` -- like a prompt answer

**Like API call structure:**
```python
payload = {
    "ratingId": str(uuid.uuid4()),          # Unique ID for this rating
    "ratingToken": rating_token,             # From recommendations response
    "subjectId": subject_id,                 # Target user ID
    "sessionId": session_id,                 # Current session
    "rating": "note",                        # Always "note" for a like
    "origin": "compatibles",                 # Where you saw the profile
    "hasPairing": False,
    "created": datetime.utcnow().isoformat() + "Z",
    "initiatedWith": "standard",             # "standard" or "rose"
    "content": {                             # What you liked + optional comment
        "comment": "Great taste in music!",
        "prompt": {"questionId": "q123", "response": "their answer"}
    }
}
```

## Skip/Pass Mechanics

**Confidence: LOW** -- No explicit pass/skip endpoint found in either HingeSDK or squeaky-hinge. In the Hinge app, you simply scroll past profiles you don't like. The recommendations endpoint (`/rec/v2`) returns a batch of profiles; not interacting with one effectively skips it. There may be an unreversed `POST /rate/v2/initiate` with `rating: "remove"` or similar, but this is unverified.

**Recommendation:** Simply don't call the like endpoint for skipped profiles. The next call to `/rec/v2` will return new recommendations. Track skipped profiles locally to avoid re-processing.

## Auth Flow Implementation Detail

### Method 1: squeaky-hinge approach (reCAPTCHA + SMS)

```python
# Step 1: Register installation
install_id = str(uuid.uuid4()).lower()
resp = requests.post("https://prod-api.hingeaws.net/identity/install",
    headers={"X-App-Version": "9.2.1", "X-Device-Platform": "android"},
    json={"installId": install_id})

# Step 2: Get reCAPTCHA config
resp = requests.get("https://identitytoolkit.googleapis.com/v1/recaptchaParams",
    headers={"X-Android-Package": "co.hinge.app",
             "X-Android-Cert": "7D5F1D2ACE98A03B2C3A1A6B0DCB2B7F5D856F67"},
    params={"alt": "json", "key": "AIzaSyB-apSzB00iSHaEIG-5nalT2DDVSAHcPXA"})
recaptcha_site_key = resp.json()["recaptchaSiteKey"]
# User solves reCAPTCHA in browser...

# Step 3: Send SMS verification
resp = requests.post(
    "https://www.googleapis.com/identitytoolkit/v3/relyingparty/sendVerificationCode",
    headers={"X-Android-Package": "co.hinge.app",
             "X-Android-Cert": "7D5F1D2ACE98A03B2C3A1A6B0DCB2B7F5D856F67"},
    json={"phone_number": "+1234567890", "recaptcha_token": token},
    params={"alt": "json", "key": "AIzaSyB-apSzB00iSHaEIG-5nalT2DDVSAHcPXA"})
session_info = resp.json()["sessionInfo"]

# Step 4: Verify SMS code
resp = requests.post(
    "https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPhoneNumber",
    headers={"X-Android-Package": "co.hinge.app",
             "X-Android-Cert": "7D5F1D2ACE98A03B2C3A1A6B0DCB2B7F5D856F67"},
    json={"sessionInfo": session_info, "code": "123456"},
    params={"alt": "json", "key": "AIzaSyB-apSzB00iSHaEIG-5nalT2DDVSAHcPXA"})
sms_jwt = resp.json()["idToken"]

# Step 5: Exchange JWT for Hinge API token
resp = requests.post("https://prod-api.hingeaws.net/auth/sms",
    headers={"X-App-Version": "9.2.1", "X-Device-Platform": "android"},
    json={"installId": install_id, "token": sms_jwt})
hinge_token = resp.json()["token"]
user_id = resp.json()["identityId"]
```

### Method 2: HingeSDK approach (direct SMS, simpler)

```python
# Step 1: Initiate SMS
resp = requests.post("https://prod-api.hingeaws.net/auth/sms/v2/initiate",
    json={"phoneNumber": "+1234567890", "deviceId": device_id})

# Step 2: Verify OTP
resp = requests.post("https://prod-api.hingeaws.net/auth/sms/v2",
    json={"deviceId": device_id, "installId": install_id,
          "phoneNumber": "+1234567890", "otp": "123456"})
token = resp.json()["token"]
user_id = resp.json()["playerId"]
session_id = resp.json().get("sessionId") or str(uuid.uuid4())
```

### Method 3: Manual token extraction (easiest for users)

User captures bearer token from mitmproxy/HTTP Toolkit and pastes into config.
**Hinge does NOT use certificate pinning** -- confirmed by HingeSDK docs.

**Recommended approach:** Support all three methods. Default to Method 3 (manual token paste) for simplicity. Offer Method 2 (direct SMS) as automated option. Method 1 for completeness.

## Token Persistence

**Source: squeaky-hinge (HIGH confidence)**

Credentials stored in JSON file:
```json
{
    "hinge_token": "eyJhbG...",
    "user_id": "abc123",
    "hinge_install_id": "735de715-0876-45c5-be1e-aecdf8cb42d1",
    "device_id": "b4b578b8250e8ca8",
    "session_id": "some-uuid"
}
```

Store at `~/.clapcheeks/hinge_creds.json`. Check token validity on startup by calling a lightweight endpoint (e.g., `/auth/settings`). If 401, prompt re-auth.

## SendBird Messaging Flow

**Source: squeaky-hinge conversations.py (HIGH confidence -- full source code verified)**

```python
# Step 1: Exchange Hinge token for SendBird access token
resp = requests.post("https://prod-api.hingeaws.net/message/authenticate",
    headers={"Authorization": f"Bearer {hinge_token}",
             "X-App-Version": "9.68.0", "X-Device-Platform": "android",
             "X-Install-Id": install_id},
    json={"refresh": False})
sendbird_access_token = resp.json()["token"]

# Step 2: Open WebSocket to get session key
APP_ID = "3CDAD91C-1E0D-4A0D-BBEE-9671988BF9E9"
ws = websocket.create_connection(
    f"wss://ws-{APP_ID.lower()}.sendbird.com?"
    + urlencode({"ai": APP_ID, "user_id": user_id,
                 "access_token": sendbird_access_token}))
ws_data = json.loads(ws.recv().removeprefix("LOGI"))
session_key = ws_data["key"]

# Step 3: Fetch conversations
resp = requests.get(
    f"https://api-{APP_ID.lower()}.sendbird.com/v3/users/{user_id}/my_group_channels",
    headers={"Accept": "application/json", "Session-Key": session_key},
    params={"show_member": "true", "limit": "20", "order": "latest_last_message"})

# Step 4: Fetch messages for a channel
resp = requests.get(
    f"https://api-{APP_ID.lower()}.sendbird.com/v3/group_channels/{channel_url}/messages",
    headers={"Accept": "application/json", "Session-Key": session_key},
    params={"message_ts": timestamp, "next_limit": 200})
```

**Alternative: HingeSDK's /message/send endpoint** sends messages through Hinge's API directly (not through SendBird REST). This may be simpler for sending:
```python
resp = client.post("/message/send", json={
    "subjectId": user_id,
    "matchMessage": False,
    "origin": "Native Chat",
    "dedupId": str(uuid.uuid4()),
    "messageData": {"message": "Hey! Great talking to you"},
    "messageType": "message",
    "ays": True
})
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP API client | Raw urllib/requests | httpx with session | Connection pooling, async, timeout management |
| Auth flow | Custom OAuth | Follow squeaky-hinge/HingeSDK pattern | Already proven, tested flows |
| Messaging | Custom WebSocket | SendBird REST API + squeaky-hinge pattern | Complex protocol, already implemented |
| Token storage | In-memory only | JSON file at ~/.clapcheeks/ | Must persist across CLI invocations |
| Browser automation | Playwright for Hinge | Direct API calls | There is no web app |
| Comment generation | Template strings | Ollama/Claude AI | Must be unique, prompt-specific to avoid detection |
| Profile parsing | Manual JSON traversal | Pydantic models | Type safety, validation, clear structure |

## Common Pitfalls

### Pitfall 1: Assuming Hinge Has a Web App
**What goes wrong:** All Playwright code is useless. 404 on every page load.
**Why it happens:** Assumption that all dating apps have web versions.
**How to avoid:** API-direct approach. No BrowserDriver dependency.
**Status:** The existing hinge.py code is entirely wrong and must be replaced.

### Pitfall 2: Using 50 Likes/Day Instead of 8
**What goes wrong:** Code assumes 50 daily likes but free tier only allows 8.
**Why it happens:** Old plan used wrong number, possibly confused with Tinder limit.
**How to avoid:** Use `/likelimit` endpoint to get actual remaining likes at session start. Default to 8 for free tier.
**Warning signs:** Getting 429 or limit-exceeded responses after 8 likes.

### Pitfall 3: Generic/Template Comments
**What goes wrong:** Getting flagged as bot, low match rate, possible shadowban.
**Why it happens:** Sending same or formulaic comments.
**How to avoid:** AI-generate unique comments for EVERY like. Reference the specific prompt question and answer. Keep under 150 chars.
**Warning signs:** Zero matches despite sending likes, account review notification.

### Pitfall 4: Token Expiry Mid-Session
**What goes wrong:** 401 errors during operation.
**Why it happens:** Bearer tokens have finite lifetime.
**How to avoid:** Check token validity at session start. Catch 401 responses and prompt re-auth. Store token with timestamp.

### Pitfall 5: Not Using rating_token from Recommendations
**What goes wrong:** Like API calls fail or are rejected.
**Why it happens:** Each recommendation includes a `ratingToken` that must be passed back when liking.
**How to avoid:** Extract and store `ratingToken` for each profile when fetching recommendations.

### Pitfall 6: Sending Messages via Wrong Channel
**What goes wrong:** Messages don't appear in match's inbox.
**Why it happens:** Hinge has TWO messaging paths -- `/message/send` (via Hinge API) and SendBird direct.
**How to avoid:** Use `/message/send` for initial messages to matches. Use SendBird for conversation fetching and monitoring.

### Pitfall 7: Shadowban from Automation Patterns
**What goes wrong:** Profile stops appearing in others' feeds.
**Why it happens:** Right-swipe ratio >90%, liking max daily within minutes, identical messages to multiple matches.
**How to avoid:** Use all 8 likes spread across a session (not burst), vary timing with jitter, unique AI comments, mix with passes (simply skip profiles).

## Rate Limits and Ban Detection

### Daily Like Limits (MEDIUM confidence -- multiple sources agree)

| Tier | Likes/Day | Roses/Week | Source |
|------|-----------|------------|--------|
| Free | 8 | 1 | Multiple 2025-2026 sources |
| Hinge+ | Unlimited | More | Hinge subscription page |
| New accounts | ~10 | 1 | Some reports of slight variation |

### Shadowban Triggers (MEDIUM confidence -- community reports)
- Right-swipe ratio >90% in a session
- Using all daily likes within minutes of opening
- Sending identical messages to 10+ matches
- Deleting and recreating account within 90 days
- Automated behavior patterns (no jitter, perfect timing)

### Safe Automation Patterns
- Spread 8 likes across 15-30 minutes (not all at once)
- Add 2-8 second random delays between API calls
- Generate unique comments for every single like
- Vary session times (don't always run at same time of day)
- Check `/likelimit` before starting -- respect server-side limit
- Don't skip/pass every non-liked profile in rapid succession

## AI Comment Generation for Hinge Prompts

### Prompt Structure
Each Hinge profile has up to 3 prompts. Each prompt has:
- `questionId` -- identifies the prompt question (e.g., "A life goal of mine is...")
- `response` -- the user's text answer (or voice recording transcription)
- The prompts are included in the recommendations API response

### Comment Generation Approach
```python
system_prompt = (
    "You are a witty person on a dating app. Write a short comment (1 sentence, "
    "under 150 characters) responding to someone's Hinge prompt answer. Be genuine, "
    "specific to what they wrote, and playful. Never be generic or use pickup lines. "
    "Match their energy and tone."
)

user_prompt = f"Prompt question: {question_text}\nTheir answer: {answer_text}"
```

### Voice Matching (Advanced)
If iMessage conversation history is available for the user, analyze their texting style:
- Average message length
- Use of punctuation (periods vs no periods)
- Emoji frequency
- Formality level
- Humor style

Feed this as context to the AI to match the user's voice.

### Character Limit
Hinge enforces a 150-character limit on comments. The AI must generate within this limit. Truncate at word boundary if over.

## Traffic Analysis Notes

- **Hinge does NOT use certificate pinning** (confirmed by HingeSDK docs)
- mitmproxy on Android (rooted) or HTTP Toolkit can capture all traffic
- No Postman collections found publicly
- mitmproxy2swagger can auto-generate API specs from captured traffic
- iOS requires Frida or similar for TLS interception

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Browser automation | Direct API (no browser) | Always (no web app) | Only viable approach |
| ADB screen tapping | HTTP API calls | 2024 | More reliable, faster |
| 50 likes/day assumption | 8 likes/day (free) | 2024 | Must optimize every like |
| Generic "Hey!" openers | AI prompt-specific comments | 2024-2025 | 3x+ match rate |
| Tinder-style swipe loop | Like specific items (photo/prompt) | N/A (Hinge design) | Fundamentally different UX |

## Open Questions

1. **Skip/pass endpoint**
   - What we know: No explicit pass endpoint found in either SDK
   - What's unclear: Whether an unreversed endpoint exists
   - Recommendation: Simply don't like = skip. Track locally.

2. **Token lifetime**
   - What we know: Tokens are JWTs, work for at least days
   - What's unclear: Exact expiry time, refresh token availability
   - Recommendation: Store with timestamp, re-auth on 401

3. **App version enforcement**
   - What we know: Headers include `x-app-version`
   - What's unclear: Whether old versions are rejected
   - Recommendation: Use latest version string, update when API fails

4. **Recommendation response structure**
   - What we know: Contains `subjectId`, `ratingToken`, photos, prompts
   - What's unclear: Exact JSON schema
   - Recommendation: Log first response, build models from actual data

5. **HingeSDK vs squeaky-hinge SMS auth**
   - HingeSDK uses simpler `/auth/sms/v2` endpoints (direct)
   - squeaky-hinge uses Firebase/reCAPTCHA flow (more complex but proven)
   - Recommendation: Try HingeSDK's direct SMS first, fall back to squeaky-hinge flow

## Sources

### Primary (HIGH confidence)
- [HingeSDK](https://github.com/ReedGraff/HingeSDK) -- Full source code reviewed: client.py, api.py, models.py, tools.py
- [squeaky-hinge](https://github.com/radian-software/squeaky-hinge) -- Full source code reviewed: auth.py, conversations.py, squeaky_hinge_config.py
- Both projects provide working Python code against the live Hinge API

### Secondary (MEDIUM confidence)
- [hinge-command-control-c2](https://github.com/matthewwiese/hinge-command-control-c2) -- Confirms API structure, headers
- [Hinge Help Center](https://help.hinge.co) -- Confirms mobile-only, no web app
- Multiple dating advice sites -- Confirm 8 likes/day free tier (2025-2026)
- [SendBird Platform API Docs](https://sendbird.com/docs/chat/platform-api/v3/) -- Official messaging API
- [SendBird Hinge Case Study](https://sendbird.com/resources/hinge) -- Confirms Hinge uses SendBird

### Tertiary (LOW confidence)
- Shadowban articles on LinkedIn, tinderprofile.ai, roast.dating -- Community reports, not official
- Medium articles on Hinge automation -- General approaches

## Metadata

**Confidence breakdown:**
- No web app: HIGH -- confirmed by Hinge Help Center and all projects
- API endpoints: HIGH -- verified from HingeSDK and squeaky-hinge source code
- Auth flow: MEDIUM -- two different approaches documented, both may work
- Like mechanics: HIGH -- verified from HingeSDK api.py source code
- SendBird messaging: HIGH -- verified from squeaky-hinge conversations.py source code
- Rate limits (8/day): MEDIUM -- multiple community sources agree, not officially documented
- Skip/pass endpoint: LOW -- not found in any project, may not exist
- Shadowban triggers: LOW -- community reports only

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (API endpoints may change, app version headers need updating)
