#!/bin/bash
# Outward — AI Dating Co-Pilot installer
# https://clapcheeks.tech

set -e

OUTWARD_VERSION="0.1.0"
OUTWARD_DIR="$HOME/.outward"
INSTALL_DIR="$HOME/.outward/agent"
PYTHON_MIN="3.11"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${PURPLE}${BOLD}  ___        _                         _ ${NC}"
echo -e "${PURPLE}${BOLD} / _ \ _   _| |___      ____ _ _ __ __| |${NC}"
echo -e "${PURPLE}${BOLD}| | | | | | | __\ \ /\ / / _\` | '__/ _\` |${NC}"
echo -e "${PURPLE}${BOLD}| |_| | |_| | |_ \ V  V / (_| | | | (_| |${NC}"
echo -e "${PURPLE}${BOLD} \___/ \__,_|\__| \_/\_/ \__,_|_|  \__,_|${NC}"
echo ""
echo -e "${BOLD}AI Dating Co-Pilot v${OUTWARD_VERSION}${NC}"
echo -e "${YELLOW}https://clapcheeks.tech${NC}"
echo ""

# 1. Check macOS
if [[ "$(uname)" != "Darwin" ]]; then
  echo -e "${RED}Error: Outward requires macOS (for iMessage and dating app access).${NC}"
  exit 1
fi

# 2. Check Python
if ! command -v python3 &>/dev/null; then
  echo -e "${RED}Error: Python 3.11+ required. Install from https://python.org${NC}"
  exit 1
fi

PYTHON_VERSION=$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo -e "  Python ${PYTHON_VERSION} found ✓"

# 3. Install agent
echo ""
echo -e "${BOLD}Installing Outward agent...${NC}"
mkdir -p "$INSTALL_DIR"

# Download the agent package from GitHub
pip3 install --quiet outward-agent 2>/dev/null || {
  # Fallback: install from GitHub directly
  pip3 install --quiet "git+https://github.com/Julianb233/clapcheeks.tech.git#subdirectory=agent"
}

# 4. Install Playwright browsers
echo -e "${BOLD}Installing browser automation...${NC}"
python3 -m playwright install chromium --quiet 2>/dev/null || true

# 5. Run first-time setup
echo ""
echo -e "${GREEN}${BOLD}✓ Outward installed successfully!${NC}"
echo ""
echo -e "  Get started:"
echo -e "  ${YELLOW}1.${NC} Visit ${BOLD}https://clapcheeks.tech${NC} to create your account"
echo -e "  ${YELLOW}2.${NC} Run: ${BOLD}outward setup${NC}"
echo -e "  ${YELLOW}3.${NC} Run: ${BOLD}outward menu${NC}"
echo ""
echo -e "${PURPLE}Questions? https://clapcheeks.tech/docs${NC}"
echo ""
