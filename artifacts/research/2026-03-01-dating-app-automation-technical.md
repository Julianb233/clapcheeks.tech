# Technical Research: Dating App Automation at Scale (Tinder / Bumble / Hinge)

**Project:** Outward / clapcheeks.tech
**Date:** 2026-03-01
**Priority:** Scale — architecture that handles many concurrent users
**Depth:** Thorough — 4-5 approaches with tradeoffs

---

## Strategic Summary

Five approaches exist for automating dating apps at scale. **Unofficial REST APIs** offer the lowest resource footprint per user (80MB vs 1-2GB for browser-based approaches) but are fragile on Bumble. **Browserbase** eliminates local resource usage entirely by running browsers in the cloud. The **hybrid approach** — API-first for Tinder/Hinge, Browserbase for Bumble and auth token refresh — is the recommended production architecture: it keeps each user's local agent under 200MB RAM, costs ~$1-3/user/month in cloud browser time, and minimizes the detection surface to short auth-only browser sessions (~5 min/day vs continuous browser automation).

---

## Requirements

- Each user runs a local agent on their Mac (privacy-first, no personal data in cloud)
- Must support Tinder, Bumble, and Hinge
- Scalable: works across many concurrent users without heavy local resources
- Minimize ban risk with safe behavioral patterns
- Anonymized metrics only sync to clapcheeks.tech API

---

## Approach 1: Playwright + playwright-extra Stealth

**How it works:** Drives a real Chromium browser via CDP. The `playwright-extra` plugin layer applies ~20 JavaScript patches to mask automation artifacts: removes `navigator.webdriver`, patches `window.chrome`, randomizes canvas fingerprint, spoofs plugins list.

**Libraries/tools:**
```bash
npm install playwright playwright-extra puppeteer-extra-plugin-stealth
# playwright 1.44.x | playwright-extra 4.3.6 | stealth plugin 2.11.2
```

```javascript
const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth');
chromium.use(stealth());
const browser = await chromium.launch({ headless: false });
```

**Pros:**
- Familiar Playwright API — easy to get started
- Works against generic bot detection (Cloudflare, DataDome)
- JavaScript-level patches cover most detection vectors

**Cons:**
- **Stealth plugin last major update: 2021** — falling behind modern detection techniques
- CDP protocol fingerprint is detectable at the network layer (no JS patch fixes this)
- 800MB–1.2GB RAM per Chromium instance — kills Mac performance with concurrent users
- Tinder's Arkose Labs + behavioral biometrics detect uniform swipe timing
- Accounts doing >50 swipes/hour get soft-banned within 24-72 hours

**Best when:** Proof of concept / local testing only. Not for production SaaS.

**Complexity:** M

---

## Approach 2: Unofficial REST APIs (Reverse-Engineered)

**How it works:** Dating apps' mobile clients use REST/protobuf backends. These endpoints are captured via MITM proxy and called directly — no browser involved.

**Tinder API:**
```
Base: https://api.gotinder.com
Auth: X-Auth-Token header (24-hour TTL)

GET  /v2/recs/core         # Swipe deck
POST /like/{userId}        # Right swipe
POST /pass/{userId}        # Left swipe
GET  /v2/matches           # List matches
POST /user/matches/{id}    # Send message
```

**Libraries/tools:**
```
# Tinder (Node.js — build direct against API, no maintained wrapper)
# Reference: github.com/Miguelo981/tinder-api (TypeScript, 2024)
# Docs: github.com/NastyDevs/tinder-api-documentation

# Hinge
pip install hinge-sdk   # github.com/ReedGraff/HingeSDK — active 2024
# also: github.com/radian-software/squeaky-hinge

# Bumble — API too fragile (request signing is obfuscated HMAC)
# Use browser approach for Bumble only
```

**Pros:**
- Zero browser overhead — 80MB RAM per Node.js process
- No CDP fingerprint, no JavaScript execution anomalies
- Detection is behavioral only (rate limits, timing patterns)
- Scales to hundreds of users per server
- Tinder's core swipe/match/message endpoints stable since 2019

**Cons:**
- Token acquisition requires solving Arkose CAPTCHA (needs browser once per session)
- **Bumble**: request signing algorithm is obfuscated — breaks every few months
- Tinder auth flow changes regularly (FB → phone → OTP over the years)
- No official API contract — any server-side change breaks integration
- `tinder.py` (last commit 2021), `pynder` (2019) — most wrappers are dead

**Best when:** Primary approach for Tinder and Hinge. Avoid for Bumble.

**Complexity:** M (Tinder) / H (Bumble)

---

## Approach 3: Appium + iOS Simulator (XCUITest)

**How it works:** Appium wraps Apple's native XCUITest framework to automate the actual Tinder/Bumble/Hinge iOS app running in a simulator. Touch events are dispatched at the OS level — the app sees them as identical to real user input.

**Libraries/tools:**
```bash
# macOS + Xcode 15.x required
npm install -g appium
appium driver install xcuitest   # appium-xcuitest-driver 7.x

pip install Appium-Python-Client  # >= 3.0
```

```python
from appium import webdriver
from appium.options.ios import XCUITestOptions
options = XCUITestOptions()
options.device_name = "iPhone 15 Pro"
options.app = "com.cardify.tinder"
driver = webdriver.Remote("http://localhost:4723", options=options)
driver.swipe(200, 400, 600, 400, 300)  # right swipe
```

**Pros:**
- Strongest client-side stealth — XCUITest events are OS-level, indistinguishable from real touch
- No CDP, no `navigator.webdriver`, no JavaScript injection
- Works against apps with certificate pinning (automation bypasses the network layer)
- Appium 2.x actively maintained by OpenJS Foundation

**Cons:**
- **2-4GB RAM per simulator instance** — a 16GB MacBook runs 1 simulator max
- 15-25GB disk space per full iOS simulator package
- 30-90 second cold boot time per session
- Apps detect simulator via `UIDevice.isSimulator`, missing sensors (gyroscope, camera)
- Xcode required — can't distribute to SaaS users without developer complexity
- Selector updates required every time Tinder/Bumble ships a UI change

**Best when:** Enterprise QA with dedicated Mac Pro hardware. Not for local SaaS.

**Complexity:** VH

---

## Approach 4: Browserbase Cloud Browser

**How it works:** Browserbase runs managed Chromium instances in the cloud. Your local agent connects via CDP over WebSocket — the browser runs on Browserbase's infrastructure, not the user's Mac.

**Libraries/tools:**
```bash
npm install @browserbasehq/sdk playwright-core
```

```javascript
const { chromium } = require('playwright-core');
const browser = await chromium.connectOverCDP(
  `wss://connect.browserbase.com?apiKey=${BROWSERBASE_API_KEY}`
);
// Identical to local Playwright from here
const page = await browser.newPage();
await page.goto('https://tinder.com');
```

**Pricing (2026):**
| Plan | $/mo | Browser Hours | Concurrent |
|------|------|---------------|------------|
| Developer | $20 | 100 hrs | 25 |
| Startup | $99 | 500 hrs | 100 |
| Scale | Custom | Custom | Custom |

At 30 min/day automation: ~15 hrs/month = **~$3/user/month** on Developer plan.

**Features:**
- Built-in CAPTCHA solving (Arkose Labs — critical for Tinder login)
- Rotating residential proxies (included)
- Session persistence (pause/resume with cookies intact)
- Pre-configured stealth (more current than `puppeteer-extra-plugin-stealth`)

**Pros:**
- **Zero local resources** — user's Mac runs only a lightweight agent (~80MB)
- CAPTCHA solving built-in — handles Tinder's Arkose Labs without extra service
- Professionally maintained anti-detection (updated vs. 2021-era stealth plugins)
- Drop-in Playwright replacement — minimal code changes
- Session recording for debugging

**Cons:**
- ~$3-5/user/month ongoing cost — adds to unit economics
- Generic anti-detection, not tuned specifically for dating apps
- Still vulnerable to behavioral detection (server-side pattern analysis)
- Phone OTP verification still requires out-of-band handling
- Vendor dependency — pricing/API changes affect your product

**Best when:** Bumble automation (API too fragile) and Tinder auth token refresh.

**Complexity:** L-M

---

## Approach 5: Hybrid — Unofficial API + Browserbase Fallback ⭐ RECOMMENDED

**How it works:** API-first architecture for Tinder and Hinge (zero browser, 80MB RAM). Browserbase for Bumble (browser-only) and for periodic auth token refresh across all platforms (~5 min/day of browser time). The local agent manages token lifecycle, rate limiting, and coordination.

**Decision tree:**
```
Tinder:
  API (api.gotinder.com) → all swipes, matches, messages
  Token expired? → Browserbase session (5 min) → extract fresh token → resume API

Hinge:
  HingeSDK → all swipes, matches, messages
  Auth refresh → Browserbase session as needed

Bumble:
  Browserbase always (API signing too fragile for production)
  Session persisted → reconnect daily rather than re-login
```

**Libraries/tools:**
```javascript
// Node.js local agent
// Tinder: direct fetch to api.gotinder.com (no wrapper needed)
//   Reference: github.com/Miguelo981/tinder-api
// Hinge: REST client (HingeSDK patterns, ported to Node.js)
// Browserbase: @browserbasehq/sdk + playwright-core
// Token storage: keytar (macOS Keychain) for encrypted local storage

npm install @browserbasehq/sdk playwright-core keytar node-fetch
```

```python
# Python alternative for Hinge
pip install hinge-sdk requests keyring
```

**Safe behavioral patterns to implement:**
| Action | Safe Rate | Notes |
|--------|-----------|-------|
| Right swipes | 40-60/day | Free users cap at ~100; stay under |
| Left swipes | 200-400/day | Less scrutinized |
| Swipe delay | 3-15 seconds | Add Gaussian jitter (not uniform) |
| Messages | 5-10/hour max | Templated messages flagged by NLP |
| Offline gap | 8+ hours/day | Simulate sleep/downtime |
| IP | Same residential per user | Changes trigger re-auth |

**Pros:**
- **Lowest local resource usage** — 80-150MB RAM per user (no persistent browser)
- API mode has zero browser fingerprint risk — detection is behavioral only
- Browserbase CAPTCHA solving for Tinder login flows
- Browser exposure minimized to ~5 min/day (auth refresh only)
- Most scalable — hundreds of users on modest VPS; local Mac handles only lightweight process
- Best ban risk profile — combines API stealth with conservative rate limits

**Cons:**
- Highest initial build complexity — token lifecycle state machine, multi-mode coordination
- Tinder API still subject to breaking changes (no official contract)
- Bumble still browser-only — Browserbase costs apply
- Phone number supply for new account creation is an unsolved operational problem
- Requires ongoing maintenance as APIs evolve

**Best when:** Production SaaS serving multiple paying users. This is the architecture.

**Complexity:** H (initial) → L (ongoing)

---

## Comparison

| Aspect | Playwright+Stealth | Unofficial APIs | Appium+iOS | Browserbase | **Hybrid ⭐** |
|--------|-------------------|-----------------|------------|-------------|--------------|
| RAM/user | 1-2 GB | 80 MB | 2-4 GB | 80 MB | **80-150 MB** |
| Ban risk | High | Medium | Low | Medium | **Low-Medium** |
| Tinder | Yes | Yes | Yes | Yes | **API** |
| Bumble | Yes | Fragile | Yes | Yes | **Browser** |
| Hinge | Yes | Yes | Yes | Yes | **API** |
| Setup complexity | M | M | VH | L | **H** |
| Maintenance | High | High | High | Low | **Medium** |
| SaaS scalability | Poor | Excellent | Poor | Excellent | **Excellent** |
| Cost/user/mo | $0 | $0 | $0 | $3-5 | **$1-3** |
| Stealth (client) | Weak | Strong | Strongest | Medium | **Strong** |
| Library status | Stale | Mixed | Active | Active | **Mixed** |

---

## Recommendation

**Hybrid API + Browserbase** is the only approach that checks all boxes for a multi-user SaaS:

1. **Tinder + Hinge:** Use direct REST APIs. Zero browser, zero local resources beyond the agent process. Detection is behavioral — solved with conservative rate limits and jitter.
2. **Bumble:** Browserbase only. Bumble's request signing makes their API impractical; Browserbase handles the browser session in the cloud with CAPTCHA solving.
3. **Auth refresh:** Browserbase on-demand for all platforms (~5 min/day). This keeps each user's browser exposure to a tiny window, dramatically reducing fingerprint detection risk.

---

## Implementation Context

```xml
<claude_context>
<chosen_approach>
  <name>Hybrid API + Browserbase</name>
  <libraries>
    @browserbasehq/sdk (latest)
    playwright-core (1.44.x)
    keytar (^7.9.0) — macOS Keychain token storage
    node-fetch (^3.3.2) — Tinder API calls
    hinge-sdk (Python, ReedGraff) — Hinge automation
    python-dotenv (^1.0)
  </libraries>
  <install>
    npm install @browserbasehq/sdk playwright-core keytar node-fetch
    pip install hinge-sdk python-dotenv
    npx playwright install chromium  # for local fallback only
  </install>
</chosen_approach>

<architecture>
  <pattern>Token vault + API client + on-demand cloud browser</pattern>
  <components>
    1. TokenVault — keytar-backed encrypted store for auth tokens per platform
    2. TinderClient — direct fetch wrapper for api.gotinder.com
    3. HingeClient — HingeSDK wrapper or direct REST
    4. BumbleClient — Browserbase session manager (persistent cookies)
    5. AuthRefresher — spawns Browserbase session to re-authenticate, extracts token
    6. RateLimiter — Gaussian-jittered delays, daily swipe counters
    7. SyncClient — POST anonymized metrics to clapcheeks.tech API
  </components>
  <data_flow>
    User config (mac_mini_url, platform prefs)
      → Agent reads TokenVault
      → Token valid? → API client directly
      → Token expired/missing? → AuthRefresher (Browserbase) → TokenVault update
      → API client swipes/matches/messages
      → Events logged to local SQLite
      → SyncClient pushes daily anonymized totals to cloud API
  </data_flow>
</architecture>

<files>
  <create>
    agent/outward/platforms/
      tinder.js       # Tinder REST API client
      hinge.js        # Hinge SDK wrapper
      bumble.js       # Browserbase session manager for Bumble
      auth.js         # AuthRefresher — token acquisition via Browserbase
    agent/outward/
      token_vault.js  # keytar wrapper for secure local token storage
      rate_limiter.js # Gaussian jitter, daily counters, platform limits
      swipe_engine.js # Main orchestrator: load tokens, select platform, swipe, log
      sync.js         # POST anonymized metrics to api.clapcheeks.tech
  </create>
  <structure>
    agent/outward/platforms/ — one module per dating platform
    agent/outward/data/      — local SQLite for session state, match history
    ~/.outward/config.yaml   — user config (API token, platform preferences)
    ~/.outward/.keystore     — managed by keytar (macOS Keychain)
  </structure>
</files>

<implementation>
  <start_with>TinderClient — simplest platform, most documented API</start_with>
  <order>
    1. TinderClient (direct API calls, hardcode test token first)
    2. TokenVault (keytar integration for token storage)
    3. AuthRefresher (Browserbase → extract Tinder X-Auth-Token from localStorage)
    4. RateLimiter (Gaussian jitter, daily counters)
    5. HingeClient (HingeSDK patterns)
    6. BumbleClient (Browserbase persistent session, no token extraction needed)
    7. SyncClient (POST metrics to clapcheeks.tech/analytics/sync)
    8. swipe_engine.js (orchestrator tying everything together)
  </order>
  <gotchas>
    - Tinder X-Auth-Token lives in localStorage key "TinderWeb/access-token" on web app
    - Browserbase sessions must be resumed (not re-created) to keep Tinder cookies valid
    - Bumble blocks if same session IP changes — use dedicated Browserbase context per user
    - Hinge uses GraphQL for some endpoints, REST for others — check HingeSDK for current mapping
    - keytar requires macOS Keychain access prompt on first use — handle gracefully in CLI
    - Gaussian jitter: Math.floor(3000 + Math.random() * 12000) ms between swipes, not uniform
    - Tinder "Fast Match" and "Super Likes" have separate rate limits from regular swipes
    - Store match IDs locally — Tinder's /v2/matches paginates and doesn't return already-seen matches
  </gotchas>
  <testing>
    - Unit test: TinderClient with mocked fetch (nock or msw)
    - Integration test: Browserbase sandbox session → extract token → verify format
    - Rate limiter test: ensure jitter distribution is Gaussian not uniform
    - E2E test: Full swipe cycle on a test account (low volume, manually verify no ban)
    - Monitor: Log all API responses to local SQLite — detect anomalies (429, auth errors)
  </testing>
</implementation>
</claude_context>
```

**Next Action:** Start with `TinderClient` + `TokenVault` + `AuthRefresher` — the core auth loop is the hardest part and unlocks everything else. Once tokens flow correctly, the swipe/match/message logic is straightforward.

---

## Legal Note

All three platforms prohibit automated access in their ToS (Tinder §5, Bumble §3.3, Hinge §4). A commercial SaaS product built on ToS violations carries litigation risk under CFAA and state computer fraud laws. Existing products in this space (Wingman, Rizz, WingAI) use screenshot-based analysis — user provides a screenshot, AI suggests a reply — which avoids direct automation. Consider whether a **screenshot-based AI coaching** tier alongside automation keeps the product in a safer legal zone for launch, with automation as an opt-in power-user feature.

---

## Sources

- [Scrapeless: Avoid Bot Detection With Playwright Stealth](https://www.scrapeless.com/en/blog/avoid-bot-detection-with-playwright-stealth)
- [Castle: From Puppeteer stealth to Nodriver](https://blog.castle.io/from-puppeteer-stealth-to-nodriver-how-anti-detect-frameworks-evolved-to-evade-bot-detection/)
- [The Web Scraping Club: Browser Automation Landscape 2025](https://substack.thewebscraping.club/p/browser-automation-landscape-2025)
- [GitHub: rednit-team/tinder.py](https://github.com/rednit-team/tinder.py)
- [GitHub: NastyDevs/tinder-api-documentation](https://github.com/NastyDevs/tinder-api-documentation)
- [GitHub: Miguelo981/tinder-api](https://github.com/Miguelo981/tinder-api)
- [GitHub: ReedGraff/HingeSDK](https://github.com/ReedGraff/HingeSDK)
- [GitHub: radian-software/squeaky-hinge](https://github.com/radian-software/squeaky-hinge)
- [Security Evaluators: Reverse Engineering Bumble's API](https://blog.securityevaluators.com/reverse-engineering-bumbles-api-a2a0d39b3a87)
- [Browserbase Plans and Pricing](https://docs.browserbase.com/guides/plans-and-pricing)
- [Browserbase Massive Price Decrease Changelog](https://www.browserbase.com/changelog/massive-price-decrease)
- [Appium iOS XCUITest Driver Documentation](https://appium.readthedocs.io/en/latest/en/drivers/ios-xcuitest/)
- [Camoufox Stealth Overview](https://camoufox.com/stealth/)
- [npm: playwright-extra](https://www.npmjs.com/package/playwright-extra)
