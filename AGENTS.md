<!-- AI_ACROBATICS_SOURCE_PREFLIGHT_START -->
# AI Acrobatics Agent Contract

Before non-trivial AI Acrobatics work, run the local source preflight:

```bash
~/.ai-acrobatics/agent-preflight/agent-source-preflight.sh --print
```

Use Obsidian as the source router:

```bash
OBSIDIAN_VAULT="${OBSIDIAN_VAULT:-/opt/agency-workspace/obsidian-vault}" /opt/agency-workspace/obsidian-vault/Tools/obsidian-context-router.sh route "<task>"
```

Load the cited MOCs, SOPs, Laws, and project files before editing or debugging. Verify live evidence before reporting status. If blocked, name the exact missing file, auth, service, platform signal, or source-of-truth mismatch. Write durable workflow/source changes back to the vault or memory.
<!-- AI_ACROBATICS_SOURCE_PREFLIGHT_END -->

<!-- CROSS_TOOL_HANDOFF_START -->
## Cross-tool handoff (Cursor ↔ Claude Code) — AI-8615

Real work happens across **both** Claude Code and Cursor on the same initiative. To stop
either surface from being blind to the other's active thread, keep one shared handoff line
current whenever you switch tools mid-initiative.

**Rule:** before you stop a session (or hand off to the other tool), update the block at the
top of [`HANDOFF.md`](./HANDOFF.md):

```
Active app: <Claude Code | Cursor>
Last session: <ISO date> — <one-line what you just did>
Next action: <the single next concrete step for whoever picks this up>
```

- The **first thing** an agent (Cursor or Claude Code) reads when opening this repo is
  `HANDOFF.md`, then `CLAUDE.md` and any cited SOP.
- For the local Mac Mini ↔ iPhone workflow (Tailscale Serve HTTPS proxy), the canonical
  steps live in [`docs/LOCAL_MAC_IPHONE.md`](./docs/LOCAL_MAC_IPHONE.md) — do not
  improvise raw HTTP on `100.x`; auth (Supabase HTTPS redirect) requires the `ts.net` origin.
- Keep it lightweight: one line per field, overwrite in place. Deeper session logs go to
  `.planning/` as before.
<!-- CROSS_TOOL_HANDOFF_END -->
