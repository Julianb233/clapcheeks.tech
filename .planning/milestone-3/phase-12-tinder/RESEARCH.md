# Phase 12: Tinder Automation — Research

**Researched:** 2026-03-01
**Domain:** Tinder web app (tinder.com) browser automation
**Confidence:** MEDIUM

## Summary

Tinder has a fully functional React web app at tinder.com, making it the most automatable dating platform. However, Tinder employs aggressive anti-bot measures including Arkose Labs CAPTCHA, behavioral analysis, shadowban algorithms, and protocol buffer API protection. The old API-based approach (pynder, etc.) is dead — Tinder switched to protobuf and added Arkose CAPTCHA. Browser automation via Playwright is the viable path.

Key constraint: Tinder gives free users ~50 likes per 12-hour cycle, and **shadowbans users who swipe right more than 70% of the time**. Conservative automation (40-50% like ratio, variable timing) is essential.

**Primary recommendation:** Automate via Playwright on tinder.com using aria-label selectors (not class names). Default to 40-50% like ratio, 2-8s variable delays, max 25-minute sessions.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| playwright | >=1.44 | Browser automation | Already in stack |
| playwright-stealth | 2.0.2 | Anti-detection | Required for Tinder's detection |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ollama | >=0.3 | Local AI for opener generation | Already in requirements.txt |

### Reference Projects
| Project | URL | Relevance |
|---------|-----|-----------|
| TinderBotz | github.com/frederikme/TinderBotz | Selenium-based, shows DOM patterns and detection avoidance |
| tinder-bot | github.com/lhandal/tinder-bot | Selenium + deep learning, photo scoring approach |
| tinder-api-documentation | github.com/NastyDevs/tinder-api-documentation | API endpoints (outdated but structural reference) |

## Architecture Patterns

### DOM Selector Strategy
Tinder uses React with hashed CSS modules — class names change every deploy. Use this priority:

1. **aria-label** (most stable): `button[aria-label="Like"]`, `button[aria-label="Nope"]`
2. **data-testid** (semi-stable): `[data-testid="gamepad-like"]`, `[data-testid="gamepad-nope"]`
3. **Structural/semantic** (fallback): parent-child relationships, nth-child
4. **Class names** (last resort, fragile): `[class*="recsCardboard"]`

### Tinder Web App URLs
- Swipe deck: `https://tinder.com/app/recs`
- Matches: `https://tinder.com/app/matches`
- Messages: `https://tinder.com/app/messages`
- Profile: `https://tinder.com/app/profile`

### Swipe Session Flow
```
1. Navigate to tinder.com/app/recs
2. Dismiss popups (notifications, upsells, cookie consent)
3. Wait for card to load
4. Read basic profile (name, age)
5. Decide like/pass (ratio-based)
6. Click button with human-like movement
7. Handle "It's a Match!" popup if appears
8. Check for like limit / CAPTCHA
9. Variable delay (2-8s)
10. Repeat
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tinder API client | Direct API calls | Browser automation | API now uses protobuf + Arkose CAPTCHA, old libraries (pynder) broken |
| Photo scoring ML | Train CNN model | Simple like_ratio randomization | Over-engineering for MVP; Phase 17 adds AI coaching |
| CAPTCHA solving | Automated solver | Manual solve (pause + notify) | Arkose Labs CAPTCHA is extremely difficult to solve programmatically |

## Common Pitfalls

### Pitfall 1: Shadowban from High Like Ratio
**What goes wrong:** Swiping right >70% triggers Tinder's shadowban — profile becomes invisible to others
**Why it happens:** Tinder's algorithm flags indiscriminate swiping as bot behavior
**How to avoid:** Default like_ratio 0.4-0.5, never exceed 0.6, add variation
**Warning signs:** Zero matches after 50+ swipes, same profiles repeating, empty "Likes You" tab (Gold users)
**Recovery:** Stop all activity 14-28 days, account may recover. Severe cases require new account.

### Pitfall 2: Fixed Swipe Timing
**What goes wrong:** Identical delays between swipes (e.g., always 2.0s) detected as bot
**Why it happens:** Tinder monitors timing patterns — human timing has high variance
**How to avoid:** Gaussian distribution delays, mean 4s stddev 1.5s, periodic long pauses (15-45s)
**Warning signs:** CAPTCHA triggered mid-session, account flagged

### Pitfall 3: Like Limit Modal Ignored
**What goes wrong:** Automation keeps clicking after "out of likes" modal appears, Tinder sees impossible actions
**Why it happens:** Modal detection not implemented, clicks go to wrong elements
**How to avoid:** Always check for like limit modal before each swipe, stop session gracefully
**Warning signs:** Error rate spikes, session produces zero valid swipes

### Pitfall 4: React Class Name Selectors
**What goes wrong:** Selectors using CSS class names (`[class*="recsCardboard"]`) break on every Tinder deploy
**Why it happens:** React build process generates new hash-based class names each deployment
**How to avoid:** Prefer aria-label and data-testid selectors; have a selector health-check command
**Warning signs:** All selectors fail simultaneously after an app update

### Pitfall 5: Match Popup Blocking Swipes
**What goes wrong:** "It's a Match!" overlay appears but isn't dismissed, blocking further swipe actions
**Why it happens:** Match detection/dismissal logic missing or selector outdated
**How to avoid:** After every like, check for match popup with 2s timeout, dismiss if found
**Warning signs:** Session freezes after first match

## Code Examples

### Tinder Selector Constants (MEDIUM confidence — based on TinderBotz patterns)
```python
SELECTORS = {
    "like_button": 'button[aria-label="Like"]',
    "nope_button": 'button[aria-label="Nope"]',
    "super_like_button": 'button[aria-label="Super Like"]',
    "card_container": '[class*="recsCardboard"], [data-testid="gamepad"]',
    "profile_name": '[itemprop="name"]',
    "match_popup": '[class*="matchAnimation"], [aria-label*="match"]',
    "keep_swiping": '[aria-label*="Keep Swiping"], [aria-label*="Back to Tinder"]',
    "like_limit_modal": '[class*="paywall"], [aria-label*="Get Tinder"]',
    "captcha_frame": 'iframe[src*="funcaptcha"], iframe[src*="arkose"]',
    "message_input": 'textarea[placeholder*="message"], [data-testid="chat-input"]',
}
```

### Conservative Swipe Timing (HIGH confidence)
```python
import random, asyncio

async def swipe_delay():
    """Variable delay between swipes — gaussian distribution."""
    base = random.gauss(4.0, 1.5)  # mean 4s, stddev 1.5s
    delay = max(2.0, min(8.0, base))  # clamp to 2-8s range
    await asyncio.sleep(delay)

async def profile_reading_pause():
    """Longer pause to simulate reading a profile thoroughly."""
    await asyncio.sleep(random.uniform(15, 45))
```

## Tinder Rate Limits

| Tier | Likes per Cycle | Cycle Length | Notes |
|------|----------------|--------------|-------|
| Free | ~50 | 12 hours | Varies by gender/age/location |
| Plus | Unlimited | N/A | But algorithm still penalizes rapid swiping |
| Gold | Unlimited | N/A | See who likes you, 5 Super Likes/day |
| Platinum | Unlimited | N/A | Priority likes, message before matching |

**Key detail:** Like limit resets 12 hours after your first swipe of a cycle, NOT at a fixed time.

## Tinder Anti-Bot Detection Methods

1. **Arkose Labs CAPTCHA** — triggered by suspicious behavior, requires manual solve
2. **Behavioral analysis** — swipe timing, mouse movement patterns, session duration
3. **Swipe ratio monitoring** — >70% right swipes = potential shadowban
4. **API pattern detection** — monitoring for unofficial API clients (not relevant for browser automation)
5. **Account age vs activity** — new accounts swiping aggressively flagged faster
6. **Device/browser fingerprinting** — looking for automation artifacts

## Open Questions

1. **Exact aria-label values** — need to verify current selector text on live tinder.com (changes periodically)
   - Recommendation: Build a selector health-check that validates selectors against live app

2. **Arkose CAPTCHA trigger conditions** — unclear exactly what triggers it
   - Recommendation: Assume it will appear; build robust pause-and-notify mechanism

3. **Photo scoring value** — unclear if basic photo heuristics (face detection, quality) improve match rates enough to justify the complexity
   - Recommendation: Skip for MVP, use random ratio-based swiping

## Sources

### Primary (HIGH confidence)
- Tinder shadowban guides (matchphotos.io, tinderprofile.ai) — swipe limits, detection, recovery
- Tinder like limit technical guide (bestapppicks.com) — limit mechanics, cycle timing
- ByteBytego architecture analysis — Tinder API gateway handling

### Secondary (MEDIUM confidence)
- TinderBotz GitHub (frederikme) — Selenium-based patterns, DOM selector approach
- Tinder API documentation gist (rtt) — historical API endpoints (mostly outdated)
- tinder-bot GitHub (lhandal) — deep learning swipe model approach

### Tertiary (LOW confidence)
- Various auto-swipe Greasemonkey scripts — DOM selector patterns (may be outdated)

## Metadata

**Confidence breakdown:**
- Swipe limits/shadowban: HIGH — multiple consistent sources confirm 50/12h, 70% threshold
- DOM selectors: LOW — selectors change frequently, need live verification
- Anti-detection methods: MEDIUM — general patterns documented, Tinder-specific details sparse
- API approach: HIGH (that it's dead) — protobuf + Arkose confirmed by multiple sources

**Research date:** 2026-03-01
**Valid until:** 2026-03-15 (selectors change frequently)
