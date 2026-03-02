# Clap Cheeks — SaaS Onboarding Research

**Researched:** 2026-03-01
**Domain:** SaaS CLI onboarding, browser automation, subscription auth, activation patterns
**Confidence:** HIGH (stack), MEDIUM (benchmarks), HIGH (browser tech)

---

## Summary

Clap Cheeks has a payment-to-swipe gap that currently spans 6 manual steps over an estimated 10-15 minutes. The research establishes that world-class developer tool onboarding (Linear, Stripe CLI, Vercel CLI, Raycast) achieves first value in under 2 minutes through three core techniques: OAuth Device Flow for frictionless auth, smart defaults that require zero configuration, and eliminating the custom Chromium download by using the user's existing system Chrome.

The single highest-impact change is replacing steps 3 and 4 (wizard + 100MB Chromium download) with system Chrome via Playwright's `channel="chrome"` parameter. Combined with a Device Flow auth that mirrors Stripe CLI's pattern, the onboarding path shrinks to: install → auto-open browser for subscription verification → automated first swipe session.

**Primary recommendation:** Use `playwright.chromium.launch(channel="chrome")` to eliminate the Chromium download entirely, implement Stripe CLI-style device flow for subscription auth, and ship opinionated smart defaults so `clapcheeks swipe` runs immediately after install with zero wizard steps.

---

## Research Findings by Question

### 1. Zero-Friction Day-1 Activation

**Confidence: HIGH** — Multiple authoritative sources cross-referenced.

The benchmark target for developer/power-user tools is **under 2 minutes to first perceived value**. The following patterns from production tools define the standard:

**Linear (project management):**
- No role selection, no permissions setup, no workflow configuration during install
- Pre-populates workspace with perfect demo data — users see the ideal state immediately
- One input per screen, never shows an empty/blank state
- Philosophy: "By the time you've configured Jira, Linear users have already shipped code"
- Users learn by doing, not by reading

**Stripe CLI (`stripe login`):**
- Custom device flow: CLI displays a pairing code, opens browser, polls server every 1 second
- No OAuth complexity exposed to user — just "press Enter, confirm in browser"
- Token stored at `~/.config/stripe/config.toml` with 90-day expiry
- From `stripe login` to usable CLI: under 60 seconds

**Vercel CLI (`vercel login`):**
- OAuth 2.0 Device Flow (industry standard as of 2025, deprecated email-based login)
- Browser opens automatically, user confirms, token written to local config
- From login to first deploy: under 2 minutes

**Raycast (macOS launcher):**
- First value moment is the command menu interaction — demonstrated at install, before permissions
- Establishes core value before requesting system access
- Progressive disclosure: features introduced gradually, never all at once
- Optional elements (newsletter, analytics) are never blockers

**DevTools startup (S21 YC) case study:**
- Abandoned 6-step product tour entirely
- Replaced with one copy-paste CLI command
- Result: 33% increase in activation rate

**Key insight for Clap Cheeks:** Every step between payment and first swipe is a drop-off point. The wizard (`clapcheeks setup`) and browser install (`clapcheeks browser install`) are both blocking steps that deliver zero value. They must be collapsed into defaults or eliminated.

---

### 2. No-Signup Local Trial

**Confidence: MEDIUM** — Conversion data is industry-wide, not developer-tool-specific.

**Conversion benchmarks (2024-2025, First Page Sage, Userpilot):**

| Model | Trial-to-Paid Conversion |
|-------|--------------------------|
| Opt-in trial (no credit card) | 18.2% |
| Opt-out trial (credit card upfront) | 48.8% |
| Freemium (free tier forever) | 2.6% |

**For Clap Cheeks specifically — recommendation is against a no-signup trial.**

Reasons:
1. Clap Cheeks requires the user's dating app session to deliver any value. Without credentials in the app, a "trial" would show a demo with fake data — which does not demonstrate the actual product.
2. Clap Cheeks is already post-payment (subscriber). The friction problem is in the post-payment activation flow, not in converting visitors to trials.
3. The install script (`curl | bash`) is already the commitment signal. A user who runs that script has high intent.

**If a trial is desired later:**
- Offer a 7-day opt-out trial with credit card at signup (converts at ~3x the rate of opt-in)
- The "trial" value should be showing the swipe UI running against real dating app sessions with rate limits, not fake data

**Recommendation:** Do not build a no-signup trial mode. Invest that engineering effort into compressing the post-payment activation time instead.

---

### 3. Progress-Based Onboarding

**Confidence: HIGH** — Well-documented SaaS pattern with clear implementation guidance.

**The Zeigarnik Effect Pattern:**
Users are motivated to complete tasks they have already started. Start the progress indicator at 20-25% complete, not 0%.

**Standard implementation:**
- 3-5 step checklist maximum (not 6 as currently exists)
- Start at 20% to trigger completion motivation
- Action-oriented language: "You're 1 step from your first swipe" vs "Step 3 of 6"
- Micro-animations on step completion
- Embed the checklist in the CLI output itself (colored terminal progress)

**Recommended checklist for Clap Cheeks (post-payment):**

```
[===========___] 60% — Almost there

  [x] Subscription verified
  [x] Tool installed
  [ ] Connect dating apps (1 step)
  [ ] Run your first swipe session

  > clapcheeks connect tinder
```

**Key metric:** Industry average onboarding checklist completion is 19.2% (median 10.1%). Tools with 3-step checklists significantly outperform 6-step checklists. Collapsing the current 6 steps to 3 is the single highest-ROI onboarding change.

---

### 4. Browser Session Takeover — Technical Feasibility

**Confidence: HIGH** — Verified directly against official Playwright documentation.

**Option A: Use system Chrome via channel parameter (RECOMMENDED)**

```python
# Source: playwright.dev/python/docs/browsers
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")  # Uses installed Chrome, NOT bundled Chromium
    context = browser.new_context()
    page = context.new_page()
```

This completely eliminates the 100MB Chromium download. Requires Chrome to be installed (it is on ~95% of Mac users). Does NOT reuse existing sessions.

**Option B: Connect to running Chrome via CDP (ADVANCED)**

```python
# Source: playwright.dev/python/docs/api/class-browsertype
# Launch Chrome manually first with:
# /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=/tmp/clapcheeks

browser = playwright.chromium.connect_over_cdp('http://localhost:9222')
context = browser.contexts[0]  # Reuses existing logged-in sessions
```

**Critical limitations (verified from Playwright official docs):**

| Issue | Detail |
|-------|--------|
| Profile lock | Cannot use `user_data_dir` pointing to Chrome's main "User Data" directory — Chrome locks it |
| Single instance | Multiple browsers cannot share one `user_data_dir` simultaneously |
| Not default Chrome | Automating the default Chrome profile is explicitly unsupported by Playwright |
| CDP fidelity | `connect_over_cdp` is "significantly lower fidelity than Playwright protocol connection" |
| Version mismatch | Browser version must be >= version that created the user_data_dir |

**Recommended approach for Clap Cheeks:**

Do NOT try to reuse the user's existing logged-in Chrome sessions. Instead:

1. Use `channel="chrome"` to skip Chromium download
2. Launch a separate `user_data_dir` (e.g., `~/.clapcheeks/browser-profile/`)
3. On first run, open dating apps in this dedicated profile and prompt user to log in once
4. Persist the profile — subsequent runs reuse sessions from the dedicated profile
5. The user logs in manually once per app, never again

This is the pattern used by Browser Use, Playwright MCP, and most production automation tools. It is stable, supportable, and avoids the Chrome lock issue entirely.

**The key insight for removing step 6 friction:**
- Current flow: user logs into dating apps every time
- Recommended: Playwright persists sessions in `~/.clapcheeks/browser-profile/`. Login happens once at setup, stored encrypted in the profile directory. Subsequent `clapcheeks swipe` runs require no login.

---

### 5. Smart Defaults

**Confidence: MEDIUM** — Informed by automation detection research and industry patterns. Dating app specifics are LOW confidence (limited verifiable data).

**Automation detection risks (verified):**
- Running automation all day triggers bot detection on Tinder, Bumble, Hinge
- Recommended session window: 20-60 minutes during peak hours
- Match Group is actively improving ML-based bot detection as of 2024

**Recommended defaults:**

```python
# ~/.clapcheeks/config.toml — shipped defaults
[defaults]
platforms = ["tinder", "bumble"]   # Hinge optional — lower swipe volume
like_ratio = 0.65                  # Like 65% — avoids right-swipe-all detection
swipes_per_session = 50            # Conservative — Tinder daily limit is ~100
session_start_time = "18:00"       # Peak match hour (commute home)
session_duration_minutes = 30      # Safe detection window
human_delay_min_ms = 800           # Humanize timing
human_delay_max_ms = 2400          # Humanize timing
headless = true                    # No visible browser window
```

**Rationale for defaults:**
- 65% like ratio avoids "liking everything" pattern which triggers Tinder's "bot" heuristics
- 50 swipes per session is under the Tinder daily limit, avoids throttling
- 18:00 local time maximizes match probability (users are active after work)
- Human timing delays (800-2400ms) reduce behavioral fingerprinting risk

**Do not ask users to configure these on first run.** Ship the defaults. Let users override via `clapcheeks config set like_ratio 0.8` after they've seen results.

---

### 6. SaaS Onboarding Metrics — Benchmarks

**Confidence: MEDIUM** — General SaaS data; developer tool segment not isolated.

| Metric | Industry Average | Top Quartile | Clap Cheeks Target |
|--------|-----------------|--------------|-------------------|
| Activation rate | 37.5% | ~54% (AI/ML) | 60%+ (CLI install = high intent) |
| Time to first value | 1 day 12 hrs | Under 2 min (top tools) | Under 3 minutes |
| Onboarding checklist completion | 19.2% | ~40%+ | 70%+ (3 steps only) |

**Why Clap Cheeks should expect better-than-average activation:**
- Install via `curl | bash` self-selects technical users with high intent
- Post-payment means they've already committed financially
- The product has a visceral first value (seeing swipes happen automatically) that most SaaS lacks

**Target metric: Time from payment confirmation email to first swipe < 3 minutes.**

If this takes longer, measure and attribute drop-off to specific steps. The Chromium download (step 4) alone can be 2-5 minutes on a slow connection — that single step likely kills a significant percentage of activations.

---

### 7. Subscription + CLI Auth Pattern

**Confidence: HIGH** — Verified against Stripe CLI, GitHub Copilot CLI, and Vercel CLI.

**The industry standard pattern (2025):**

```
User runs: clapcheeks login
  → CLI generates a 6-character pairing code
  → CLI opens https://clapcheeks.tech/cli-auth?device=ABC123 in browser
  → CLI polls backend every 2 seconds for confirmation
  → User is already logged in to clapcheeks.tech (they just paid)
  → User clicks "Authorize CLI" button in browser
  → Backend marks device token as active
  → CLI polling receives token, writes to local keychain
  → CLI prints: "Authorized. Welcome back, [name]."
```

**Token storage — use OS keychain via Python `keyring` library:**

```python
# Source: pypi.org/project/keyring
import keyring

# Write token after device flow completes
keyring.set_password("clapcheeks", "api_token", token)

# Read token on each CLI invocation
token = keyring.get_password("clapcheeks", "api_token")
```

The `keyring` library maps to macOS Keychain on Mac, Windows Credential Locker on Windows, and GNOME Keyring on Linux. Credentials are encrypted at rest and managed by the OS.

**Fallback:** If keyring is unavailable, write to `~/.clapcheeks/config.toml` with a clear warning. Follow the Stripe CLI pattern.

**Token characteristics:**
- Token is tied to the user's subscription status
- Validate subscription on each `clapcheeks swipe` invocation (lightweight API call)
- Token expiry: 90 days (follow Stripe CLI pattern)
- Refresh via re-running `clapcheeks login`

**What NOT to build:**
- Do not build OAuth with PKCE for this use case — it is overkill for a direct SaaS subscription
- Do not expose client secrets in the CLI binary
- Do not store tokens in plaintext without at least attempting keychain storage first

---

### 8. Eliminating the Chromium Download

**Confidence: HIGH** — Verified directly against official Playwright documentation.

**The solution is one line of code:**

```python
# BEFORE (downloads ~100MB Chromium)
browser = p.chromium.launch()

# AFTER (uses user's existing Chrome installation, 0MB download)
browser = p.chromium.launch(channel="chrome")
```

**Prerequisites:**
- Chrome must be installed on the user's Mac
- Chrome is pre-installed or commonly installed on ~95%+ of Mac users
- If Chrome is not found, fall back to: offer to install it, or use `channel="msedge"` if Edge is present

**Detection logic:**

```python
import shutil

def get_browser_channel():
    """Return the best available browser channel."""
    # Check for system Chrome first
    chrome_path = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if shutil.os.path.exists(chrome_path):
        return "chrome"
    # Check for Edge
    edge_path = "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
    if shutil.os.path.exists(edge_path):
        return "msedge"
    # Fall back to bundled Chromium (triggers download)
    return None  # None = default Playwright Chromium
```

**Limitations:**
- Chrome enterprise policies may restrict Playwright control (rare for individual users)
- Behavioral differences between system Chrome headless and Playwright's headless shell
- When `channel="chrome"` is used with a separate `user_data_dir`, Chrome will not reuse the user's existing logged-in sessions — this is intentional and correct

**Migration path:**
- `clapcheeks browser install` step is eliminated from onboarding entirely
- First `clapcheeks connect` opens system Chrome with a dedicated profile (`~/.clapcheeks/browser-profile/`)
- If Chrome is not found: print a clear error with download link and instructions

---

## Architecture Patterns

### Recommended CLI Structure

```
~/.clapcheeks/
├── config.toml          # User preferences (overrides), not secrets
├── browser-profile/     # Persistent Playwright user_data_dir
│   └── (Chrome profile data — sessions, cookies)
└── logs/
    └── swipe-YYYY-MM-DD.log
```

Token in macOS Keychain (service: `clapcheeks`, account: `api_token`).

### First-Run Flow (Code-Level Pattern)

```python
def first_run_setup():
    """Runs once after install. No wizard, no questions."""

    # 1. Check for subscription token
    token = keyring.get_password("clapcheeks", "api_token")
    if not token:
        run_device_flow_login()  # Opens browser, polls, stores token

    # 2. Validate subscription is active
    validate_subscription(token)  # Raises if expired/unpaid

    # 3. Check for system Chrome
    channel = get_browser_channel()

    # 4. Create browser profile dir if needed
    profile_dir = Path.home() / ".clapcheeks" / "browser-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)

    # 5. Open dating apps for login (only if not already logged in)
    ensure_dating_app_sessions(profile_dir, channel)

    # 6. Write config with smart defaults (if not exists)
    write_default_config()

    print("Setup complete. Run `clapcheeks swipe` to start.")
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Token storage | Custom encrypted file | `keyring` Python library | OS-native encryption, cross-platform |
| Device flow polling | Custom auth server | Standard pattern (POST → poll loop) | Proven, matches Stripe/Vercel pattern |
| Browser automation | Custom Chromium wrapper | Playwright `channel="chrome"` | Eliminates 100MB download |
| Human-like timing | Random sleep | `random.uniform(0.8, 2.4)` + jitter | Simple, proven anti-detection |
| Progress display | Custom UI | `rich` Python library | Spinners, progress bars, colors |

---

## Common Pitfalls

### Pitfall 1: Downloading Chromium When Chrome Is Available
**What goes wrong:** The default `p.chromium.launch()` always downloads Playwright's bundled Chromium. On a slow connection, this is 2-5 minutes of install time that kills activation.
**How to avoid:** Always check for system Chrome first via `channel="chrome"`.
**Warning signs:** High drop-off rate at the "browser install" step in analytics.

### Pitfall 2: Trying to Reuse the User's Default Chrome Profile
**What goes wrong:** Playwright cannot open Chrome's main "User Data" directory if Chrome is already running (which it almost always is). Results in crash or hang.
**How to avoid:** Always use a dedicated profile directory (`~/.clapcheeks/browser-profile/`), never the system default.
**Official Playwright docs state:** "Automating the default Chrome user profile is not supported."

### Pitfall 3: Swipe Rate Triggering Bot Detection
**What goes wrong:** Swiping at machine speed (1 swipe/second, all day) triggers Tinder/Bumble bot detection. Account gets shadowbanned or banned.
**How to avoid:** Default to 50 swipes per session, 800-2400ms human timing, run during peak hours only.
**Warning signs:** Match rate drops suddenly to near zero (shadowban indicator).

### Pitfall 4: Storing Auth Token in Plaintext
**What goes wrong:** Token in `~/.clapcheeks/config.toml` is readable by any process or malware on the machine. Subscription token can be stolen and shared.
**How to avoid:** Use `keyring` library for macOS Keychain storage. Only fall back to plaintext if keychain is genuinely unavailable, with a visible warning.

### Pitfall 5: Wizard-Heavy Onboarding Before First Swipe
**What goes wrong:** Users abandon multi-step configuration before seeing value. The current 6-step flow loses a significant portion of users who paid but never ran the tool.
**How to avoid:** Ship opinionated defaults. Let the user run `clapcheeks swipe` with zero configuration. Surface settings only after they've seen the product work.

### Pitfall 6: No-Signup Trial Mode
**What goes wrong:** Building a demo/trial mode with fake data takes engineering time and provides a false impression of the product. It does not show real matches from real profiles.
**How to avoid:** Skip it. The `curl | bash` install already self-selects high-intent users. Invest effort in compressing post-payment activation instead.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Download Chromium during setup | `channel="chrome"`, use system Chrome | Eliminates 100MB download, removes 2-5 min wait |
| Email/password CLI login | OAuth Device Flow (Stripe, Vercel, GitHub Copilot pattern) | Sub-60-second auth, no passwords in terminal |
| Multi-step configuration wizard | Opinionated defaults, zero-config first run | 33% activation improvement (S21 DevTools case study) |
| Storing tokens in dotfiles | OS keychain via `keyring` library | Encrypted at rest, OS-managed |
| Raw Playwright `launch()` | `launch(channel="chrome")` + persistent profile | No download + session persistence |

---

## Recommended Onboarding Flow (Payment to First Swipe in Under 3 Minutes)

This is the target flow. Each step has a time estimate.

---

**STEP 1: Install (30 seconds)**

```bash
curl -fsSL https://clapcheeks.tech/install.sh | bash
```

The install script:
- Installs the `clapcheeks` binary/package
- Does NOT download Chromium
- Does NOT run any setup wizard
- Prints: "Run `clapcheeks login` to activate your subscription."

---

**STEP 2: Activate Subscription (45 seconds)**

```bash
clapcheeks login
```

The CLI:
1. Generates a 6-char pairing code (e.g., `K7-MX3`)
2. Prints:

```
Opening clapcheeks.tech in your browser...
Pairing code: K7-MX3

Waiting for confirmation...
```

3. Opens `https://clapcheeks.tech/cli-auth?code=K7MX3` in the user's default browser
4. User is already logged in from payment — they see their name and "Authorize CLI" button
5. User clicks — takes 3 seconds
6. CLI polls every 2 seconds, receives token
7. Stores token in macOS Keychain
8. Prints: "Authorized. Welcome, Alex."

---

**STEP 3: Connect Dating Apps (60 seconds)**

```bash
clapcheeks connect
```

The CLI:
1. Opens system Chrome (via `channel="chrome"`) with a dedicated profile at `~/.clapcheeks/browser-profile/`
2. Opens Tinder in the browser window
3. Prints:

```
[1/2] Log into Tinder in the browser window, then press Enter...
```

4. User logs in to Tinder (they know their credentials — this is a one-time step)
5. User presses Enter
6. CLI captures session state (cookies/storage persisted in profile dir)
7. Repeats for Bumble
8. Prints: "Connected. Sessions saved — you won't need to log in again."

---

**STEP 4: First Swipe (30 seconds)**

```bash
clapcheeks swipe
```

The CLI:
1. Reads token from keychain, validates subscription
2. Launches system Chrome headless with saved profile (logged-in sessions intact)
3. Begins swiping with smart defaults (65% like rate, 50 swipes, human timing)
4. Prints live progress:

```
[=========___] Swiping on Tinder...
  Swiped: 12  |  Likes: 8  |  Passes: 4  |  Matches: 1

  New match: Sarah, 28
```

5. Session completes, summary printed
6. CLI suggests: "Next session scheduled for 6:00 PM. Run `clapcheeks status` anytime."

---

**Total time: ~3 minutes** (assuming user knows their dating app passwords)

---

## Open Questions

1. **Tinder/Bumble session detection**
   - What we know: These apps use standard web session cookies. Playwright can persist them via `user_data_dir`.
   - What's unclear: Whether Tinder/Bumble's anti-bot detection specifically fingerprints Playwright's Chrome vs. a real Chrome session. The `channel="chrome"` approach is less detectable than bundled Chromium, but this has not been verified with dating apps specifically.
   - Recommendation: Test with a dedicated test account before shipping to users. Monitor for shadowban signals.

2. **Hinge automation feasibility**
   - What we know: Hinge has added anti-bot detection as of 2024. Bumble has also improved detection.
   - What's unclear: Whether web-based Playwright automation works reliably against Hinge's current stack, or whether Hinge requires mobile app automation.
   - Recommendation: Ship Tinder + Bumble first. Add Hinge only after validating detection resistance.

3. **macOS permission prompts**
   - What we know: macOS may show permission dialogs when the CLI opens Chrome programmatically.
   - What's unclear: Whether Playwright's `channel="chrome"` triggers macOS Gatekeeper or accessibility permission prompts.
   - Recommendation: Test on a clean macOS user profile before shipping install script.

---

## Sources

### Primary (HIGH confidence)
- [Playwright Python Docs — BrowserType](https://playwright.dev/python/docs/api/class-browsertype) — user_data_dir limitations, connect_over_cdp fidelity warning, channel parameter
- [Playwright Python Docs — Browsers](https://playwright.dev/python/docs/browsers) — channel="chrome" system browser usage, skip download
- [GitHub Copilot CLI Auth Docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli) — device flow, keychain storage, credential priority
- [Vercel CLI Login Changelog](https://vercel.com/changelog/new-vercel-cli-login-flow) — OAuth 2.0 Device Flow as 2025 standard
- [Python keyring on PyPI](https://pypi.org/project/keyring/) — OS-native credential storage, macOS Keychain support

### Secondary (MEDIUM confidence)
- [Stripe CLI Login Technical Analysis](https://bentranter.ca/posts/stripes-cli-login/) — custom device flow pattern, polling approach, config.toml storage
- [Flowjam SaaS Onboarding Guide 2025](https://www.flowjam.com/blog/saas-onboarding-best-practices-2025-guide-checklist) — Zeigarnik effect, 4-step checklist, S21 CLI case study (+33% activation)
- [Raycast Onboarding Flow](https://pageflows.com/post/desktop-web/onboarding/raycast/) — command menu as first value, permissions after value demonstration
- [First Page Sage — Free Trial Conversion Benchmarks](https://firstpagesage.com/seo-blog/saas-free-trial-conversion-rate-benchmarks/) — opt-in 18.2% vs opt-out 48.8%
- [Userpilot SaaS Metrics](https://userpilot.com/saas-product-metrics/) — 37.5% activation average, 19.2% checklist completion

### Tertiary (LOW confidence — not independently verified)
- Bot detection timing recommendations (20-60 min sessions, peak hours) — from community sources, should be validated empirically
- Hinge anti-bot improvements — from general search, specific technical details unverified
- 95% Mac Chrome install rate — estimated, not from authoritative source

---

## Metadata

**Confidence breakdown:**
- Standard stack (Playwright channel, keyring, device flow): HIGH — verified against official docs
- Architecture pattern (dedicated profile, not default Chrome): HIGH — official Playwright docs
- Smart defaults (like_ratio, swipes_per_session): MEDIUM — informed by detection research but empirically unvalidated
- Benchmarks (activation rate, time to value): MEDIUM — general SaaS, not developer-tool-specific
- Bot detection timing: LOW — community sources only

**Research date:** 2026-03-01
**Valid until:** 2026-06-01 (Playwright API stable; bot detection patterns may shift faster)
