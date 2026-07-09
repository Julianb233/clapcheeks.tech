# LOCAL — Mac Mini ↔ iPhone over Tailscale Serve (canonical runbook)

> **Canonical source of truth for the "run it locally on the Mac Mini and open it on my
> iPhone" workflow.** Read this before improvising HTTP-on-`100.x` tunnels. Any agent —
> **Cursor or Claude Code** — must follow the same steps here so answers stop being blind
> to the active thread. Companion: [`../AGENTS.md`](../AGENTS.md) cross-tool handoff block.
>
> Linear: **AI-8615** — "[Escalation] Cursor ↔ Claude Code continuity + SafeMove local".

## Why Tailscale Serve (not raw HTTP on `100.x`)

Opening `http://100.x.x.x:3000` from the iPhone "works" but breaks the moment auth is
involved:

- **Supabase Auth** (login / OAuth / password reset) requires an **HTTPS** origin and
  that exact origin listed in the project's **Redirect URLs**. A bare `http://100.x:3000`
  origin is not HTTPS and won't be an allowed redirect, so login silently fails on device.
- Service workers / PWA install (`@ducanh2912/next-pwa`) require a secure context (HTTPS).
- Cookies marked `Secure` (Supabase session cookies) are dropped over plain HTTP.

**Tailscale Serve** gives you a real `https://<host>.<tailnet>.ts.net` origin with a valid
cert, reverse-proxied to your local dev server — no public exposure, only devices on the
tailnet can reach it. That single stable HTTPS origin is what you register in Supabase once.

## Architecture

```
┌─────────────────────────┐         Tailscale tailnet (WireGuard)         ┌──────────────┐
│  Mac Mini (thewizzard)   │                                              │   iPhone     │
│                          │   tailscale serve --bg http://127.0.0.1:3000 │ (Tailscale   │
│  next dev  ──► :3000     │◄────────── HTTPS reverse proxy ──────────────►│  app ON)     │
│  (web/, Next.js)         │      https://<mac-mini>.<tailnet>.ts.net      │              │
│                          │                                              │  Safari opens│
│  python runner ► :8000   │                                              │  the ts.net  │
└───────────┬──────────────┘                                              │  URL         │
            │                                                             └──────────────┘
            │ Supabase Auth (HTTPS + Redirect URL must list ts.net origin)
            ▼
   https://oouuoepmkeqdyzsxrnjh.supabase.co   ──►  Convex (dating-engine data)
```

## Ports (this repo)

| Process | Command | Port | Notes |
|---|---|---|---|
| Web (Next.js) | `npm run dev` in `web/` | **3000** | `next dev` default. The PM2 service (`ecosystem.config.cjs`) pins `PORT=3001`; a manual `npm run dev` uses 3000 unless you `PORT=3001 npm run dev`. **Serve whichever port the dev server actually prints.** |
| Python runner | `main:app --host 127.0.0.1 --port 8000` | 8000 | Only needed for runner-backed flows. |

## Step-by-step

### 1. On the Mac Mini — start the dev server

```bash
cd /opt/agency-workspace/clapcheeks.tech/web   # or the local checkout path on the Mac
npm install                                    # first run only
npm run dev                                     # note the port it prints (usually 3000)
```

### 2. On the Mac Mini — expose it over Tailscale Serve

```bash
# If the tailscale CLI isn't on PATH, enable/locate it first:
bash /opt/agency-workspace/clapcheeks.tech/scripts/enable-tailscale-ssh.sh   # also confirms the binary

# Reverse-proxy the local dev server over HTTPS on the tailnet.
# Use the SAME port the dev server printed in step 1.
tailscale serve --bg http://127.0.0.1:3000

# Print the exact HTTPS origin to hand to the iPhone + Supabase:
tailscale serve status
```

`tailscale serve status` prints the `https://<mac-mini>.<tailnet>.ts.net` URL. Copy it
verbatim — that exact string is your Serve origin.

To stop serving later: `tailscale serve --https=443 off` (or `tailscale serve reset`).

### 3. One-time — allow the Serve origin in Supabase Auth

Supabase project: `oouuoepmkeqdyzsxrnjh` (`https://oouuoepmkeqdyzsxrnjh.supabase.co`).

Dashboard → **Authentication → URL Configuration → Redirect URLs** → add the exact origin:

```
https://<mac-mini>.<tailnet>.ts.net
https://<mac-mini>.<tailnet>.ts.net/**
```

(Also set / include it under **Site URL** if you want it to be the default redirect while
testing on device.) The `ts.net` hostname is stable per machine, so this is a one-time add.

### 4. On the iPhone — open and verify

1. Ensure the **Tailscale app is ON** (connected to the same tailnet).
2. Open Safari → paste the `https://<mac-mini>.<tailnet>.ts.net` URL.
3. Confirm the padlock (valid HTTPS cert — Tailscale issues it).
4. **Log in.** If login bounces, the Serve origin is not yet in Supabase Redirect URLs (step 3).
5. Exercise one critical path — e.g. join **B2B3** / join group / open the ops dashboard.

### 5. (Optional) Browser E2E

When Supabase E2E users are wired into `.env.local`, run the browser smoke against the
Serve origin (test scripts live on the dashboard checkout; this canonical repo uses
`npm test` / `vitest` for unit coverage). Point any Playwright/Stagehand base URL at the
`ts.net` origin, not `localhost`, so auth cookies behave like the device.

## Verification checklist (AI-8615 AC3)

- [ ] Mac Mini reachable on the tailnet (`tailscale status`)
- [ ] `npm run dev` up; note the port
- [ ] `tailscale serve --bg http://127.0.0.1:<port>` active; `tailscale serve status` shows the ts.net URL
- [ ] Supabase Redirect URLs include the exact `https://…ts.net` origin
- [ ] iPhone (Tailscale ON) loads the ts.net URL with a valid cert
- [ ] Login succeeds on device
- [ ] One critical path completes (join B2B3 / join group / ops dashboard)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| iPhone can't reach the URL at all | Tailscale off on phone, or Mac Mini offline | Toggle Tailscale on the phone; `tailscale status` on the Mac |
| Loads but login fails / bounces to error | Serve origin not in Supabase Redirect URLs | Add the exact `ts.net` origin (step 3) — trailing `/**` too |
| `tailscale: command not found` | CLI not on PATH | `scripts/enable-tailscale-ssh.sh`, or use the app binary at `/Applications/Tailscale.app/Contents/MacOS/Tailscale` |
| Cert warning | Serving over `http://` target is fine — the *front* is HTTPS. A cert warning means you opened the raw `100.x` HTTP URL, not the ts.net one | Use the `ts.net` URL from `tailscale serve status` |
| Page loads but data is empty | Convex env not set for the dev server | Confirm Convex URL in `web/.env.local`; Convex is the dating-engine data store (see `CLAUDE.md`) |

## References

- Tailscale Serve: https://tailscale.com/kb/1242/tailscale-serve
- Repo data rules / architecture: [`../CLAUDE.md`](../CLAUDE.md)
- Cross-tool handoff protocol: [`../AGENTS.md`](../AGENTS.md)
- Live handoff state: [`../HANDOFF.md`](../HANDOFF.md)
