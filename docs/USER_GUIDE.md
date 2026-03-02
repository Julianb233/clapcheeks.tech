# Outward — User Guide

## Introduction

Outward is an AI-powered dating co-pilot that automates swiping, sends AI-generated openers, manages conversations using NLP mirroring and persuasion techniques, and books dates on your calendar — all while staying under platform rate limits to minimize ban risk.

The agent runs locally on your Mac (or on your iPhone via USB/WiFi) and uses Kimi AI (Moonshot) to generate context-aware, human-sounding messages that mirror each match's communication style. You stay in control: review conversations, override suggestions, and confirm dates before they're booked.

---

## System Requirements

| Requirement | Details |
|-------------|---------|
| Operating System | macOS 12 (Monterey) or later — primary platform |
| Python | 3.11 or later |
| iPhone automation | USB or WiFi connection to iPhone running iOS 16+ |
| Cloud automation | Browserbase account (optional, for cloud/headless mode) |
| Calendar | macOS Calendar.app (built-in) or Google Calendar (via OAuth) |

> **Note:** Linux and Windows users can run Outward in cloud mode using Browserbase, but macOS Calendar integration requires a Mac. Google Calendar is the fallback for non-Mac environments.

---

## Quick Start

Get up and running in 5 steps:

```bash
# 1. Install
pip install clapcheeks

# 2. Run the setup wizard
clapcheeks setup

# 3. Start swiping
clapcheeks swipe --platform tinder

# 4. Check and send AI replies
clapcheeks converse --platform tinder

# 5. View upcoming dates
clapcheeks upcoming-dates
```

---

## Setup Wizard Walkthrough

Run `clapcheeks setup` to launch the interactive setup wizard. It will walk you through the following steps:

### Step 1: Mode Selection

Choose how the agent will interact with dating platforms:

| Mode | Description | Best For |
|------|-------------|----------|
| **USB iPhone** | Controls your iPhone directly over USB via iOS automation | Tinder, Bumble (most reliable) |
| **WiFi iPhone** | Same as USB but wireless — slightly less stable | Convenience when not at desk |
| **Mac cloud browser** | Headless browser on your Mac via Browserbase | All platforms, no phone needed |

### Step 2: Browserbase API Key (Cloud Mode Only)

If you selected cloud mode, enter your Browserbase API key. Get one at [browserbase.com](https://browserbase.com). A free tier is available.

Skip this step if using iPhone mode.

### Step 3: Kimi AI API Key

Outward uses Kimi 2.5 (Moonshot AI) as its default AI provider.

1. Go to [platform.moonshot.cn](https://platform.moonshot.cn)
2. Create a free account
3. Navigate to API Keys → Create Key
4. Paste the key into the wizard

A free tier is available with generous monthly limits. The key is saved to `~/.clapcheeks/.env` as `KIMI_API_KEY`.

### Step 4: Calendar Setup

Choose your calendar integration:

- **macOS Calendar (recommended):** No login required. Uses AppleScript to read Calendar.app. You will be prompted to grant Calendar access on first run (System Settings → Privacy & Security → Calendar).
- **Google Calendar:** Requires OAuth credentials. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` in `~/.clapcheeks/.env`. Instructions: [Google Calendar API Quickstart](https://developers.google.com/calendar/api/quickstart/python).

### Step 5: Dashboard Token Registration

The wizard generates a unique agent token and links it to your Outward account at [clapcheeks.tech/dashboard](https://clapcheeks.tech/dashboard). Create a free account on the dashboard first, then paste your dashboard API key when prompted.

---

## Platform Setup Instructions

### 1. Tinder

**Prerequisites:** Active Tinder account (Free or Gold/Platinum).

**How to connect:**
1. Run `clapcheeks setup` and select Tinder.
2. On first run, a browser window will open — log in manually with your phone number or Apple/Google account.
3. Cookies are cached for 30 days. Re-login if authentication expires.

**Special notes:**
- No Tinder API key is needed — Outward uses browser automation.
- Tinder Gold/Platinum users get unlimited likes. Free accounts have a 100/12-hour like cap.
- Tinder shares infrastructure with Hinge, OkCupid, and POF (Match Group). See `PLATFORM_RISKS.md` for cross-ban risk.

**Recommended settings:**
```yaml
tinder:
  daily_limit: 80
  like_ratio: 0.65
  active_hours: "9:00-23:00"
```

---

### 2. Bumble

**Prerequisites:** Active Bumble account.

**How to connect:**
1. Run `clapcheeks setup` and select Bumble.
2. Log in manually in the browser window that opens.
3. Cookies are cached for 14 days.

**Special notes:**
- Bumble is browser-only — it has no public API.
- On Bumble, women must send the first message. If you are set up in Women's mode, the AI handles openers. In Men's mode, AI replies once she messages.
- Bumble shares infrastructure with Badoo. Bans may propagate between the two.

**Recommended settings:**
```yaml
bumble:
  daily_limit: 75
  like_ratio: 0.60
  active_hours: "10:00-22:00"
```

---

### 3. Hinge

**Prerequisites:** Active Hinge account. Optional: Bearer token for API mode (see `SETUP_HINGE_TOKEN.md`).

**How to connect (Browser mode):**
1. Run `clapcheeks setup` and select Hinge.
2. Log in manually on first run.

**How to connect (API mode — faster):**
1. Capture your Bearer token using Charles Proxy or HTTP Toolkit (see `SETUP_HINGE_TOKEN.md`).
2. Add to `~/.clapcheeks/.env`:
   ```
   HINGE_AUTH_TOKEN=<your token>
   ```
3. API mode will be used automatically when the token is present.

**Special notes:**
- Hinge is part of Match Group — cross-ban risk with Tinder, OkCupid, and POF.
- API tokens expire after ~7 days and must be re-captured.

**Recommended settings:**
```yaml
hinge:
  daily_limit: 50
  like_ratio: 0.55
  active_hours: "10:00-22:00"
```

---

### 4. Grindr

**Prerequisites:** Active Grindr account (email + password).

**How to connect:**
1. Install the Grindr automation library:
   ```bash
   pip install Grindr
   ```
2. Run `clapcheeks setup` and select Grindr.
3. Enter your Grindr email and password. These are stored securely in your system keychain.

**Special notes:**
- Grindr uses a reverse-engineered API and works across all modes (USB, WiFi, cloud).
- Enforcement is less aggressive than Match Group platforms.
- Grindr Unlimited users get additional filters and unlimited taps.

**Recommended settings:**
```yaml
grindr:
  daily_limit: 100
  active_hours: "8:00-00:00"
```

---

### 5. Badoo

**Prerequisites:** Active Badoo account.

**How to connect:**
1. Run `clapcheeks setup` and select Badoo.
2. Log in manually in the browser window that opens.
3. Cookies are cached for 7 days — you will be prompted to re-login after expiry.

**Special notes:**
- Badoo is browser-only.
- Badoo is owned by Bumble Inc. and shares infrastructure. See `PLATFORM_RISKS.md`.
- Available in more countries than most Western apps — useful for international matching.

**Recommended settings:**
```yaml
badoo:
  daily_limit: 60
  like_ratio: 0.65
  active_hours: "9:00-22:00"
```

---

### 6. Happn

**Prerequisites:** Active Happn account linked to Facebook. Facebook access token (see `GETTING_FACEBOOK_TOKEN.md`).

**How to connect:**
1. Generate a Facebook access token at [developers.facebook.com/tools/explorer](https://developers.facebook.com/tools/explorer/) with `email` and `public_profile` permissions.
2. Save to `~/.clapcheeks/.env`:
   ```
   HAPPN_FB_TOKEN=<your token>
   ```
3. Run `clapcheeks setup` and select Happn — it will validate the token automatically.

**Special notes:**
- Happn matches are based on physical proximity (GPS). The agent processes existing "crushes" and sends openers.
- Happn is an independent platform — no cross-ban risk with Match Group or Bumble Inc.
- Token validity: short-lived tokens expire in 1-2 hours. Use long-lived tokens (60-day validity) — see `GETTING_FACEBOOK_TOKEN.md`.

**Recommended settings:**
```yaml
happn:
  daily_limit: 40
  active_hours: "9:00-23:00"
```

---

### 7. OKCupid

**Prerequisites:** Active OKCupid account (email + password).

**How to connect:**
1. Run `clapcheeks setup` and select OKCupid.
2. Enter your email and password. Stored securely in system keychain.
3. OKCupid uses a GraphQL API — no browser needed.

**Special notes:**
- OKCupid has the best female-to-male ratio of all major dating apps, making it high-value for straight men.
- OKCupid is part of Match Group — cross-ban risk applies.
- The "DoubleTake" feature (swipe deck) is automated. Question answers can be used to improve match scoring.

**Recommended settings:**
```yaml
okcupid:
  daily_limit: 70
  like_ratio: 0.70
  active_hours: "10:00-23:00"
```

---

### 8. POF (Plenty of Fish)

**Prerequisites:** Active POF account (username + password).

**How to connect:**
1. Run `clapcheeks setup` and select POF.
2. Enter your POF username and password.
3. POF automation runs on `pof.com/meet` via browser automation.

**Special notes:**
- POF is part of Match Group — cross-ban risk with Tinder, Hinge, OkCupid.
- Older user demographic compared to Tinder/Hinge.
- Free accounts have messaging limits. Upgrading to Premium removes them.

**Recommended settings:**
```yaml
pof:
  daily_limit: 50
  like_ratio: 0.70
  active_hours: "9:00-22:00"
```

---

### 9. Feeld

**Prerequisites:** Active Feeld account (email + password). Feeld is best for ENM (ethical non-monogamy) and polyamory.

**How to connect:**
1. Run `clapcheeks setup` and select Feeld.
2. Enter your Feeld email and password. Feeld uses a GraphQL API.

**Special notes:**
- Feeld enforces conservative daily limits (50 likes/day). Do not override these — the platform is small and aggressive swiping is easily detected.
- Feeld is independent with minimal enforcement, but the community is tight-knit — authentic openers perform significantly better than generic ones.
- Couple profiles are supported. AI adapts messaging tone accordingly.

**Recommended settings:**
```yaml
feeld:
  daily_limit: 40
  like_ratio: 0.55
  active_hours: "10:00-23:00"
```

---

### 10. Coffee Meets Bagel (CMB)

**Prerequisites:** Active CMB account linked to phone number.

**How to connect:**
1. Run `clapcheeks setup` and select CMB.
2. Enter your phone number — an OTP will be sent.
3. Enter the OTP to authenticate. The session token is cached.

**Special notes:**
- CMB sends exactly 21 "Bagels" (curated matches) per day — the app enforces this limit regardless of your settings. There is no way to exceed it.
- CMB is an independent platform with no shared infrastructure risk.
- The AI focuses on crafting high-quality, personalized openers for each bagel since the volume is low.

**Recommended settings:**
```yaml
cmb:
  daily_limit: 21
  active_hours: "12:00-22:00"
```

---

## CLI Reference

```
clapcheeks setup
  Interactive setup wizard. Run on first install or to update configuration.

clapcheeks status
  Show agent status and today's stats:
  - Swipes per platform
  - Matches received
  - Conversations active
  - Dates booked

clapcheeks swipe [options]
  Run a swiping session.
  --platform <name>     Platform to swipe on (default: tinder)
  --limit <n>           Maximum swipes this session (default: platform daily_limit)
  --ratio <0.0-1.0>     Like ratio — 1.0 = like everyone, 0.0 = like no one (default: from config)

clapcheeks converse [options]
  Process open conversations and send AI-generated replies.
  --platform <name>     Platform to process (default: all active platforms)

clapcheeks date-suggest [options]
  Have the AI suggest a date time and location for a match.
  --match <name>        Match name or ID
  --platform <name>     Platform the match is on

clapcheeks upcoming-dates
  List all upcoming "Date with [Name]" events from your calendar.

clapcheeks watch
  Live dashboard in your terminal. Refreshes every 30 seconds.
  Shows: active conversations, recent matches, today's swipe count, next date.

clapcheeks daemon
  Run Outward as a background service. Swipes and replies on schedule
  according to active_hours settings in config.

clapcheeks menu
  Launch the interactive TUI (terminal UI) menu for full control without
  memorizing commands.
```

---

## AI Configuration

### Default Provider: Kimi 2.5 (Moonshot AI)

| Setting | Value |
|---------|-------|
| Provider | Kimi (Moonshot AI) |
| Model | `moonshot-v1-8k` |
| API Key Env Var | `KIMI_API_KEY` |
| Key Source | [platform.moonshot.cn](https://platform.moonshot.cn) |

Kimi 2.5 is the default for its cost-effectiveness, speed, and strong conversational quality.

### Fallback Chain

If the primary provider fails or is not configured:

```
Ollama (local, free) → Kimi → hardcoded default opener
```

### Switching to Local Ollama (Free, Private)

To run the AI entirely locally with no API costs:

```bash
# Install Ollama
brew install ollama

# Pull the recommended model
ollama pull llama3.2

# Update config
nano ~/.clapcheeks/config.yaml
```

In `config.yaml`, set:
```yaml
ai:
  provider: ollama
  model: llama3.2
```

Ollama runs on `http://localhost:11434` by default. No API key required.

> **Note:** Local models produce lower-quality openers than Kimi. For best results, use Kimi.

---

## Calendar Integration

### macOS Calendar (Primary)

Outward uses AppleScript to read and write events in macOS Calendar.app. No login or OAuth is required.

**First-run permission:** On first use, macOS will prompt you to grant Calendar access. In the dialog, click "OK". If you dismissed the prompt:
1. Open System Settings
2. Go to Privacy & Security → Calendar
3. Enable access for Terminal (or your Python environment)

**Event format:** Dates are created as `Date with [Match Name]` with a 60-minute reminder.

### Google Calendar (Fallback)

For non-Mac environments or Google Calendar preference:

1. Create OAuth credentials at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the Google Calendar API
3. Download the credentials JSON and run the OAuth flow
4. Add to `~/.clapcheeks/.env`:
   ```
   GOOGLE_CLIENT_ID=<your client id>
   GOOGLE_CLIENT_SECRET=<your client secret>
   GOOGLE_REFRESH_TOKEN=<your refresh token>
   ```

---

## NLP & Communication Style

Outward does not send generic copy-paste openers. The AI analyzes each match's profile and writing style before composing any message.

### Style Mirroring

The AI evaluates:
- **Message length** — matches short/long responses
- **Emoji usage** — mirrors emoji density
- **Energy level** — casual vs. energetic tone
- **Formality** — slang vs. polished language
- **Response speed** — adapts urgency accordingly

### Persuasion Stages

Every conversation is tracked through a progression:

| Stage | Description |
|-------|-------------|
| `OPENER` | First message — attention-grabbing, profile-specific |
| `BUILDING` | Banter, finding common ground, generating interest |
| `QUALIFYING` | Light qualification — the match is made to invest |
| `DATE_PUSH` | Suggest a specific date, time, and place |
| `BOOKED` | Date confirmed, event added to calendar |

### Principles Applied

- **Cialdini's 6 Principles:** Social proof ("I was just telling my friends about..."), Reciprocity, Scarcity ("I'm free Thursday but the weekend is packed"), Liking (mirroring), Authority (confidence), Commitment
- **AIDA Funnel:** Attention (opener hook) → Interest (engaging banter) → Desire (connection and rapport) → Action (date ask)
- **NLP Mirroring:** Language patterns, pacing, and vocabulary are matched to the match's style

---

## Dashboard

Access the web dashboard at [clapcheeks.tech/dashboard](https://clapcheeks.tech/dashboard) after creating an account and linking your agent token.

**Dashboard features:**
- Live conversation feed across all platforms
- Swipe stats and match rate graphs
- Upcoming dates calendar view
- AI message review and override
- Platform health indicators
- Token usage and billing

To link your agent: run `clapcheeks setup` and enter your dashboard API key when prompted, or manually set `CLAPCHEEKS_DASHBOARD_TOKEN` in `~/.clapcheeks/.env`.

---

## Troubleshooting

### "Calendar permission denied"
**Fix:** Open System Settings → Privacy & Security → Calendar → enable access for Terminal or your Python environment. Then re-run the command.

### "Kimi API error" / "API key invalid"
**Fix:** Check that `KIMI_API_KEY` is set in `~/.clapcheeks/.env`. Verify the key is valid at [platform.moonshot.cn](https://platform.moonshot.cn). Free tier limits reset monthly.

### "No profiles appearing" / empty swipe deck
**Fix:** The platform may be rate-limiting your account due to high activity. Wait 24 hours before running another session. Reduce your `daily_limit` in config to avoid future throttling.

### "Login failed" / session expired
**Fix:** Browser cookies have expired. Run `clapcheeks setup` again and log in manually when the browser window opens. Most platforms cache sessions for 7-30 days.

### "osascript error" on Calendar
**Fix:** osascript (AppleScript) is macOS-only. If you are on Linux or Windows, switch to Google Calendar integration by setting the `GOOGLE_*` environment variables in `~/.clapcheeks/.env`.

### "Rate limit exceeded" warning in logs
**Fix:** You have hit the platform's daily cap. This is enforced intentionally to protect your account. Do not increase `daily_limit` beyond the recommended values in this guide.

### Agent stops mid-session
**Fix:** Check logs at `~/.clapcheeks/logs/agent.log`. Common causes: expired auth token, network timeout, or platform UI change requiring an update. Run `pip install --upgrade clapcheeks` to get the latest platform adapters.

---

## Config File Reference

Config lives at `~/.clapcheeks/config.yaml`. Full example:

```yaml
ai:
  provider: kimi           # kimi | ollama
  model: moonshot-v1-8k   # or llama3.2 for ollama

calendar:
  provider: macos          # macos | google
  reminder_minutes: 60

active_hours: "9:00-23:00"

platforms:
  tinder:
    enabled: true
    daily_limit: 80
    like_ratio: 0.65
  bumble:
    enabled: true
    daily_limit: 75
    like_ratio: 0.60
  hinge:
    enabled: false
    daily_limit: 50
    like_ratio: 0.55
  grindr:
    enabled: false
    daily_limit: 100
  okcupid:
    enabled: false
    daily_limit: 70
    like_ratio: 0.70
  feeld:
    enabled: false
    daily_limit: 40
    like_ratio: 0.55
  cmb:
    enabled: false
    daily_limit: 21
```

Environment variables in `~/.clapcheeks/.env` override config file values.
