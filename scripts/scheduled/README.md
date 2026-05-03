# scripts/scheduled/

VPS-side cron scripts for follow-up tasks. These run on the AI Acrobatics VPS
where 1Password CLI, the `god` Mac wrapper, and the Convex deploy key are all
available — cloud remote agents (the `/schedule` skill) don't have access to
those, so we use local `at`/systemd scheduling instead.

## Active jobs

Run `atq` on the VPS to see scheduled jobs. As of AI-9196 cutover (2026-05-02):

| Script | Fires | Purpose |
|---|---|---|
| `check-convex-token.sh` | ~23h after AI-9196 cutover | Verifies Convex personal access token (`CONVEX-personal-access-token-julian` in 1Password) is still valid; iMessages Julian if expired so he can refresh from `dashboard.convex.dev/auth`. |
| `soak-verify-convex.sh` | 7 days after AI-9196 cutover | Verifies Convex `clapcheeks` deployment health (function count + row counts), asks Julian for YES before dropping deprecated Postgres tables (`clapcheeks_scheduled_messages`, `clapcheeks_agent_jobs`). |

## Re-schedule

If `atd` is restarted or the box reboots before the job fires, re-queue:

```bash
echo /opt/agency-workspace/clapcheeks.tech/scripts/scheduled/check-convex-token.sh | at now + 23 hours
echo /opt/agency-workspace/clapcheeks.tech/scripts/scheduled/soak-verify-convex.sh | at now + 7 days
```

Logs:
- `/opt/agency-workspace/.claude/logs/ai-9196-token-check.log`
- `/opt/agency-workspace/.claude/logs/ai-9196-soak-verify.log`
