#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────
# Clapcheeks Mac Agent Installer — sets up the local agent for dogfooding
#
# Usage:
#   curl -fsSL https://clapcheeks.tech/install.sh | bash
#   — OR —
#   bash scripts/install-mac-agent.sh
#
# What this does:
#   1. Checks prerequisites (Python 3.10+, pip, macOS)
#   2. Creates ~/.clapcheeks/ config directory
#   3. Installs the clapcheeks Python package (agent/)
#   4. Runs initial setup (login + platform connect)
#   5. Installs launchd plist for auto-start
#   6. Verifies the daemon is running
# ───────────────────────────────────────────────────────────────────────
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

echo -e "${PURPLE}${BOLD}"
echo "  ╔═══════════════════════════════════════╗"
echo "  ║     CLAPCHEEKS — AI Dating Co-Pilot   ║"
echo "  ║          Mac Agent Installer           ║"
echo "  ╚═══════════════════════════════════════╝"
echo -e "${NC}"

# ─── Step 1: Prerequisites ───────────────────────────────────────────
echo -e "${BLUE}[1/6]${NC} Checking prerequisites..."

# macOS check
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}ERROR: This installer is for macOS only.${NC}"
    echo "       For Linux/Windows, use: pip install clapcheeks[all]"
    exit 1
fi

# Python 3.10+ check
PYTHON=""
for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" &>/dev/null; then
        version=$("$candidate" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [[ "$major" -ge 3 && "$minor" -ge 10 ]]; then
            PYTHON="$candidate"
            break
        fi
    fi
done

if [[ -z "$PYTHON" ]]; then
    echo -e "${RED}ERROR: Python 3.10+ not found.${NC}"
    echo "       Install via: brew install python@3.12"
    exit 1
fi

echo -e "  ${GREEN}✓${NC} macOS detected"
echo -e "  ${GREEN}✓${NC} Python: $($PYTHON --version)"

# pip check
if ! "$PYTHON" -m pip --version &>/dev/null; then
    echo -e "${RED}ERROR: pip not found for $PYTHON.${NC}"
    echo "       Install via: $PYTHON -m ensurepip"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} pip available"

# ─── Step 2: Config directory ────────────────────────────────────────
echo -e "\n${BLUE}[2/6]${NC} Setting up config directory..."

CONFIG_DIR="$HOME/.clapcheeks"
mkdir -p "$CONFIG_DIR"/{dogfood/health,dogfood/reports}

if [[ ! -f "$CONFIG_DIR/.env" ]]; then
    cat > "$CONFIG_DIR/.env" <<'ENV'
# Clapcheeks Agent Config
# Populated by `clapcheeks setup`

# SUPABASE_URL=
# SUPABASE_SERVICE_KEY=
# DEVICE_ID=
# TINDER_AUTH_TOKEN=
# HINGE_AUTH_TOKEN=
# ANTHROPIC_API_KEY=
ENV
    chmod 600 "$CONFIG_DIR/.env"
    echo -e "  ${GREEN}✓${NC} Created $CONFIG_DIR/.env (edit with your keys)"
else
    echo -e "  ${GREEN}✓${NC} Config directory exists ($CONFIG_DIR)"
fi

# ─── Step 3: Install Python package ─────────────────────────────────
echo -e "\n${BLUE}[3/6]${NC} Installing clapcheeks agent..."

# Check if we're running from the repo
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

if [[ -f "$REPO_ROOT/agent/setup.py" || -f "$REPO_ROOT/agent/pyproject.toml" ]]; then
    echo "  Installing from local repo..."
    "$PYTHON" -m pip install -e "$REPO_ROOT/agent[all]" --quiet 2>&1 | tail -3
else
    echo "  Installing from PyPI..."
    "$PYTHON" -m pip install "clapcheeks[all]" --quiet 2>&1 | tail -3
fi

# Verify installation
if ! "$PYTHON" -m clapcheeks.cli --version &>/dev/null 2>&1; then
    # Try via pip script
    if ! command -v clapcheeks &>/dev/null; then
        echo -e "${YELLOW}WARNING: clapcheeks CLI not found in PATH after install.${NC}"
        echo "         You may need to add $($PYTHON -m site --user-base)/bin to your PATH."
    fi
fi
echo -e "  ${GREEN}✓${NC} clapcheeks agent installed"

# ─── Step 4: Login (device flow) ────────────────────────────────────
echo -e "\n${BLUE}[4/6]${NC} Setting up authentication..."

if [[ -f "$CONFIG_DIR/agent_token" ]]; then
    echo -e "  ${GREEN}✓${NC} Agent token already exists. Skipping login."
else
    echo -e "  ${YELLOW}→${NC} Running device flow login..."
    echo -e "  This will open your browser to authenticate."
    echo ""
    "$PYTHON" -m clapcheeks.cli login || {
        echo -e "${YELLOW}WARNING: Login skipped or failed. Run 'clapcheeks login' manually.${NC}"
    }
fi

# ─── Step 5: Install launchd service ────────────────────────────────
echo -e "\n${BLUE}[5/6]${NC} Installing background service..."

PLIST_LABEL="tech.clapcheeks.agent"
PLIST_PATH="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

if launchctl list "$PLIST_LABEL" &>/dev/null 2>&1; then
    echo -e "  ${YELLOW}→${NC} Stopping existing service..."
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

PYTHON_PATH="$(command -v "$PYTHON")"
cat > "$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$PLIST_LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PYTHON_PATH</string>
        <string>-m</string>
        <string>clapcheeks.daemon</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$CONFIG_DIR/daemon.log</string>
    <key>StandardErrorPath</key>
    <string>$CONFIG_DIR/daemon.log</string>
    <key>WorkingDirectory</key>
    <string>$CONFIG_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>
PLIST

launchctl load "$PLIST_PATH" 2>/dev/null || {
    echo -e "${YELLOW}WARNING: Failed to load launchd plist. Start manually with:${NC}"
    echo "         clapcheeks daemon start"
}
echo -e "  ${GREEN}✓${NC} Launchd service installed (auto-starts on login)"

# ─── Step 6: Verify ─────────────────────────────────────────────────
echo -e "\n${BLUE}[6/6]${NC} Verifying installation..."

sleep 2  # Give daemon a moment to start

if launchctl list "$PLIST_LABEL" &>/dev/null 2>&1; then
    echo -e "  ${GREEN}✓${NC} Daemon is running"
else
    echo -e "  ${YELLOW}!${NC} Daemon not detected (may need manual start)"
fi

if [[ -f "$CONFIG_DIR/.env" ]]; then
    echo -e "  ${GREEN}✓${NC} Config file exists"
fi

if [[ -d "$CONFIG_DIR/dogfood" ]]; then
    echo -e "  ${GREEN}✓${NC} Dogfooding directories created"
fi

echo ""
echo -e "${GREEN}${BOLD}Installation complete!${NC}"
echo ""
echo -e "  ${BOLD}Next steps:${NC}"
echo -e "  1. Edit ${BLUE}~/.clapcheeks/.env${NC} with your API keys"
echo -e "  2. Run ${BLUE}clapcheeks connect${NC} to link your dating apps"
echo -e "  3. Run ${BLUE}clapcheeks swipe --platform tinder${NC} to start"
echo -e "  4. View your dashboard at ${BLUE}https://clapcheeks.tech/dashboard${NC}"
echo ""
echo -e "  ${BOLD}Dogfooding commands:${NC}"
echo -e "  ${BLUE}clapcheeks dogfood status${NC}     — Check agent health & streak"
echo -e "  ${BLUE}clapcheeks dogfood report${NC}     — Generate weekly report"
echo -e "  ${BLUE}clapcheeks dogfood friction${NC}   — Log a friction point"
echo -e "  ${BLUE}clapcheeks dogfood test${NC}       — Run platform tests"
echo ""
echo -e "  ${BOLD}Logs:${NC}"
echo -e "  ${BLUE}tail -f ~/.clapcheeks/daemon.log${NC}"
echo ""
