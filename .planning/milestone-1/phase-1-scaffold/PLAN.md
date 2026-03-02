# Phase 1: Project Scaffold

## Goal
Set up the monorepo structure with Next.js web app, Node.js/Express API, and Python FastAPI AI layer.

## Directory Structure
```
clapcheeks.tech/
  web/          <- Next.js 14 (Vercel)
  api/          <- Node.js/Express (SaaS backend)
  ai/           <- Python FastAPI (AI + automation)
  agent/        <- Local CLI agent (Python, downloaded by users)
  .planning/    <- GSD framework
  PROJECT.md
  README.md
```

## Tasks
- [ ] Initialize Next.js 14 in web/
- [ ] Initialize Node.js/Express in api/
- [ ] Initialize Python FastAPI in ai/
- [ ] Initialize Python CLI in agent/
- [ ] Set up root package.json with workspace scripts
- [ ] Add .gitignore (node_modules, .env, __pycache__, .next)
- [ ] Add root README.md with setup instructions

## Acceptance Criteria
- `cd web && npm run dev` starts Next.js on port 3000
- `cd api && node server.js` starts Express on port 3001
- `cd ai && uvicorn main:app` starts FastAPI on port 8000
- All .env.example files present with documented variables
