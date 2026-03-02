# Phase 11: Playwright Setup — Research

**Researched:** 2026-03-01
**Domain:** Browser automation anti-detection (Playwright Python)
**Confidence:** HIGH

## Summary

Playwright Python is the correct choice for this codebase (already a dependency). The existing `browser/` module has a solid foundation but needs hardening with dedicated stealth libraries and human-like behavior simulation. The biggest finding is that **connecting to an existing Chrome session via CDP** is far more effective for anti-detection than launching a fresh Playwright-managed browser.

Three key libraries fill the gaps: `playwright-stealth` (2.0.2, Feb 2026) for core anti-detection patches, `humanization-playwright` for Bezier-curve mouse movements, and `emunium` for realistic typing patterns. All are Python-native and actively maintained.

**Primary recommendation:** Use `connect_over_cdp()` to attach to the user's real Chrome browser for dating apps. Fall back to Playwright-managed Chromium with stealth patches only when CDP is unavailable.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| playwright | >=1.44 | Browser automation | Already in requirements.txt, async Python API |
| playwright-stealth | 2.0.2 | Anti-detection patches | Port of puppeteer-stealth, actively maintained (Feb 2026 release) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| humanization-playwright | >=0.1 | Bezier mouse movements, variable delays | Every swipe/click action |
| emunium | latest | Human-like typing, mouse, scrolling | Message typing, search input |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| playwright-stealth | Custom init scripts | Lower maintenance but misses evolving detection |
| humanization-playwright | Manual Bezier curves | More control but significant implementation effort |
| Playwright Chromium | SeleniumBase stealth mode | Better stealth but different framework, Python compat uncertain |

**Installation:**
```bash
pip install playwright-stealth>=2.0 humanization-playwright emunium
```

## Architecture Patterns

### Recommended Approach: CDP Connection to Real Chrome

Instead of launching a fresh Playwright browser (which has detectable characteristics), connect to the user's existing Chrome:

```python
# User launches Chrome with: chrome --remote-debugging-port=9222
browser = await playwright.chromium.connect_over_cdp("http://localhost:9222")
```

**Why this is critical:**
- Real Chrome has authentic TLS fingerprint (Playwright's Chromium has a different one)
- Real Chrome has extensions, history, cookies — looks like a real user
- Avoids the "fresh browser profile" detection signal
- CDP connection preserves the user's logged-in dating app sessions

**Fallback:** Launch Playwright-managed Chromium with full stealth stack.

### Anti-Detection Layer Stack
```
Layer 1: Real Chrome via CDP (eliminates TLS/fingerprint issues)
Layer 2: playwright-stealth patches (navigator.webdriver, chrome.runtime, plugins)
Layer 3: Custom init scripts (WebGL renderer, Notification.permission, etc.)
Layer 4: Correlated fingerprints (viewport matches UA matches platform)
Layer 5: Human-like behavior (Bezier mouse, variable typing, realistic delays)
Layer 6: Session persistence (same fingerprint per platform across visits)
```

### Project Structure
```
agent/clapcheeks/browser/
├── __init__.py           # Existing
├── driver.py             # Existing — extend with CDP + stealth library
├── stealth.py            # Existing — integrate playwright-stealth
├── session.py            # Existing — upgrade to storage_state
├── humanize.py           # NEW — mouse/typing/delay simulation
└── fingerprint.py        # NEW — correlated viewport/UA/timezone profiles
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WebDriver detection bypass | Custom navigator overrides | playwright-stealth | Covers 20+ detection vectors, community-maintained |
| Human mouse movement | Linear interpolation | humanization-playwright | Bezier curves with jitter, pause, overshoot |
| Realistic typing | Fixed-delay type() | emunium | Variable inter-key delay, occasional typos, realistic patterns |
| Browser fingerprinting | Random values | Correlated fingerprint profiles | Random values contradict each other (e.g., mobile UA + desktop viewport) |

**Key insight:** The existing `STEALTH_INIT_SCRIPT` in stealth.py covers ~3 detection vectors. playwright-stealth covers 20+. Dating apps use sophisticated detection — the hand-rolled approach is insufficient.

## Common Pitfalls

### Pitfall 1: CDP Protocol Detection
**What goes wrong:** Anti-bot systems can detect that a browser is controlled via CDP by checking for CDP artifacts (Runtime.enable, etc.)
**Why it happens:** CDP leaves traces that distinguish automated from manual browsing
**How to avoid:** Use real Chrome (not Playwright Chromium) via CDP. The detection challenge is harder when the browser itself is genuine.
**Warning signs:** Immediate CAPTCHA on page load, account flagged within minutes

### Pitfall 2: Fingerprint Contradictions
**What goes wrong:** Setting a mobile user-agent but having a desktop viewport (1920x1080), or claiming MacIntel platform with a Linux TLS fingerprint
**Why it happens:** Each anti-detection setting is configured independently without checking consistency
**How to avoid:** Use pre-built correlated fingerprint profiles where viewport, UA, platform, timezone, and locale are all consistent
**Warning signs:** Fingerprinting sites like bot.sannysoft.com showing red flags

### Pitfall 3: Headless Mode
**What goes wrong:** Running headless for dating apps triggers immediate detection
**Why it happens:** Headless Chromium has many detectable differences (rendering, APIs, behavior)
**How to avoid:** Always run headed for dating app automation. Headless is only acceptable for testing.
**Warning signs:** Works in development but fails immediately in production

### Pitfall 4: Uniform Timing
**What goes wrong:** Using `time.sleep(2.0)` between every action creates a perfectly regular pattern
**Why it happens:** Developers use fixed delays for simplicity
**How to avoid:** Use gaussian-distributed delays with jitter. Mean 4s, stddev 1.5s. Add occasional long pauses (15-45s) to simulate profile reading.
**Warning signs:** Behavioral analysis flags account after first session

### Pitfall 5: Storage State vs Cookies Only
**What goes wrong:** Saving only cookies loses localStorage tokens, causing re-authentication
**Why it happens:** Dating apps store session tokens in localStorage, not just cookies
**How to avoid:** Use Playwright's `context.storage_state()` which captures cookies AND localStorage
**Warning signs:** User has to re-login every session despite "saving" the session

## Code Examples

### Connecting to existing Chrome via CDP (HIGH confidence)
```python
# Source: Playwright docs - BrowserType.connect_over_cdp
from playwright.async_api import async_playwright

async def connect_to_chrome():
    pw = await async_playwright().start()
    browser = await pw.chromium.connect_over_cdp("http://localhost:9222")
    context = browser.contexts[0]  # Use existing context
    page = context.pages[0] if context.pages else await context.new_page()
    return page
```

### Using playwright-stealth (HIGH confidence)
```python
# Source: PyPI playwright-stealth 2.0.2
from playwright.async_api import async_playwright
from playwright_stealth import stealth_async

async def launch_stealthy():
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False)
    page = await browser.new_page()
    await stealth_async(page)
    return page
```

### Human-like mouse movement pattern (MEDIUM confidence)
```python
# Source: humanization-playwright PyPI
# Bezier-curve movement with jitter
import random, asyncio

async def human_move_to(page, selector):
    element = page.locator(selector)
    box = await element.bounding_box()
    if not box:
        await element.click()
        return
    target_x = box["x"] + box["width"] / 2 + random.uniform(-3, 3)
    target_y = box["y"] + box["height"] / 2 + random.uniform(-3, 3)
    # Move in steps with curve
    steps = random.randint(8, 15)
    for i in range(steps):
        t = (i + 1) / steps
        x = target_x * t + random.uniform(-2, 2)
        y = target_y * t + random.uniform(-2, 2)
        await page.mouse.move(x, y)
        await asyncio.sleep(random.uniform(0.01, 0.04))
    await element.click()
```

### Full storage state persistence (HIGH confidence)
```python
# Source: Playwright docs - BrowserContext.storage_state
# Save
state = await context.storage_state(path="~/.clapcheeks/sessions/tinder.json")
# Load
context = await browser.new_context(storage_state="~/.clapcheeks/sessions/tinder.json")
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| puppeteer-extra-stealth (JS) | playwright-stealth 2.0 (Python) | 2025 | Native Python stealth, no JS bridge needed |
| Cookie-only persistence | Full storage_state (cookies+localStorage) | Playwright 1.x | Preserves all session data including tokens |
| Random viewport+UA | Correlated fingerprint profiles | 2024-2025 | Prevents contradictory fingerprints |
| Fixed sleep delays | Gaussian + Bezier movement libraries | 2025 | Much harder for behavioral analysis to detect |
| Launch fresh browser | CDP to existing Chrome | 2024-2025 | Authentic TLS fingerprint, real extensions |

## Open Questions

1. **CDP detection evasion completeness**
   - What we know: CDP leaves traces that some anti-bot systems detect
   - What's unclear: Exact detection vectors for dating apps specifically (Tinder vs Bumble vs Hinge)
   - Recommendation: Test with bot.sannysoft.com and creepjs.com before targeting dating apps

2. **playwright-stealth coverage for dating apps**
   - What we know: Handles "simplest bot detection" per maintainer's own docs
   - What's unclear: Whether it's sufficient for Tinder's Arkose Labs or Bumble's improved detection
   - Recommendation: Layer multiple defenses, don't rely on stealth alone

## Sources

### Primary (HIGH confidence)
- PyPI playwright-stealth 2.0.2 — installation, API, usage patterns
- Playwright docs — connect_over_cdp, storage_state, context creation
- PyPI humanization-playwright — Bezier mouse movement, delay patterns

### Secondary (MEDIUM confidence)
- BrowserStack guide on Playwright CDP connection — use cases and patterns
- Scrapeless/BrightData/ZenRows blogs — stealth limitations, layered defense
- SeleniumBase stealthy Playwright mode — CDP connection approach

### Tertiary (LOW confidence)
- Medium articles on mouse movement anti-detection — general patterns
- GitHub issues on CDP detection (microsoft/playwright#30074) — ongoing discussion

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — libraries verified on PyPI with recent releases
- Architecture (CDP approach): MEDIUM — well-documented but dating-app-specific testing needed
- Anti-detection layers: MEDIUM — industry patterns, not dating-app validated
- Pitfalls: HIGH — well-documented across multiple sources

**Research date:** 2026-03-01
**Valid until:** 2026-04-01 (stealth libraries evolve rapidly)
