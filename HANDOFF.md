# HANDOFF — clapcheeks.tech cross-tool state

> **Read this first.** This is the shared handoff line between **Claude Code** and **Cursor**
> working the same initiative. Update the three fields below whenever you switch tools or end
> a session. Protocol: [`AGENTS.md`](./AGENTS.md) → "Cross-tool handoff". Linear: AI-8615.

<!-- HANDOFF_STATE_START -->
Active app: Codex
Last session: 2026-07-30 — shipped reasoned `remove_person_from_cct`; production readback then exposed and fixed a 51-row prefilter that could hide active people behind archived rows; 154/154 tests pass
Next action: merge the active-roster readback hotfix, verify the exact production Vercel revision, then recheck the paired live JuliBoop CCT board without mutating a real contact
<!-- HANDOFF_STATE_END -->

## How to use

- **Switching tools mid-initiative?** Overwrite the three fields in the block above (in place).
- **Picking this repo up cold?** Read the block, then `CLAUDE.md`, then any SOP it cites.
- **Local Mac↔iPhone work?** Follow [`docs/LOCAL_MAC_IPHONE.md`](./docs/LOCAL_MAC_IPHONE.md)
  — Tailscale Serve HTTPS proxy, not raw HTTP on `100.x` (auth breaks otherwise).
- Deeper per-session logs still go to `.planning/` as before; this file is only the pointer.
