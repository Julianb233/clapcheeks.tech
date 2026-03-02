# Outward — AI Dating Co-Pilot

The privacy-first AI dating assistant. Runs locally on your Mac.

**Website:** https://clapcheeks.tech
**GitHub:** https://github.com/Julianb233/clapcheeks.tech

## Quick Install (Mac)

```bash
curl -fsSL https://clapcheeks.tech/install.sh | bash
```

## Repository Structure

| Directory | Purpose |
|-----------|---------|
| `web/` | Next.js 14 marketing site + dashboard (deploys to Vercel) |
| `api/` | Node.js/Express SaaS backend (analytics, auth, billing) |
| `ai/` | Python FastAPI AI service (coaching, reply suggestions) |
| `agent/` | Local CLI agent downloaded by users (runs on their Mac) |
| `.planning/` | GSD project roadmap and phase plans |

## Development

```bash
# Web (Next.js)
cd web && npm install && npm run dev

# API (Node.js)
cd api && npm install && npm run dev

# AI service (Python)
cd ai && pip install -r requirements.txt && uvicorn main:app --reload

# Local agent
cd agent && pip install -e . && outward status
```

## Architecture

Each user downloads the Outward agent to their Mac. The agent reads iMessages, automates dating apps via Playwright, tracks spending, and syncs anonymized metrics to clapcheeks.tech. All personal data stays on the user's device.

See [.planning/ROADMAP.md](.planning/ROADMAP.md) for full milestone breakdown.
