# Phase 13: Bumble Automation — Research

**Researched:** 2026-03-01
**Domain:** Bumble web/API automation, anti-detection, post-web-shutdown strategy
**Confidence:** MEDIUM-HIGH

## Summary

Bumble's web app at bumble.com is being discontinued — the official support page says "soon" with no specific date, but as of March 2026 it appears the shutdown is imminent or may have already begun in some regions. The critical finding is that **Bumble's underlying API (`bumble.com/mwebapi.phtml` or `bumble.com/unified-api.phtml`) continues to function independently of the web UI**. Multiple open-source projects have successfully reverse-engineered this API, and the request format is well-documented.

The API uses a JSON-over-HTTP format with protobuf-like message types (not actual protobuf), authenticated via session cookies and signed with an MD5 hash using a known static secret key. This means a direct API client is fully viable and does not depend on the web UI existing.

For bot detection, Bumble uses DataDome, which is considered the hardest anti-bot system to bypass in 2026. Traditional Playwright stealth is insufficient. The recommended approach is Patchright (patched Playwright) or Camoufox (patched Firefox), combined with residential proxies and behavioral simulation.

**Primary recommendation:** Build a dual-track system — Track A uses Playwright with API interception for immediate use while web exists, Track B is a pure API client using the reverse-engineered endpoints. Both tracks share a `BumbleClient` abstract interface so they are swappable. Prioritize Track B as the long-term solution since the web UI is going away.

## CRITICAL: Bumble Web Discontinuation

**Source:** [Bumble Support — An update on Bumble web](https://support.bumble.com/hc/en-us/articles/30996192802973-An-update-on-Bumble-web)

**Status as of March 2026:**
- Official announcement says "will be discontinued soon"
- No specific date has been publicly announced
- Bumble has been aggressively cutting costs (30% workforce laid off June 2025, shut down Fruitz and Official apps)
- The web features page at `bumble.com/en/features/web/` still exists but may redirect to download prompts
- The API endpoints (`mwebapi.phtml`, `unified-api.phtml`) are backend services used by both web and mobile — they will survive the web UI shutdown

**Confidence:** HIGH — Official Bumble announcement confirms discontinuation. The absence of a specific date is itself confirmed.

**Impact:**
- Pure web DOM automation has a limited and shrinking lifespan
- API interception approach (intercepting web requests to learn the API) is immediately valuable
- Direct API client is the only viable long-term approach
- The API is NOT going away — only the web frontend is

## Bumble API — Reverse Engineered

### API Endpoints

**Confidence:** HIGH — Verified across multiple independent open-source projects

| Endpoint URL | Notes |
|-------------|-------|
| `https://bumble.com/mwebapi.phtml` | Web API endpoint (henrydatei/bumble-api) |
| `https://bumble.com/unified-api.phtml?` | Unified API endpoint (orestis-z/bumble-bot) |

Both endpoints accept the same message format. The unified endpoint may be newer.

### Message Types

All API calls use a JSON wrapper with a `message_type` field:

| Message Type ID | Name | Purpose |
|----------------|------|---------|
| 2 | `SERVER_APP_STARTUP` | Initialize session, get user ID, device registration |
| 80 | `SERVER_ENCOUNTERS_VOTE` | Like/dislike a user (swipe) |
| 81 | `SERVER_GET_ENCOUNTERS` | Get users in the match queue |
| 102 | `SERVER_OPEN_CHAT` | Retrieve chat history for a conversation |
| 104 | `SERVER_SEND_CHAT_MESSAGE` | Send a message to a match |
| 245 | `SERVER_GET_USER_LIST` | Get conversation/match list |
| 403 | `SERVER_GET_USER` | Fetch a specific user's profile |

### Request Format

```json
{
  "$gpb": "badoo.bma.BadooMessage",
  "body": [
    {
      "message_type": 81,
      "server_get_encounters": {
        "number": 50,
        "context": 1,
        "user_field_filter": {
          "projection": [210, 370, 200, 230, 490, 540, 530, 560, 291, 732]
        }
      }
    }
  ],
  "message_id": 1,
  "message_type": 81,
  "version": 1,
  "is_background": false
}
```

### Authentication

**Session-based:** The API uses a session cookie for authentication.

```
Cookie: session=<SESSION_TOKEN>; session_cookie_name=session
```

Additional required headers:
- `X-Pingback`: MD5 signature of `body + "whitetelevisionbulbelectionroofhorseflying"` (static secret key found in JS bundle)
- `X-Message-type`: Matches the `message_type` field
- `x-use-session-cookie: 1`
- `User-Agent`: Standard browser user-agent string
- `Content-Type: application/json`

**Request Signing:**
```python
import hashlib
body_str = json.dumps(payload)
signature = hashlib.md5((body_str + "whitetelevisionbulbelectionroofhorseflying").encode()).hexdigest()
headers["X-Pingback"] = signature
```

**Confidence:** HIGH — The MD5 signing secret is extracted from Bumble's JavaScript bundle. Verified in henrydatei/bumble-api (`api.py`). The secret `"whitetelevisionbulbelectionroofhorseflying"` is a static string, not per-session.

### Vote (Swipe) Values

| Value | Meaning |
|-------|---------|
| 1 | Not yet voted (profile not seen) |
| 2 | Like (right swipe) |
| 3 | Pass (left swipe) |

### Key Finding: No Server-Side Swipe Limit Enforcement

From the ISE security research: "The only check on the swipe limit is through the mobile front-end, which means there is no check on the actual API request." The `SERVER_ENCOUNTERS_VOTE` endpoint does not enforce daily limits server-side. However, using this aggressively would likely trigger anti-abuse detection.

**Confidence:** MEDIUM — From 2020 security research; Bumble may have added server-side checks since then.

## Reference Projects

### henrydatei/bumble-api (Python) — PRIMARY REFERENCE
- **URL:** https://github.com/henrydatei/bumble-api
- **Language:** Python
- **Endpoints:** `mwebapi.phtml`
- **Methods:** `SERVER_APP_STARTUP`, `SERVER_GET_ENCOUNTERS`, `SERVER_ENCOUNTERS_VOTE`, `SERVER_OPEN_CHAT`, `SERVER_SEND_CHAT_MESSAGE`, `SERVER_GET_USER`, `SERVER_GET_USER_LIST`
- **Auth:** Session cookie + MD5 X-Pingback signing
- **Status:** Active (17 commits), most complete Python implementation
- **Confidence:** HIGH

### orestis-z/bumble-bot (Python) — SWIPE AUTOMATION REFERENCE
- **URL:** https://github.com/orestis-z/bumble-bot
- **Language:** Python
- **Endpoints:** `unified-api.phtml`
- **Methods:** `SERVER_GET_ENCOUNTERS` (type 81), `SERVER_ENCOUNTERS_VOTE` (type 80)
- **Features:** Auto-swipe with configurable like probability, exponential backoff
- **Auth:** Session via `requests.Session()`, phone login
- **Status:** Functional reference for swipe automation flow
- **Confidence:** HIGH

### Other Projects
| Project | Language | Focus | Notes |
|---------|----------|-------|-------|
| bumble-auto-liker | JS (Chrome ext) | DOM selectors | Good selector reference |
| bumble-like-revealer | JS (Chrome ext) | API interception | Shows `SERVER_GET_ENCOUNTERS` interception |
| Rasputin (onurcangnc) | Python/Selenium | Full automation | Selenium-based, outdated |
| BumbleBot (range-et) | Python | ML-based preferences | Learns swipe preferences |
| mDuval1/bumble-bot | Python | Auto swipe | Simple implementation |

## Bot Detection: DataDome

**Confidence:** HIGH — Multiple 2026 sources confirm DataDome is Bumble's anti-bot provider.

### What DataDome Detects

DataDome focuses on **behavioral signals** over fingerprinting:
- **CDP detection:** `Runtime.enable` command that Playwright sends — this is the #1 detection vector
- **Timing inconsistencies:** Actions that happen too fast or too uniformly
- **Mouse/keyboard patterns:** Missing natural movement patterns
- **TLS fingerprint:** JA3/JA4 fingerprint mismatch with claimed browser
- **Header order:** Non-browser-like header ordering
- **Canvas/WebGL fingerprints:** Automation-specific rendering differences

### Bypass Approaches (2026 State of Art)

| Tool | Approach | DataDome Effectiveness | Notes |
|------|----------|----------------------|-------|
| **Patchright** | Patched Playwright (no Runtime.enable) | PARTIAL — passes some, fails advanced | Drop-in Playwright replacement |
| **Camoufox** | Source-patched Firefox | GOOD — passes most tests | Python API, isolated JS execution |
| **rebrowser-patches** | Puppeteer/Playwright patches | PARTIAL | Collection of anti-detection patches |
| **Residential proxies** | IP reputation | REQUIRED — datacenter IPs blocked | Must combine with browser stealth |
| **curl_cffi** | TLS fingerprint matching | N/A for browser | Good for direct API calls |

### Recommendation for Bumble

**For Track A (Playwright web):** Use Patchright as a drop-in Playwright replacement. It patches out `Runtime.enable` at the source level. Combined with residential proxies and human-like delays, this is the best available option.

**For Track B (Direct API):** Use `curl_cffi` or `requests` with proper TLS fingerprinting. Direct API calls bypass browser-level detection entirely. The main risk is request pattern detection (rate, timing).

### Patchright Details

- **What:** Playwright fork that removes CDP leaks
- **How:** Executes JS in isolated ExecutionContexts instead of using Runtime.enable
- **Install:** `pip install patchright` (drop-in replacement for `playwright`)
- **Usage:** Same API as Playwright — `from patchright.sync_api import sync_playwright`
- **Confidence:** MEDIUM — Works against some DataDome sites, but DataDome evolves monthly

### puppeteer-extra-stealth Deprecated

As of February 2026, puppeteer-extra-stealth has been deprecated. The maintainers acknowledged that patching Chromium automation flags is no longer viable against modern detection. This affects the entire ecosystem of stealth plugins.

## Playwright Network Interception

**Confidence:** HIGH — Official Playwright documentation

For intercepting Bumble API calls while the web app exists:

### Capturing Responses (Read-Only)

```python
# Listen to all responses
async def on_response(response):
    url = response.url
    if "SERVER_GET_ENCOUNTERS" in url or "mwebapi" in url:
        try:
            body = await response.json()
            # Process encounter data, extract profiles
        except:
            pass

page.on("response", on_response)
```

### Intercepting Requests (Modify/Replay)

```python
# Intercept and capture request details for later replay
captured_headers = {}

async def capture_auth(route, request):
    captured_headers["cookie"] = request.headers.get("cookie", "")
    captured_headers["x-pingback"] = request.headers.get("x-pingback", "")
    captured_headers["user-agent"] = request.headers.get("user-agent", "")
    await route.continue_()

await page.route("**/mwebapi.phtml**", capture_auth)
await page.route("**/unified-api.phtml**", capture_auth)
```

### Replay with requests Library

Once headers are captured from the browser session, replay directly:

```python
import requests
import hashlib
import json

def bumble_api_call(session_cookie, message_type, body_content):
    payload = {
        "$gpb": "badoo.bma.BadooMessage",
        "body": [body_content],
        "message_id": 1,
        "message_type": message_type,
        "version": 1,
        "is_background": False,
    }
    body_str = json.dumps(payload)
    sig = hashlib.md5((body_str + "whitetelevisionbulbelectionroofhorseflying").encode()).hexdigest()

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 ...",
        "X-Pingback": sig,
        "X-Message-type": str(message_type),
        "x-use-session-cookie": "1",
        "Cookie": f"session={session_cookie}",
    }
    resp = requests.post("https://bumble.com/mwebapi.phtml", json=payload, headers=headers)
    return resp.json()
```

## Mobile API Approach (Post-Web-Shutdown)

**Confidence:** MEDIUM — General mitmproxy approach is well-documented, Bumble-specific details are scarce.

### mitmproxy Interception

The mobile app uses the same backend API as the web app. To discover/verify endpoints:

1. **Setup:** Install mitmproxy, configure phone to use proxy
2. **SSL Pinning:** Bumble likely uses SSL pinning — bypass with Frida on rooted Android or jailbroken iOS
3. **Capture:** Record all API calls during normal app usage
4. **Analyze:** Map endpoints, headers, and authentication tokens

### Frida SSL Pinning Bypass

```bash
# Install frida
pip install frida-tools

# Use httptoolkit's universal unpinning script
frida -U -f com.bumble.app -l frida-interception-and-unpinning.js
```

**Key consideration:** The mobile app may use additional authentication (device ID, app signature, certificate pinning) beyond what the web uses. However, the core API endpoints and message format are the same.

### Mobile vs Web Authentication Differences

| Aspect | Web | Mobile |
|--------|-----|--------|
| Endpoint | `mwebapi.phtml` / `unified-api.phtml` | Likely same or similar |
| Auth | Session cookie | Session cookie + possible device token |
| Signing | MD5 X-Pingback | Same (shared JS/native code) |
| SSL Pinning | No | Yes — requires Frida bypass |
| Additional Headers | Standard browser headers | Device-specific headers possible |

## Abstraction Layer Design

### Interface Both Tracks Must Satisfy

```python
from abc import ABC, abstractmethod
from typing import Optional

class BumbleBackend(ABC):
    """Abstract interface for Bumble API interaction."""

    @abstractmethod
    def authenticate(self) -> bool:
        """Establish authenticated session. Returns True on success."""
        ...

    @abstractmethod
    def get_encounters(self, count: int = 20) -> list[dict]:
        """Get profiles from the encounter queue."""
        ...

    @abstractmethod
    def vote(self, user_id: str, like: bool) -> bool:
        """Vote on a user (like=True for right swipe, False for left)."""
        ...

    @abstractmethod
    def get_matches(self) -> list[dict]:
        """Get list of matches with turn/expiry info."""
        ...

    @abstractmethod
    def send_message(self, chat_id: str, message: str) -> bool:
        """Send a message in a conversation."""
        ...

    @abstractmethod
    def get_chat_messages(self, chat_id: str, count: int = 20) -> list[dict]:
        """Get recent messages from a chat."""
        ...
```

### Track A: PlaywrightBumbleBackend

- Uses Patchright browser to navigate bumble.com
- Intercepts API responses via `page.on("response")` for structured data
- Falls back to DOM interaction for actions (click like/dislike buttons)
- Captures session cookie for potential direct API replay
- **Lifespan:** Until web shutdown

### Track B: APIBumbleBackend

- Pure HTTP client using `requests` or `curl_cffi`
- Implements MD5 request signing
- Session obtained via phone login flow (manual initial auth, then persisted)
- No browser dependency
- **Lifespan:** Indefinite (survives web shutdown)

### BumbleClient (Facade)

```python
class BumbleClient:
    """Public-facing client that delegates to the active backend."""

    def __init__(self, driver=None, backend: str = "auto"):
        if backend == "api" or (backend == "auto" and driver is None):
            self._backend = APIBumbleBackend()
        else:
            self._backend = PlaywrightBumbleBackend(driver)

    def run_swipe_session(self, like_ratio=0.5, max_swipes=30) -> dict:
        # Delegates to self._backend methods
        ...
```

## Common Pitfalls

### Pitfall 1: Building Only for Web
**What goes wrong:** Entire automation breaks when Bumble removes web UI
**Why it happens:** Web Playwright is the familiar approach from Tinder
**How to avoid:** Build the API client (Track B) as the primary long-term solution. Track A is a bridge.
**Warning signs:** `bumble.com/app` redirecting to app store download page

### Pitfall 2: Hardcoding the MD5 Signing Secret
**What goes wrong:** Bumble rotates the secret key, all API calls fail
**Why it happens:** The secret is extracted from JS bundles which can change
**How to avoid:** Extract the secret dynamically from the JS bundle, or detect failures and re-extract
**Warning signs:** All API calls returning 403 or signature errors
**Current secret:** `"whitetelevisionbulbelectionroofhorseflying"` — verified in multiple projects as of early 2026

### Pitfall 3: Ignoring DataDome for Web Automation
**What goes wrong:** Account blocked or CAPTCHAs on every page load
**Why it happens:** Standard Playwright is trivially detected by DataDome
**How to avoid:** Use Patchright (patched Playwright), residential proxies, human-like delays
**Warning signs:** CAPTCHA challenges, "verify you're human" interstitials

### Pitfall 4: Aggressive API Usage Without Rate Limiting
**What goes wrong:** Account flagged, shadow-banned, or permanently banned
**Why it happens:** Direct API access removes the natural throttling of a UI
**How to avoid:** Implement self-imposed rate limits matching human behavior (1-3 second delays between votes, max 75/day)
**Warning signs:** Reduced match quality, matches not responding, account warnings

### Pitfall 5: Session Token Expiry
**What goes wrong:** Saved session stops working after days/weeks
**Why it happens:** Session cookies expire, Bumble rotates sessions
**How to avoid:** Detect 401 responses, implement re-authentication flow
**Warning signs:** API calls returning authentication errors

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request signing | Custom signing logic | Copy from henrydatei/bumble-api | MD5 + known secret, already solved |
| TLS fingerprinting | Custom TLS stack | curl_cffi library | Matches real browser JA3 fingerprints |
| Anti-detection browser | Custom Playwright patches | Patchright or Camoufox | Maintained by specialists, updated regularly |
| SSL pinning bypass | Custom frida scripts | httptoolkit/frida-interception-and-unpinning | Universal mobile unpinning, actively maintained |
| Session management | File-based token storage | `requests.Session()` with cookie jar persistence | Handles cookie rotation, expiry |

## Code Examples

### Direct API: Get Encounters

```python
# Source: henrydatei/bumble-api (api.py)
import hashlib
import json
import requests

BUMBLE_API = "https://bumble.com/mwebapi.phtml"
SIGNING_SECRET = "whitetelevisionbulbelectionroofhorseflying"

def sign_request(body_str: str) -> str:
    return hashlib.md5((body_str + SIGNING_SECRET).encode()).hexdigest()

def get_encounters(session_token: str, count: int = 20) -> dict:
    payload = {
        "$gpb": "badoo.bma.BadooMessage",
        "body": [{
            "message_type": 81,
            "server_get_encounters": {
                "number": count,
                "context": 1,
                "user_field_filter": {
                    "projection": [210, 370, 200, 230, 490, 540, 530, 560, 291, 732]
                }
            }
        }],
        "message_id": 1,
        "message_type": 81,
        "version": 1,
        "is_background": False,
    }
    body_str = json.dumps(payload)
    headers = {
        "Content-Type": "application/json",
        "X-Pingback": sign_request(body_str),
        "X-Message-type": "81",
        "x-use-session-cookie": "1",
        "Cookie": f"session={session_token}",
    }
    return requests.post(BUMBLE_API, data=body_str, headers=headers).json()
```

### Direct API: Vote (Swipe)

```python
# Source: orestis-z/bumble-bot (bot.py)
def vote_encounter(session_token: str, person_id: str, like: bool) -> dict:
    vote_value = 2 if like else 3  # 2=like, 3=pass
    payload = {
        "$gpb": "badoo.bma.BadooMessage",
        "body": [{
            "message_type": 80,
            "server_encounters_vote": {
                "person_id": person_id,
                "vote": vote_value,
                "vote_source": 1,
            }
        }],
        "message_id": 2,
        "message_type": 80,
        "version": 1,
        "is_background": False,
    }
    body_str = json.dumps(payload)
    headers = {
        "Content-Type": "application/json",
        "X-Pingback": sign_request(body_str),
        "X-Message-type": "80",
        "x-use-session-cookie": "1",
        "Cookie": f"session={session_token}",
    }
    return requests.post(BUMBLE_API, data=body_str, headers=headers).json()
```

### Direct API: Send Message

```python
# Source: henrydatei/bumble-api (api.py)
def send_message(session_token: str, to_id: str, message: str) -> dict:
    payload = {
        "$gpb": "badoo.bma.BadooMessage",
        "body": [{
            "message_type": 104,
            "chat_instance_id": to_id,
            "mssg": message,
        }],
        "message_id": 3,
        "message_type": 104,
        "version": 1,
        "is_background": False,
    }
    body_str = json.dumps(payload)
    headers = {
        "Content-Type": "application/json",
        "X-Pingback": sign_request(body_str),
        "X-Message-type": "104",
        "x-use-session-cookie": "1",
        "Cookie": f"session={session_token}",
    }
    return requests.post(BUMBLE_API, data=body_str, headers=headers).json()
```

### Playwright API Interception

```python
# Capture auth credentials from browser session for API replay
async def setup_api_capture(page):
    captured = {"session": None, "headers": {}}

    async def on_request(request):
        if "mwebapi" in request.url or "unified-api" in request.url:
            cookies = request.headers.get("cookie", "")
            if "session=" in cookies:
                for part in cookies.split(";"):
                    if part.strip().startswith("session="):
                        captured["session"] = part.strip().split("=", 1)[1]
            captured["headers"] = dict(request.headers)

    page.on("request", on_request)
    return captured
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Playwright stealth plugins | Patchright / Camoufox | Feb 2026 (stealth deprecated) | Must use source-patched browsers |
| Web DOM automation | Direct API client | Ongoing (web shutdown) | DOM approach has limited lifespan |
| Password-based API auth | SMS/phone code auth | ~2021 | Old bumapi library broke |
| Single endpoint | Dual endpoints (mwebapi + unified-api) | Unknown | Both work, unified may be newer |

## Open Questions

1. **Is the web app still accessible as of March 2026?**
   - What we know: Announced as "discontinued soon" but no specific date
   - What's unclear: Whether it's already redirecting in some regions
   - Recommendation: Test `bumble.com/app` — if it redirects, go straight to Track B

2. **Has the MD5 signing secret changed?**
   - What we know: `"whitetelevisionbulbelectionroofhorseflying"` was valid in henrydatei's recent commits
   - What's unclear: Whether Bumble has rotated it
   - Recommendation: Test with a real session; if 403, extract new secret from JS bundle

3. **Does the mobile app use additional authentication?**
   - What we know: Same API endpoints, same message format
   - What's unclear: Whether mobile adds device tokens, app signatures, or other headers
   - Recommendation: Use mitmproxy + Frida to compare mobile vs web request headers

4. **How aggressive is DataDome on direct API calls?**
   - What we know: DataDome primarily targets browser automation
   - What's unclear: Whether direct API calls trigger different detection
   - Recommendation: Start conservative (human-like timing), escalate if needed

## Sources

### Primary (HIGH confidence)
- [henrydatei/bumble-api](https://github.com/henrydatei/bumble-api) — Complete Python API client, MD5 signing, all endpoints
- [orestis-z/bumble-bot](https://github.com/orestis-z/bumble-bot) — Working swipe bot, unified-api endpoint
- [Bumble Support — Web Discontinuation](https://support.bumble.com/hc/en-us/articles/30996192802973-An-update-on-Bumble-web) — Official shutdown announcement
- [Playwright Network Docs](https://playwright.dev/docs/network) — API interception patterns

### Secondary (MEDIUM confidence)
- [ISE — Reverse Engineering Bumble's API](https://blog.securityevaluators.com/reverse-engineering-bumbles-api-a2a0d39b3a87) — Security research, vote values, endpoint discovery
- [HackerOne #1080437](https://hackerone.com/reports/1080437) — API vulnerability disclosures
- [ZenRows — DataDome Bypass Guide](https://www.zenrows.com/blog/datadome-bypass) — Current bypass state of art
- [ZenRows — Patchright Guide](https://www.zenrows.com/blog/patchright) — Patchright usage and effectiveness
- [Camoufox GitHub](https://github.com/daijro/camoufox) — Anti-detect browser

### Tertiary (LOW confidence)
- [bumble-auto-liker](https://github.com/amitoj-singh/bumble-auto-liker) — DOM selector reference (may be outdated)
- [bumble-like-revealer](https://github.com/Stupidoodle/bumble-like-revealer) — Chrome extension API interception
- Various WebSearch results about DataDome bypass techniques (rapidly evolving)

## Metadata

**Confidence breakdown:**
- API endpoints & format: HIGH — Multiple independent projects confirm same format
- MD5 signing mechanism: HIGH — Source code available, verified across projects
- Web shutdown timeline: MEDIUM — Confirmed happening, no date
- DataDome bypass: MEDIUM — Active research area, techniques evolve monthly
- Mobile API differences: LOW — Inferred from web API, not directly verified
- Current swipe limits: LOW — Not officially documented, may vary by account

**Research date:** 2026-03-01
**Valid until:** 2026-03-15 (web status may change any day; API signing secret may rotate)
