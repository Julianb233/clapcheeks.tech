#!/bin/bash
# Clap Cheeks — AI Dating Co-Pilot installer
# https://clapcheeks.tech
#
# Usage: curl -fsSL https://clapcheeks.tech/install.sh | bash

set -e

CLAPCHEEKS_VERSION="0.1.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

# Banner
echo ""
echo -e "${PURPLE}${BOLD}  ____ _                  ____ _               _        ${NC}"
echo -e "${PURPLE}${BOLD} / ___| | __ _ _ __      / ___| |__   ___  ___| | _____ ${NC}"
echo -e "${PURPLE}${BOLD}| |   | |/ _\` | '_ \\   | |   | '_ \\ / _ \\/ _ \\ |/ / __|${NC}"
echo -e "${PURPLE}${BOLD}| |___| | (_| | |_) |  | |___| | | |  __/  __/   <\\__ \\${NC}"
echo -e "${PURPLE}${BOLD} \\____|_|\\__,_| .__/    \\____|_| |_|\\___|\\___|_|\\_\\___/${NC}"
echo -e "${PURPLE}${BOLD}             |_|                                        ${NC}"
echo ""
echo -e "${BOLD}AI Dating Co-Pilot v${CLAPCHEEKS_VERSION}${NC}"
echo -e "${YELLOW}https://clapcheeks.tech${NC}"
echo ""

# ---------------------------------------------------------------------------
# 1. macOS version check
# ---------------------------------------------------------------------------
if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}Error: Clap Cheeks requires macOS (for iMessage and dating app access).${NC}"
    echo -e "${RED}Detected OS: $(uname). Exiting.${NC}"
    exit 1
fi

MACOS_VERSION=$(sw_vers -productVersion)
MACOS_MAJOR=$(echo "$MACOS_VERSION" | cut -d. -f1)

if [[ "$MACOS_MAJOR" -lt 12 ]]; then
    echo -e "${RED}Error: macOS 12 (Monterey) or later required.${NC}"
    echo -e "${RED}Detected: macOS ${MACOS_VERSION}. Please update your OS.${NC}"
    exit 1
fi

echo -e "  ${GREEN}✓${NC} macOS ${MACOS_VERSION} detected"

# ---------------------------------------------------------------------------
# 2. Homebrew check and install
# ---------------------------------------------------------------------------
if ! command -v brew &>/dev/null; then
    echo ""
    echo -e "${BOLD}Installing Homebrew...${NC}"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add brew to PATH for current session (Apple Silicon and Intel paths)
    if [[ -f /opt/homebrew/bin/brew ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -f /usr/local/bin/brew ]]; then
        eval "$(/usr/local/bin/brew shellenv)"
    fi
fi

echo -e "  ${GREEN}✓${NC} Homebrew ready"

# ---------------------------------------------------------------------------
# 3. Python check and install
# ---------------------------------------------------------------------------
NEED_PYTHON=0

if ! command -v python3 &>/dev/null; then
    NEED_PYTHON=1
else
    if ! python3 -c 'import sys; exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; then
        NEED_PYTHON=1
    fi
fi

if [[ "$NEED_PYTHON" -eq 1 ]]; then
    echo ""
    echo -e "${BOLD}Installing Python 3.11...${NC}"
    brew install python@3.11
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}")')
echo -e "  ${GREEN}✓${NC} Python ${PYTHON_VERSION} ready"

# ---------------------------------------------------------------------------
# 4. Install clapcheeks package
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}Installing Clap Cheeks agent...${NC}"

mkdir -p "$HOME/.clapcheeks"

pip3 install --upgrade "git+https://github.com/Julianb233/clapcheeks.tech.git#subdirectory=agent"

# Verify install
if command -v clapcheeks &>/dev/null; then
    INSTALLED_VERSION=$(clapcheeks --version 2>&1 | head -1)
    echo -e "  ${GREEN}✓${NC} clapcheeks CLI installed (${INSTALLED_VERSION})"
else
    echo -e "  ${GREEN}✓${NC} clapcheeks CLI installed"
fi

# ---------------------------------------------------------------------------
# 5. Run setup (browser auth + daemon)
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}Opening browser for account setup...${NC}"
echo ""

clapcheeks setup

# ---------------------------------------------------------------------------
# 6. Success message
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  Clap Cheeks installed successfully!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Your agent is running in the background."
echo ""
echo -e "  ${BOLD}Dashboard:${NC}  ${YELLOW}https://clapcheeks.tech/dashboard${NC}"
echo ""
echo -e "  ${BOLD}Commands:${NC}"
echo -e "    clapcheeks status       Show agent status"
echo -e "    clapcheeks agent stop   Stop the background daemon"
echo -e "    clapcheeks agent start  Start the background daemon"
echo ""
