#!/bin/bash
# Run from VPS. Pushes the local worker to Mac Mini, configures it, and
# loads the launchd plist so it runs continuously.

set -euo pipefail
HOST="${1:-mac-mini}"
REPO=/opt/agency-workspace/clapcheeks.tech

# 1. Push files
ssh "$HOST" 'mkdir -p ~/clapcheeks ~/.clapcheeks ~/Library/LaunchAgents'
scp -q "$REPO/scripts/mac_local_worker.py" "$HOST:~/clapcheeks/"

# 2. Push config (extract from VPS .env.local + Julian's user_id)
SUPABASE_URL=$(grep '^NEXT_PUBLIC_SUPABASE_URL=' "$REPO/web/.env.local" | cut -d= -f2-)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' "$REPO/web/.env.local" | cut -d= -f2-)
USER_ID="9c848c51-8996-4f1f-9dbf-50128e3408ea"

ssh "$HOST" "cat > ~/.clapcheeks/worker.env" <<EOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SERVICE_KEY}
CLAPCHEEKS_USER_ID=${USER_ID}
OLLAMA_MODEL=llama3.1:8b
OLLAMA_HOST=http://127.0.0.1:11434
TICK_SECONDS=120
VOICE_REFRESH_SECONDS=3600
EOF

# 3. Write the launchd plist
ssh "$HOST" "cat > ~/Library/LaunchAgents/tech.clapcheeks.local-worker.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>tech.clapcheeks.local-worker</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/bin/python3</string>
        <string>/Users/CURRENT_USER/clapcheeks/mac_local_worker.py</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/Users/CURRENT_USER/.clapcheeks/worker.stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/CURRENT_USER/.clapcheeks/worker.stderr.log</string>
    <key>WorkingDirectory</key>
    <string>/Users/CURRENT_USER</string>
</dict>
</plist>
EOF

# Replace placeholder with actual home dir
ssh "$HOST" "perl -i -pe 's|/Users/CURRENT_USER|\$ENV{HOME}|g' ~/Library/LaunchAgents/tech.clapcheeks.local-worker.plist"

# 4. (Re)load
ssh "$HOST" "launchctl unload ~/Library/LaunchAgents/tech.clapcheeks.local-worker.plist 2>/dev/null; launchctl load ~/Library/LaunchAgents/tech.clapcheeks.local-worker.plist"

echo "✓ Installed on $HOST. Tail logs with:"
echo "    ssh $HOST tail -f ~/.clapcheeks/worker.log"
