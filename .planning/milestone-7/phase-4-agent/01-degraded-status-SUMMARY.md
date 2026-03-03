# Phase 4 Plan 01: Daemon Degraded State Surfacing — Summary

**Requirement:** AGENT-01
**Completed:** 2026-03-03
**Commit:** 43d5745

## What Was Done

Implemented per-platform crash tracking with degraded status surfacing to dashboard.

### Changes

1. **Crash tracking in daemon** (`agent/clapcheeks/daemon.py`)
   - Added `worker_crashes` defaultdict tracking crash timestamps per platform
   - 1-hour sliding window with threshold of 3 crashes triggers degraded status
   - `record_worker_crash()` called in platform worker exception handler
   - `push_agent_status()` function pushes status to Supabase `clapcheeks_agent_tokens`

2. **Database migration** (`supabase/migrations/20260303000010_agent_degraded_status.sql`)
   - Added `degraded_platform TEXT` column
   - Added `degraded_reason TEXT` column

3. **Dashboard degraded warning** (`web/app/(main)/dashboard/components/agent-status-badge.tsx`)
   - Component now fetches `agentToken` status alongside device status
   - Shows amber warning banner when status is `degraded`
   - Displays platform name and restart instructions

4. **API route update** (`web/app/api/agent/status/route.ts`)
   - Now fetches `clapcheeks_agent_tokens` in parallel with `devices`
   - Returns `agentToken` object with `status`, `degraded_platform`, `degraded_reason`

## Files Modified

- `agent/clapcheeks/daemon.py` — crash tracking, push_agent_status()
- `supabase/migrations/20260303000010_agent_degraded_status.sql` — NEW
- `web/app/(main)/dashboard/components/agent-status-badge.tsx` — degraded UI
- `web/app/api/agent/status/route.ts` — agent token status fetch

## Deviations from Plan

None — plan executed exactly as written.
