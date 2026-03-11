# Clapcheeks Alpha — Install Guide

**Time to complete: ~10 minutes**

---

## Requirements

| What | Version |
|------|---------|
| Mac | macOS 12 (Monterey) or later |
| Python | 3.11+ (installer handles this) |
| Dating app | At least one active account (Tinder, Bumble, Hinge, etc.) |

---

## Option A: One-Command Install (Recommended)

Open Terminal and paste:

```bash
curl -fsSL https://clapcheeks.tech/install.sh | bash
```

This will:
1. Check your macOS version
2. Install Homebrew (if missing)
3. Install Python 3.11 (if needed)
4. Install the `clapcheeks` CLI
5. Launch the setup wizard automatically

**Skip to "First Swipe" below once setup completes.**

---

## Option B: Manual Install

If you prefer to install step by step:

```bash
# 1. Make sure Python 3.11+ is installed
python3 --version

# 2. Install the CLI
pip3 install clapcheeks

# 3. Run the setup wizard
clapcheeks setup
```

---

## Setup Wizard Walkthrough

The wizard runs automatically after install. It asks 4 things:

### 1. Automation mode
Choose how the agent talks to dating apps:

| Mode | Best for |
|------|----------|
| **Mac cloud browser** | Easiest — runs headless in the background |
| **USB iPhone** | Most reliable for Tinder/Bumble |
| **WiFi iPhone** | Same as USB but wireless |

**Alpha recommendation: Mac cloud browser** (requires a free Browserbase key — the wizard will link you).

### 2. AI API key
The wizard asks for a **Kimi AI** key (free tier available):
1. Go to [platform.moonshot.cn](https://platform.moonshot.cn)
2. Create an account
3. Go to API Keys → Create Key
4. Paste it into the wizard

**Or use local AI for free:** skip the key and the agent falls back to Ollama (install with `brew install ollama && ollama pull llama3.2`).

### 3. Calendar
- **macOS Calendar** — just click "OK" on the permission prompt. No setup needed.
- **Google Calendar** — requires OAuth setup (see the full User Guide if needed).

### 4. Dashboard link (optional)
Create a free account at [clapcheeks.tech/dashboard](https://clapcheeks.tech/dashboard), then paste your dashboard API key to link your agent.

---

## Your First Swipe

Once setup is done:

```bash
# Connect your first dating app
clapcheeks connect

# Start swiping (defaults to Tinder)
clapcheeks swipe --platform tinder

# Check your matches and let AI reply
clapcheeks converse --platform tinder

# See your stats
clapcheeks status
```

That's it! The agent is now swiping and replying on your behalf.

---

## Run in Background (Optional)

To keep the agent running automatically:

```bash
clapcheeks daemon
```

It will swipe and reply during your configured active hours (default 9am–11pm).

---

## Need Help?

- **Troubleshooting FAQ:** [TROUBLESHOOTING_FAQ.md](./TROUBLESHOOTING_FAQ.md)
- **Full User Guide:** [USER_GUIDE.md](../USER_GUIDE.md)
- **Alpha Telegram Group:** [Join here](https://t.me/+clapcheeks_alpha) — ask questions, report bugs, chat with the team
- **Feedback Form:** [Fill out after your first session](./feedback-form.html)

---

*Clapcheeks Alpha v0.1 — AI Dating Co-Pilot*
