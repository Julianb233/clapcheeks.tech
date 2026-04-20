#!/usr/bin/env bash
# One-liner to authorize the agency fleet's SSH key on a Mac user account
# AND enable sshd. Run on the Mac you want agents to reach.
#
#   curl -fsSL https://raw.githubusercontent.com/Julianb233/clapcheeks.tech/main/scripts/authorize-fleet-key.sh | sudo bash
#
# After this, agents on the VPS can SSH into this Mac as whatever user ran
# the script. Tailscale must be active for the VPS to reach the Mac IP.

set -euo pipefail

FLEET_PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINxQChWW+2C12g2UL4iPE14Oaj1y++qqETfQDkEQZWQ3 blake@Ubuntu-2204-jammy-amd64-base"

# Target user = the person who invoked sudo (never root)
TARGET_USER="${SUDO_USER:-$USER}"
if [[ "$TARGET_USER" == "root" ]]; then
  echo "ERROR: must be run with sudo from a regular user account, not as root."
  exit 1
fi

HOME_DIR=$(eval echo "~${TARGET_USER}")
SSH_DIR="${HOME_DIR}/.ssh"
AUTH_KEYS="${SSH_DIR}/authorized_keys"

mkdir -p "$SSH_DIR"
touch "$AUTH_KEYS"
chmod 700 "$SSH_DIR"
chmod 600 "$AUTH_KEYS"
chown -R "$TARGET_USER" "$SSH_DIR"

# Dedupe
if ! grep -qF "$FLEET_PUBKEY" "$AUTH_KEYS" 2>/dev/null; then
  echo "$FLEET_PUBKEY" >> "$AUTH_KEYS"
  echo "Fleet key appended to $AUTH_KEYS"
else
  echo "Fleet key already present in $AUTH_KEYS"
fi

# Make sure sshd is on
if ! systemsetup -getremotelogin 2>/dev/null | grep -qi "On$"; then
  echo "Enabling Remote Login (sshd)..."
  systemsetup -setremotelogin on >/dev/null 2>&1 || \
    launchctl load -w /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true
fi

# Best-effort status
echo
echo "=== Ready ==="
echo "User:       $TARGET_USER"
echo "SSH port:   22"
echo "Tailscale IP (for agents):"
TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
[[ -x "$TS" ]] && "$TS" ip -4 2>/dev/null | head -1 || echo "  (tailscale not at expected path)"
