#!/usr/bin/env bash
# Drives Chrome UI via AppleScript to install the token-harvester extension.
# Bypasses the --load-extension flag that was deprecated in Chrome 137+.
# Run this directly on the Mac with GUI access (not via SSH).
#
# Usage (on Mac):
#   bash ~/clapcheeks.tech/agent/scripts/install_extension_via_ui.sh

set -eu

REPO_DIR="${REPO_DIR:-$HOME/clapcheeks.tech}"
EXT_DIR="$REPO_DIR/extensions/token-harvester"

if [ ! -f "$EXT_DIR/manifest.json" ]; then
  echo "ERROR: extension manifest not found at $EXT_DIR/manifest.json" >&2
  echo "Clone the repo first: git clone https://github.com/Julianb233/clapcheeks.tech.git ~" >&2
  exit 1
fi

echo "Installing extension from: $EXT_DIR"
echo "Make sure you can see Chrome in the foreground. Don't touch the keyboard/mouse for 15 sec."
sleep 2

osascript <<OSAEOF
set extPath to POSIX file "$EXT_DIR"
set extPathStr to "$EXT_DIR"

-- Open a fresh chrome://extensions tab
tell application "Google Chrome"
  activate
  if (count of windows) = 0 then
    make new window
  end if
  make new tab at end of tabs of front window with properties {URL:"chrome://extensions/"}
  delay 1.5
end tell

-- Turn on Developer mode if not already on, then click "Load unpacked"
tell application "System Events"
  tell process "Google Chrome"
    -- Ensure the Chrome window is frontmost
    set frontmost to true
    delay 0.5

    -- Enable developer mode via JS injection is cleaner than clicking the toggle.
    -- But direct click works too; use tell application to execute JavaScript:
  end tell
end tell

-- Enable developer mode + open "Load unpacked" dialog via JS in the page
tell application "Google Chrome"
  set activeTab to active tab of front window
  tell activeTab
    -- Toggle dev-mode on
    execute javascript "document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot.querySelector('#devMode').click();"
    delay 0.5
    -- Click "Load unpacked"
    execute javascript "document.querySelector('extensions-manager').shadowRoot.querySelector('extensions-toolbar').shadowRoot.querySelector('#loadUnpacked').click();"
  end tell
end tell

delay 1.5

-- Type the path into the file-open dialog
tell application "System Events"
  tell process "Google Chrome"
    -- Open "Go to folder" dialog (Cmd+Shift+G)
    keystroke "g" using {command down, shift down}
    delay 0.8
    keystroke extPathStr
    delay 0.5
    keystroke return
    delay 1.0
    -- Click Open
    keystroke return
    delay 1.0
  end tell
end tell

return "done"
OSAEOF

echo ""
echo "Extension install flow triggered. Check chrome://extensions/ — 'Clapcheeks Token Harvester' should appear."
echo ""
echo "Next steps (automatic if bake-in worked, else manual):"
echo "  1. Click the extension icon in the toolbar → paste your device token → Save"
echo "  2. Visit hinge.co / tinder.com / instagram.com in any tab"
echo "     (cookies + tokens will auto-harvest)"
OSAEOF
