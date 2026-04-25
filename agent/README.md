# Clap Cheeks Local Agent

The Clap Cheeks local agent runs on your Mac and handles the private, on-device parts of your AI dating co-pilot experience.

## What it does

- Reads your iMessages (locally, never uploaded)
- Automates swiping on Tinder, Bumble, and Hinge via Playwright
- Tracks your dating spend across apps and in-person dates
- Syncs **anonymized** metrics to your [clapcheeks.tech](https://clapcheeks.tech) dashboard
- Uses a local AI model (Ollama/llama3.2) so your conversations stay private

## Your data stays on your device

Raw messages, profile photos, and conversation content are **never** sent to our servers. Only aggregate metrics (swipe counts, match rates, spend totals) are synced — and only with your explicit permission.

## Installation

The easiest way to install is from your terminal:

```bash
curl -fsSL https://clapcheeks.tech/install.sh | bash
```

Then follow the prompts:

```bash
clapcheeks setup   # Connect to your clapcheeks.tech account
clapcheeks status  # Check agent status
```

## Manual installation

```bash
# Requires Python 3.11+
pip install clapcheeks
python -m playwright install chromium
clapcheeks setup
```

## Dashboard

After setup, visit [clapcheeks.tech](https://clapcheeks.tech) to view your analytics, get AI coaching tips, and manage your preferences.

## Support

- Docs: https://clapcheeks.tech/docs
- GitHub: https://github.com/Julianb233/clapcheeks.tech

## AI Reply Generation

The reply pipeline (`clapcheeks.ai.reply.generate_reply`) tries providers in order:
1. **Ollama** (local LLM via `ollama` Python pkg) — preferred, free, fast
2. **Claude API** (via `anthropic` pkg, `ANTHROPIC_API_KEY`) — fallback
3. **Kimi API** (`KIMI_API_KEY`) — secondary fallback
4. Safe static fallback

**Ollama setup**: Install on Mac Mini via `brew install --cask ollama`, run
`ollama pull llama3.2`, start with `OLLAMA_HOST=0.0.0.0:11434 ollama serve`.
Then on the VPS, set `OLLAMA_HOST=http://<mini-tailscale-ip>:11434` in
`.env.local`. Verify with `curl http://<mini-ip>:11434/api/tags`.
