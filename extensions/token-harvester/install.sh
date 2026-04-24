#!/usr/bin/env bash
# Clapcheeks Token Harvester — one-shot installer.
#
# Usage:
#   bash install.sh <DEVICE_TOKEN>              # launch once, no auto-restart
#   bash install.sh <DEVICE_TOKEN> --persistent # install launchd agent so Chrome auto-starts at login + relaunches on crash/quit
#
# What it does:
#   - Clones or updates clapcheeks.tech into ~/clapcheeks-chrome/repo
#   - Kills any existing Clapcheeks-profile Chrome (isolated profile,
#     doesn't touch your main browsing)
#   - Launches Chrome with the extension loaded in that isolated profile,
#     opens a welcome tab with your device token as a URL param so it
#     auto-saves to chrome.storage.sync
#   - Opens tinder.com in the same window. First page load harvests and
#     pushes the token to clapcheeks.tech.
#   - With --persistent: installs ~/Library/LaunchAgents/com.clapcheeks.chrome.plist
#     and `launchctl load`s it so the profile auto-starts at every login
#     and relaunches if you quit Chrome or it crashes.

set -euo pipefail

DEVICE_TOKEN=""
PERSISTENT=0
for arg in "$@"; do
  case "$arg" in
    --persistent) PERSISTENT=1 ;;
    *) [[ -z "$DEVICE_TOKEN" ]] && DEVICE_TOKEN="$arg" ;;
  esac
done
DEVICE_TOKEN="${DEVICE_TOKEN:-${CLAPCHEEKS_DEVICE_TOKEN:-}}"
if [[ -z "$DEVICE_TOKEN" ]]; then
  echo "ERROR: pass your device token as the first arg."
  echo "  bash install.sh <DEVICE_TOKEN> [--persistent]"
  exit 1
fi

if [[ ${#DEVICE_TOKEN} -lt 30 ]]; then
  echo "ERROR: DEVICE_TOKEN looks too short (len=${#DEVICE_TOKEN}). Double-check you copied the whole string."
  exit 1
fi

HOST_DIR="${HOME}/clapcheeks-chrome"
REPO_DIR="${HOST_DIR}/repo"
PROFILE_DIR="${HOST_DIR}/chrome-profile"
EXT_DIR="${REPO_DIR}/extensions/token-harvester"
DEVICE_NAME="$(scutil --get ComputerName 2>/dev/null || hostname -s)"

mkdir -p "$HOST_DIR" "$PROFILE_DIR"

# 1) Clone or update the repo
if [[ -d "$REPO_DIR/.git" ]]; then
  echo "==> Updating repo at $REPO_DIR"
  git -C "$REPO_DIR" fetch --quiet origin main
  git -C "$REPO_DIR" reset --hard --quiet origin/main
else
  echo "==> Cloning clapcheeks.tech into $REPO_DIR"
  git clone --depth 1 --quiet https://github.com/Julianb233/clapcheeks.tech.git "$REPO_DIR"
fi

if [[ ! -f "$EXT_DIR/manifest.json" ]]; then
  echo "ERROR: extension not found at $EXT_DIR"
  exit 1
fi

# 2) Find Chrome
CHROME=""
for p in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "${HOME}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
do
  [[ -x "$p" ]] && { CHROME="$p"; break; }
done
if [[ -z "$CHROME" ]]; then
  echo "ERROR: Google Chrome not found in /Applications. Install Chrome then rerun."
  exit 1
fi
echo "==> Using Chrome at: $CHROME"

# 3) Kill any existing Clapcheeks-profile Chrome (gentle)
pkill -f "clapcheeks-chrome/chrome-profile" 2>/dev/null || true
sleep 1

# 4) URL-encode the token (basic — tokens are base64url-safe so no unsafe chars, but be defensive)
urlencode() {
  python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$1"
}
TOKEN_ENC=$(urlencode "$DEVICE_TOKEN")
NAME_ENC=$(urlencode "$DEVICE_NAME")

# We need the extension's ID to reach welcome.html, but the ID depends on
# the extension path. When loading unpacked, Chrome derives the ID from the
# SHA256 of the extension path. We can compute the same ID with openssl + awk.
ext_id=$(
  python3 - <<PY
import hashlib, sys, pathlib
p = str(pathlib.Path("${EXT_DIR}").resolve())
h = hashlib.sha256(p.encode()).hexdigest()[:32]
print("".join(chr(ord('a') + int(c, 16)) for c in h))
PY
)
echo "==> Extension ID will be: ${ext_id}"

WELCOME_URL="chrome-extension://${ext_id}/welcome.html?device_token=${TOKEN_ENC}&device_name=${NAME_ENC}&api_origin=https%3A%2F%2Fclapcheeks.tech"

# 5) Launch Chrome
echo "==> Launching Chrome with extension + welcome page"
"$CHROME" \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXT_DIR" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --no-first-run \
  --no-default-browser-check \
  "$WELCOME_URL" \
  "https://tinder.com/app/recs" \
  >/dev/null 2>&1 &

sleep 2
echo ""
echo "==> Chrome launched."
echo "    Tab 1: welcome page showing your token was saved."
echo "    Tab 2: tinder.com — log in if needed, the extension harvests automatically."
echo "    Also log in at https://hinge.co and https://www.instagram.com so their"
echo "    cookies persist in this profile."
echo ""

if [[ "$PERSISTENT" -eq 1 ]]; then
  echo "==> Installing launchd agent for always-running Chrome"
  PLIST_SRC="${EXT_DIR}/com.clapcheeks.chrome.plist.template"
  PLIST_DST="${HOME}/Library/LaunchAgents/com.clapcheeks.chrome.plist"
  if [[ ! -f "$PLIST_SRC" ]]; then
    echo "    WARN: plist template not found at $PLIST_SRC — skipping persistence"
  else
    mkdir -p "${HOME}/Library/LaunchAgents"
    sed \
      -e "s|{{CHROME_BIN}}|${CHROME}|g" \
      -e "s|{{PROFILE_DIR}}|${PROFILE_DIR}|g" \
      -e "s|{{EXT_DIR}}|${EXT_DIR}|g" \
      -e "s|{{HOST_DIR}}|${HOST_DIR}|g" \
      "$PLIST_SRC" > "$PLIST_DST"
    launchctl unload "$PLIST_DST" 2>/dev/null || true
    launchctl load -w "$PLIST_DST"
    echo "    Installed: $PLIST_DST"
    echo "    Chrome will now auto-start at login and relaunch if you quit it."
    echo "    Logs: tail -f ${HOST_DIR}/chrome.log"
    echo "    To disable: launchctl unload '$PLIST_DST' && rm '$PLIST_DST'"
  fi
  echo ""
fi

echo "    To relaunch the profile manually later:"
echo "      $CHROME --user-data-dir='$PROFILE_DIR' --load-extension='$EXT_DIR' --disable-features=DisableLoadExtensionCommandLineSwitch"
