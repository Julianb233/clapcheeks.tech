# HANDOFF — clapcheeks.tech cross-tool state

> **Read this first.** This is the shared handoff line between **Claude Code** and **Cursor**
> working the same initiative. Update the three fields below whenever you switch tools or end
> a session. Protocol: [`AGENTS.md`](./AGENTS.md) → "Cross-tool handoff". Linear: AI-8615.

<!-- HANDOFF_STATE_START -->
Active app: Claude Code
Last session: 2026-07-09 — AI-8615: shipped canonical Mac Mini↔iPhone Tailscale Serve runbook (docs/LOCAL_MAC_IPHONE.md) + this cross-tool handoff layer
Next action: On the Mac Mini (currently SSH-unreachable), run the AC3 device-verify checklist in docs/LOCAL_MAC_IPHONE.md — `npm run dev`, `tailscale serve --bg http://127.0.0.1:<port>`, add the ts.net origin to Supabase Redirect URLs, open on iPhone, confirm login + one critical path
<!-- HANDOFF_STATE_END -->

## How to use

- **Switching tools mid-initiative?** Overwrite the three fields in the block above (in place).
- **Picking this repo up cold?** Read the block, then `CLAUDE.md`, then any SOP it cites.
- **Local Mac↔iPhone work?** Follow [`docs/LOCAL_MAC_IPHONE.md`](./docs/LOCAL_MAC_IPHONE.md)
  — Tailscale Serve HTTPS proxy, not raw HTTP on `100.x` (auth breaks otherwise).
- Deeper per-session logs still go to `.planning/` as before; this file is only the pointer.
