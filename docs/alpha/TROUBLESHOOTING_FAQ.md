# Clapcheeks Alpha — Troubleshooting FAQ

Quick fixes for common issues during alpha testing.

---

## Installation Issues

### "curl: command not found" during install
You need Xcode Command Line Tools. Run:
```bash
xcode-select --install
```
Then retry the install command.

### "pip3: command not found"
Python isn't on your PATH. Try:
```bash
python3 -m pip install clapcheeks
```
If that fails too, install Python via Homebrew:
```bash
brew install python@3.11
```

### Install script hangs at "Installing Homebrew..."
Homebrew install requires your Mac password. Type it when prompted (it won't show characters — that's normal).

### "Permission denied" on pip install
Don't use `sudo pip`. Instead:
```bash
pip3 install --user clapcheeks
```
Or use a virtual environment:
```bash
python3 -m venv ~/.clapcheeks-venv
source ~/.clapcheeks-venv/bin/activate
pip install clapcheeks
```

---

## Playwright / Browser Issues

### "Playwright not installed" or browser launch fails
The agent uses Playwright for browser automation. If it wasn't installed automatically:
```bash
pip3 install playwright
python3 -m playwright install chromium
```

### "Browser detection" / dating app says "automated browser detected"
This is rare with cloud mode (Browserbase handles anti-detection). If it happens:
1. Switch to iPhone mode: `clapcheeks setup` → select USB/WiFi iPhone
2. Or clear your browser profile: `rm -rf ~/.clapcheeks/browser-data/`
3. Then re-run: `clapcheeks connect`

### Browser window opens but stays blank
Your Browserbase key may be invalid or expired. Check:
```bash
cat ~/.clapcheeks/.env | grep BROWSERBASE
```
Get a fresh key at [browserbase.com](https://browserbase.com) and update the file.

### "chromium not found" on Apple Silicon Mac
Playwright sometimes needs Rosetta on M1/M2/M3 Macs:
```bash
softwareupdate --install-rosetta
python3 -m playwright install chromium
```

---

## iMessage & macOS Permissions

### "Calendar permission denied"
macOS blocked Calendar access. Fix it:
1. Open **System Settings** → **Privacy & Security** → **Calendar**
2. Toggle ON access for **Terminal** (or iTerm, or your terminal app)
3. Re-run: `clapcheeks converse`

### "osascript is not allowed to send keystrokes"
macOS Accessibility permissions are needed. Fix:
1. Open **System Settings** → **Privacy & Security** → **Accessibility**
2. Add your terminal app and toggle it ON
3. You may need to restart Terminal

### "Full Disk Access" prompt
Some features need Full Disk Access. Fix:
1. Open **System Settings** → **Privacy & Security** → **Full Disk Access**
2. Add your terminal app
3. Restart Terminal

### macOS keeps asking for permissions on every run
This is a macOS bug with certain terminal apps. Fix by:
1. Quitting Terminal completely
2. Opening **System Settings** → **Privacy & Security** → **Automation**
3. Make sure Terminal has all sub-permissions enabled
4. Restart Terminal

---

## Dating App Issues

### "Login failed" / session expired
Browser cookies expired. Fix:
```bash
clapcheeks connect
```
Log in manually in the browser window that opens. Sessions last 7–30 days depending on the platform.

### "No profiles appearing" / swipe deck is empty
The platform may be rate-limiting you. Solutions:
1. Wait 24 hours before the next session
2. Lower your daily limit in `~/.clapcheeks/config.yaml`
3. Check if your dating app account is still active by logging in normally

### "Rate limit exceeded" warning
This is intentional — it protects your account from bans. Don't increase the limits. Just wait until tomorrow.

### AI replies sound robotic / too generic
Try switching AI providers:
- **Kimi** (default): Best quality. Get a free key at [platform.moonshot.cn](https://platform.moonshot.cn)
- **Ollama** (local): Free but lower quality. Set `provider: ollama` in config

---

## API Key Issues

### "Kimi API error" / "API key invalid"
1. Check your key: `cat ~/.clapcheeks/.env | grep KIMI`
2. Verify it works at [platform.moonshot.cn](https://platform.moonshot.cn)
3. Free tier resets monthly — you may have hit the limit

### "Browserbase API error"
1. Check your key: `cat ~/.clapcheeks/.env | grep BROWSERBASE`
2. Free tier has session limits — check your usage at [browserbase.com](https://browserbase.com)

---

## Dashboard Issues

### Dashboard shows "No agent connected"
Link your agent:
```bash
clapcheeks setup
```
When prompted for your dashboard API key, paste it from [clapcheeks.tech/dashboard](https://clapcheeks.tech/dashboard) → Settings → API Key.

Or manually add to `~/.clapcheeks/.env`:
```
CLAPCHEEKS_DASHBOARD_TOKEN=your_token_here
```

### Dashboard stats not updating
The agent syncs stats every 5 minutes. If it's been longer:
1. Check the agent is running: `clapcheeks status`
2. Restart the daemon: `clapcheeks daemon`

---

## General

### How do I update?
```bash
pip3 install --upgrade clapcheeks
```

### How do I completely uninstall?
```bash
pip3 uninstall clapcheeks
rm -rf ~/.clapcheeks
```

### How do I check logs?
```bash
clapcheeks logs
```
Or view the raw log file: `~/.clapcheeks/logs/agent.log`

### Still stuck?
Post in the **Alpha Telegram Group** with:
1. What you tried
2. The error message (screenshot or copy-paste)
3. Your macOS version (`sw_vers`)
4. Your Python version (`python3 --version`)

We'll help you within a few hours.

---

*Clapcheeks Alpha v0.1 — Troubleshooting FAQ*
