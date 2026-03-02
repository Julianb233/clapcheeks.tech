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
