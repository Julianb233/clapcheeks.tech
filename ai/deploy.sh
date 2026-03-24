#!/usr/bin/env bash
# Deploy AI service to Fly.io
# Prerequisites: flyctl installed, authenticated (flyctl auth login)
# Usage: cd ai && ./deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Syncing clapcheeks package from agent/ into ai/ for Docker build..."
rm -rf clapcheeks
cp -r ../agent/clapcheeks clapcheeks

echo "==> Deploying to Fly.io..."
flyctl deploy --config fly.toml

echo "==> Setting secrets (if not already set)..."
if ! flyctl secrets list | grep -q ANTHROPIC_API_KEY; then
    echo "WARNING: ANTHROPIC_API_KEY not set. Run:"
    echo "  flyctl secrets set ANTHROPIC_API_KEY=your-key-here"
fi

echo "==> Checking health..."
APP_URL=$(flyctl status --json | python3 -c "import sys,json; print(json.load(sys.stdin).get('Hostname',''))" 2>/dev/null || echo "")
if [ -n "$APP_URL" ]; then
    echo "App URL: https://$APP_URL"
    curl -s "https://$APP_URL/health" | python3 -m json.tool || echo "Health check failed (app may still be starting)"
fi

echo "==> Done! Update NEXT_PUBLIC_AI_URL in Vercel:"
echo "  vercel env add NEXT_PUBLIC_AI_URL production <<< 'https://clapcheeks-ai.fly.dev'"
