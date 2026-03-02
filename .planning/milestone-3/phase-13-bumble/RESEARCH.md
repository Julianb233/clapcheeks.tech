# Phase 13: Bumble Automation — Research

**Researched:** 2026-03-01
**Domain:** Bumble web app (bumble.com) browser automation
**Confidence:** MEDIUM

## Summary

Bumble has a web app at bumble.com, but **it is being discontinued** — Bumble has announced the web version will be shut down, redirecting users to download the mobile app. This is the single most important finding for this phase.

While the web app is still live, automation via Playwright is feasible. Bumble uses `data-qa-role` attributes extensively for testing (more stable than class names). The internal API (especially `SERVER_GET_ENCOUNTERS`) can be intercepted via Playwright's network layer for richer data than DOM scraping.

Bumble's unique "women message first" rule (for heterosexual matches) and 24-hour match expiry create specific automation requirements not found in Tinder or Hinge.

**Primary recommendation:** Build web automation now while the web app exists, but design the abstraction so the platform client can be swapped to an API-interception or mobile-based approach when the web shuts down. Use `data-qa-role` selectors as primary, and intercept `SERVER_GET_ENCOUNTERS` for profile data.

## CRITICAL: Bumble Web Discontinuation

**Source:** Bumble Support (support.bumble.com/hc/en-us/articles/30996192802973)

"Bumble web (the web version of Bumble) will be discontinued soon. When this happens, you'll see a prompt to download the Bumble app instead of signing in on the web."

**Impact on this phase:**
- Web automation has a limited lifespan (months, not years)
- Must plan for mobile fallback (ADB, API interception, or screen mirroring)
- API interception approach is more future-proof than DOM automation
- Consider deprioritizing Bumble web relative to Tinder (which has a stable web app)

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| playwright | >=1.44 | Browser automation | Already in stack |
| playwright-stealth | 2.0.2 | Anti-detection | Bumble has improved bot detection |

### Reference Projects
| Project | URL | Relevance |
|---------|-----|-----------|
| bumble-auto-liker | github.com/amitoj-singh/bumble-auto-liker | DOM selectors, encounters-action classes |
| bumble-like-revealer | github.com/Stupidoodle/bumble-like-revealer | API interception (SERVER_GET_ENCOUNTERS) |
| autoswipe (mmuyskens) | github.com/mmuyskens/autoswipe | Multi-platform auto swipe |

## Architecture Patterns

### DOM Selectors (from bumble-auto-liker)
Known working selectors (may change):
- **Like button:** `.encounters-action--like` or `[data-qa-role="encounters-action-like"]`
- **Pass button:** `.encounters-action--dislike` or `[data-qa-role="encounters-action-dislike"]`
- **SuperSwipe:** `.encounters-action--superswipe`
- **Card container:** `[data-qa-role="encounters-card"]` or `.encounters-story-profile`
- **Match popup:** `.encounters-match` or `[data-qa-role="match-popup"]`
- **Continue bumbling:** match popup dismiss button
- **Chat list:** `[data-qa-role="chat-list"]`
- **Message input:** `[data-qa-role="messenger-input"]` or `textarea.messenger-input`
- **Send button:** `[data-qa-role="messenger-send"]`

**Selector strategy:** Bumble uses `data-qa-role` extensively — prefer these over class names.

### API Interception Approach
Bumble's web app makes API calls that can be intercepted:

```python
# Intercept Bumble API responses
async def setup_interception(page):
    async def handle_response(response):
        if "SERVER_GET_ENCOUNTERS" in response.url:
            data = await response.json()
            # Process encounter/profile data
    page.on("response", handle_response)
```

This gives structured profile data (name, age, bio, photos, distance) without fragile DOM scraping.

### Bumble URLs
- Main app: `https://bumble.com/app`
- Connections/matches: `https://bumble.com/app/connections`
- Conversations: `https://bumble.com/app/conversations`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Profile data extraction | DOM scraping each field | API interception (SERVER_GET_ENCOUNTERS) | More reliable, structured data, survives DOM changes |
| Match expiry tracking | Manual timer | Parse expiry indicator from DOM/API | Built into Bumble's UI |
| First-message detection | Complex DOM analysis | Check message input state (locked/unlocked) | Bumble disables input when it's not your turn |

## Common Pitfalls

### Pitfall 1: Bumble Web Shutdown
**What goes wrong:** Web app redirects to "download the app" page, all automation breaks
**Why it happens:** Bumble is actively discontinuing the web version
**How to avoid:** Monitor for redirect, have mobile fallback plan ready
**Warning signs:** Bumble support page already announces it; could happen any time

### Pitfall 2: Improved Bot Detection
**What goes wrong:** Bumble recently upgraded detection specifically for Chromium automation
**Why it happens:** Bumble explicitly improved their bot detection systems
**How to avoid:** Use real Chrome via CDP (Phase 11), not Playwright-managed Chromium
**Warning signs:** Account flagged immediately on Playwright Chromium, works fine on real Chrome

### Pitfall 3: Ignoring Match Expiry
**What goes wrong:** Matches expire after 24 hours without a first message, losing potential connections
**Why it happens:** Automation handles swiping but not match maintenance
**How to avoid:** Run a match-maintenance check on every session (check for expiring matches, extend or message)
**Warning signs:** Matches disappearing, users complaining about lost matches

### Pitfall 4: Mishandling "Women Message First"
**What goes wrong:** Automation tries to send first message to a match where the user can't (male user in hetero match)
**Why it happens:** Not detecting whose turn it is
**How to avoid:** Check if message input is enabled/disabled, or detect "Their turn" indicator
**Warning signs:** Automation errors on message send, wasted effort

## Bumble-Specific Constraints

### Rate Limits
- Free tier: ~25-50 swipes/day (varies, not officially documented)
- Bumble Boost: unlimited swipes
- Bumble Premium: unlimited swipes + Backtrack + see likes

### Match Mechanics
- **24-hour expiry:** Matches expire if no first message within 24h
- **Extend:** Can extend a match by 24h (limited uses per day)
- **Women message first** (hetero): Women MUST send first message
- **Same-sex matches:** Either party can message first
- **BFF/Bizz modes:** Different rules, not relevant for dating automation

### Anti-Bot Measures
- Recently improved detection for Chromium-based automation
- WebSocket connections for real-time updates
- Custom web framework (not standard React like Tinder)

## Open Questions

1. **Exact discontinuation timeline for Bumble web**
   - What we know: It's announced as "coming soon"
   - What's unclear: Exact date
   - Recommendation: Build it, but don't over-invest; keep abstraction clean for swap

2. **API interception reliability**
   - What we know: SERVER_GET_ENCOUNTERS is a real endpoint that returns profile data
   - What's unclear: Whether API responses contain all needed data (match status, expiry)
   - Recommendation: Test interception alongside DOM approach, use whichever is more reliable

3. **Free tier swipe limit**
   - What we know: There is a daily limit, roughly 25-50
   - What's unclear: Exact number, whether it varies
   - Recommendation: Start conservative (25), detect limit modal, adjust

## Sources

### Primary (HIGH confidence)
- Bumble Support article on web discontinuation — official announcement
- bumble-auto-liker GitHub — DOM selectors, encounters-action classes

### Secondary (MEDIUM confidence)
- bumble-like-revealer GitHub — API interception approach (SERVER_GET_ENCOUNTERS)
- Axiom.ai Bumble automation — general web automation patterns

### Tertiary (LOW confidence)
- Chrome extension auto-swipers — selector patterns (may be outdated)

## Metadata

**Confidence breakdown:**
- Web discontinuation: HIGH — official Bumble support announcement
- DOM selectors: MEDIUM — from open-source projects, but Bumble changes UI frequently
- API interception: MEDIUM — proven in open-source projects, but may change
- Rate limits: LOW — not officially documented, varies

**Research date:** 2026-03-01
**Valid until:** 2026-03-15 (web may be discontinued any time)
