# Phase 14: Hinge Automation — Research

**Researched:** 2026-03-01
**Domain:** Hinge dating app automation
**Confidence:** HIGH

## Summary

**CRITICAL FINDING: Hinge has NO web app.** Hinge is a mobile-only application — there is no hinge.co web interface and there never has been. The existing PLAN.md assumes a web app at `https://hinge.co/app` — this is incorrect and the plan needs fundamental revision.

Hinge automation must use one of: (1) direct API access via reverse-engineered endpoints, (2) ADB-based mobile automation, or (3) screen mirroring with OCR. The API approach is strongly recommended because multiple open-source projects have successfully reverse-engineered Hinge's API, which is described as "relatively simple."

Hinge differs fundamentally from Tinder/Bumble: there are no swipes. Users "like" specific photos or prompt answers, optionally with a comment. Comments dramatically increase match rates. Free users get only **8 likes per day** — extremely restrictive.

**Primary recommendation:** Use direct API access (not browser automation). Base the implementation on existing reverse-engineered API patterns from HingeSDK and squeaky-hinge projects.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| httpx or requests | latest | HTTP client for API calls | Standard Python HTTP library |
| ollama | >=0.3 | AI comment generation on prompts | Already in requirements.txt |

### Reference Projects (CRITICAL)
| Project | URL | What It Proves |
|---------|-----|----------------|
| HingeSDK | github.com/ReedGraff/HingeSDK | Full Python SDK for Hinge API — fetch recommendations, send likes, messages |
| squeaky-hinge | github.com/radian-software/squeaky-hinge | Auth flow (Google Identity Platform), messaging (SendBird), API endpoints |
| hinge-bot | github.com/DeepankarSehra/hinge-bot | ADB-based automation with Gemini AI — alternative mobile approach |
| pitchPerfect | github.com/haran2001/pitchPerfect | GPT-4 comment generation for Hinge prompts — AI integration pattern |

## Architecture Patterns

### API-First Architecture (NOT browser automation)

Since there's no web app, the Hinge client is fundamentally different from Tinder/Bumble:

```
HingeClient
├── Does NOT use BrowserDriver
├── Uses HTTP API client directly
├── Auth: Google Identity Platform → Bearer Token
├── Recommendations: prod-api.hingeaws.net
└── Messaging: SendBird API
```

### Hinge API Details (from squeaky-hinge)

**Base URL:** `https://prod-api.hingeaws.net`

**Auth Flow:**
1. Generate a UUID to represent an installation
2. POST to `https://prod-api.hingeaws.net/identity/install` with the UUID
3. Authenticate via Google Identity Platform
4. Receive bearer token (JWT)
5. Use bearer token in subsequent API calls

**Key Endpoints:**
- `GET /recommendations` — fetch profiles to like/pass
- `POST /like` — like a photo or prompt (with optional comment)
- `POST /pass` — skip a profile
- `GET /matches` — list matches
- `GET /conversations` — list conversations

**Messaging:** Via SendBird (third-party messaging service) with its own API

### Auth Token Acquisition

The trickiest part for users. Options:
1. **mitmproxy** — user sets up proxy on phone, intercepts Hinge API traffic, extracts bearer token
2. **ADB logcat** — extract auth token from Android debug logs
3. **Manual entry** — user captures token from network inspector and pastes into CLI
4. **Automated helper** — CLI tool sets up mitmproxy and extracts token automatically

### Hinge Profile Structure
Each profile contains:
- 6 photos (URLs)
- 3 prompt answers (e.g., "A life goal of mine is...", "I get along best with people who...")
- Basic info: name, age, location, height, education, job
- Optional: Instagram link, relationship intent

### Like Mechanics
- You like a **specific item** (photo or prompt answer) — not the whole profile
- You can add a **comment** to your like — dramatically increases match rate
- **Roses** (premium currency) for Standout profiles
- Free tier: **8 likes per day** (very restrictive)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Hinge API client | Reverse-engineer from scratch | Reference HingeSDK/squeaky-hinge patterns | Already mapped endpoints and auth flow |
| Auth flow | Custom OAuth implementation | Follow squeaky-hinge's auth.py pattern | Google Identity Platform flow is documented |
| Messaging | Custom chat protocol | SendBird REST API | Hinge uses SendBird, has well-documented API |
| Prompt comments | Hardcoded templates | Ollama/Claude AI generation | Comments need to be specific to the prompt+answer to work |
| Web app automation | Playwright browser automation | API calls | **There is no web app** |

## Common Pitfalls

### Pitfall 1: Assuming Hinge Has a Web App
**What goes wrong:** Plan references hinge.co/app which doesn't exist, all browser automation code is useless
**Why it happens:** Assumption that all dating apps have web versions
**How to avoid:** Use API-direct approach; base class should support API-only clients (no BrowserDriver)
**Warning signs:** 404 on hinge.co/app, "Hinge is not available on the web" messages

### Pitfall 2: Ignoring the 8-Like Daily Limit
**What goes wrong:** Running out of likes quickly, automation feels useless
**Why it happens:** 8 likes/day is dramatically lower than Tinder (100) or Bumble (50)
**How to avoid:** Make each like count — AI-generate comments for every like, select targets carefully
**Warning signs:** User frustration with low throughput

### Pitfall 3: Generic Comments
**What goes wrong:** Sending the same template comment to every profile gets flagged or ignored
**Why it happens:** Template-based comments are obviously automated
**How to avoid:** Use AI to generate unique, prompt-specific comments; reference the actual prompt answer
**Warning signs:** Low match rate from liked profiles, account review

### Pitfall 4: Auth Token Expiry
**What goes wrong:** Token expires mid-session, API calls fail
**Why it happens:** JWT bearer tokens have limited lifetime
**How to avoid:** Implement token refresh logic, check token validity before each session, clear re-auth flow
**Warning signs:** 401 responses from API

### Pitfall 5: Making PlatformClient Require BrowserDriver
**What goes wrong:** Hinge client can't inherit from base class because it doesn't use a browser
**Why it happens:** Base class designed only for browser-based platforms
**How to avoid:** Base class should accept optional driver, or use protocol/interface that doesn't require browser
**Warning signs:** Forced to pass None/mock for driver parameter

## Hinge Rate Limits

| Tier | Likes per Day | Roses per Week | Notes |
|------|--------------|----------------|-------|
| Free | 8 | 1 | Very restrictive, comments are essential |
| HingeX/Preferred | Unlimited | Extra | See who liked you, enhanced filters |

## Code Examples

### Hinge API Client Pattern (MEDIUM confidence — based on HingeSDK)
```python
import httpx

class HingeAPI:
    BASE_URL = "https://prod-api.hingeaws.net"

    def __init__(self, bearer_token: str, install_id: str):
        self.client = httpx.AsyncClient(
            base_url=self.BASE_URL,
            headers={
                "Authorization": f"Bearer {bearer_token}",
                "X-Install-Id": install_id,
                "User-Agent": "Hinge/9.x.x (Android)",
            }
        )

    async def get_recommendations(self):
        response = await self.client.get("/recommendations")
        return response.json()

    async def like(self, user_id: str, content_id: str, comment: str = None):
        payload = {"user_id": user_id, "content_id": content_id}
        if comment:
            payload["comment"] = comment
        response = await self.client.post("/like", json=payload)
        return response.json()
```

### AI Comment Generation (HIGH confidence — follows existing Ollama pattern)
```python
import ollama

def generate_comment(prompt_text: str, prompt_answer: str) -> str:
    response = ollama.chat(
        model="llama3.2",
        messages=[
            {"role": "system", "content": "Write a short (1-2 sentences), genuine dating app comment responding to someone's prompt. Be specific to what they wrote, playful, and natural."},
            {"role": "user", "content": f"Prompt: {prompt_text}\nTheir answer: {prompt_answer}"},
        ],
        options={"temperature": 0.8, "num_predict": 100}
    )
    return response["message"]["content"].strip()[:150]  # Hinge character limit
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ADB screen tapping | Direct API access | 2024 | More reliable, faster, less detectable |
| Generic "Hey!" openers | AI-generated prompt-specific comments | 2024-2025 | Dramatically higher match rate |
| Liking random photos | Strategic target selection (prompts > photos) | Always | Comments on prompts get 3x+ more matches |

## Open Questions

1. **API stability**
   - What we know: HingeSDK and squeaky-hinge map current endpoints
   - What's unclear: How often Hinge changes API endpoints or adds security
   - Recommendation: Version the API client, handle 404s gracefully, alert on breaking changes

2. **Token refresh mechanism**
   - What we know: Auth uses Google Identity Platform JWT
   - What's unclear: Exact token lifetime, refresh token availability
   - Recommendation: Test token lifetime, implement proactive refresh

3. **SendBird messaging integration**
   - What we know: Hinge uses SendBird for messaging
   - What's unclear: Whether SendBird's public SDK works or if custom integration needed
   - Recommendation: Reference squeaky-hinge's messaging implementation

4. **Certificate pinning**
   - What we know: Some dating apps pin TLS certificates, blocking mitmproxy
   - What's unclear: Whether Hinge pins certificates on current Android versions
   - Recommendation: Test with mitmproxy, have ADB logcat as fallback for token capture

## Sources

### Primary (HIGH confidence)
- HingeSDK GitHub (ReedGraff) — Python SDK for Hinge API, demonstrates full like/message flow
- squeaky-hinge GitHub (radian-software) — Auth flow documentation, API endpoint mapping, SendBird messaging
- Hinge Help Center — confirms mobile-only, no web version

### Secondary (MEDIUM confidence)
- hinge-bot GitHub (DeepankarSehra) — ADB-based alternative approach with Gemini AI
- pitchPerfect GitHub (haran2001) — GPT-4 comment generation pattern for Hinge

### Tertiary (LOW confidence)
- Medium article "Building an AI app for Hinge" — general approach overview

## Metadata

**Confidence breakdown:**
- No web app: HIGH — confirmed by Hinge Help Center and all documentation
- API endpoints: MEDIUM — from open-source projects, may change
- Auth flow: MEDIUM — documented by squeaky-hinge, but Google Identity may evolve
- Comment generation: HIGH — standard Ollama/Claude pattern, no Hinge-specific risk

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (API endpoints may change, but architecture is stable)
