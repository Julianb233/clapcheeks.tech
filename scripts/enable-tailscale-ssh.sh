#!/usr/bin/env bash
# Enable Tailscale SSH on a Mac where the CLI isn't in PATH.
# Safe to re-run. No output on success.

set -euo pipefail

TAILSCALE=""
for p in \
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale" \
  "/usr/local/bin/tailscale" \
  "/opt/homebrew/bin/tailscale"
do
  [[ -x "$p" ]] && { TAILSCALE="$p"; break; }
done

if [[ -z "$TAILSCALE" ]]; then
  echo "ERROR: Tailscale binary not found. Install from https://tailscale.com/download/mac or App Store."
  exit 1
fi

echo "Using: $TAILSCALE"
"$TAILSCALE" set --ssh
echo "Tailscale SSH enabled."
"$TAILSCALE" status | head -3
