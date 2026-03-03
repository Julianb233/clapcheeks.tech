---
plan: "Daemon Degraded State Surfacing"
phase: "Phase 4: Agent Reliability"
wave: 1
autonomous: true
requirements: [AGENT-01]
goal: "Detect silent platform worker crashes and surface degraded status to the dashboard"
---

# Plan 01: Daemon Degraded State Surfacing

**Phase:** Phase 4 — Agent Reliability
**Requirements:** AGENT-01
**Priority:** P0
**Wave:** 1

## Context

Platform worker threads crash silently. The agent status shows "running" in the dashboard but swiping has completely stopped for one or more platforms. User has no idea something is wrong.

The local Python daemon runs in `/opt/agency-workspace/clapcheeks.tech/agent/` (or similar path — check with `find /opt/agency-workspace/clapcheeks.tech -name "daemon.py"`).

## Tasks

### Task 1: Track platform worker crash counts in daemon

1. Find the daemon entry point and platform worker management code
2. Add crash tracking per platform worker:
   ```python
   import time
   from collections import defaultdict

   # Track crash timestamps per platform
   worker_crashes = defaultdict(list)  # platform -> [timestamp, ...]
   CRASH_WINDOW_SECS = 3600  # 1 hour
   CRASH_THRESHOLD = 3       # 3 crashes in window = degraded

   def record_worker_crash(platform: str):
       now = time.time()
       worker_crashes[platform].append(now)
       # Keep only crashes within the window
       worker_crashes[platform] = [t for t in worker_crashes[platform] if now - t < CRASH_WINDOW_SECS]
       crashes_in_window = len(worker_crashes[platform])
       if crashes_in_window >= CRASH_THRESHOLD:
           mark_platform_degraded(platform, crashes_in_window)

   def mark_platform_degraded(platform: str, crash_count: int):
       print(f"[DEGRADED] {platform} worker crashed {crash_count}x in 1 hour — marking degraded")
       # Push status to Supabase so dashboard can show it
       push_agent_status('degraded', affected_platform=platform)
   ```

3. Call `record_worker_crash(platform)` in the exception handler where workers are restarted

### Task 2: Push degraded status to Supabase

1. Create/find the function that pushes agent heartbeat/status:
   ```python
   def push_agent_status(status: str, affected_platform: str = None):
       """Push agent status to Supabase for dashboard visibility."""
       import os
       from supabase import create_client

       supabase = create_client(
           os.environ['SUPABASE_URL'],
           os.environ['SUPABASE_KEY']
       )

       payload = {
           'status': status,  # 'running', 'degraded', 'stopped'
           'updated_at': 'now()',
       }
       if affected_platform:
           payload['degraded_platform'] = affected_platform
           payload['degraded_reason'] = f'{affected_platform} worker crashed 3+ times in 1 hour'

       supabase.table('clapcheeks_agent_tokens').update(payload).eq(
           'device_id', os.environ.get('DEVICE_ID', 'default')
       ).execute()
   ```

2. Ensure `degraded_platform` and `degraded_reason` columns exist on `clapcheeks_agent_tokens`:
   ```sql
   -- Migration: supabase/migrations/20260303000010_agent_degraded_status.sql
   ALTER TABLE clapcheeks_agent_tokens
     ADD COLUMN IF NOT EXISTS degraded_platform TEXT,
     ADD COLUMN IF NOT EXISTS degraded_reason TEXT;
   ```

### Task 3: Show degraded warning in dashboard

File: `web/app/(main)/dashboard/` — find the agent status display

1. Fetch `degraded_platform` and `degraded_reason` from agent token data
2. Show warning banner when status is `degraded`:
   ```tsx
   {agentStatus === 'degraded' && (
     <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 mb-4 flex items-start gap-3">
       <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
       <div>
         <div className="text-amber-400 font-semibold text-sm">Agent Degraded</div>
         <p className="text-white/50 text-xs mt-0.5">
           {degradedPlatform
             ? `${degradedPlatform} automation has crashed repeatedly and may have stopped.`
             : 'A platform worker has crashed repeatedly.'}
         </p>
         <p className="text-white/30 text-xs mt-1">
           Restart your agent with <code className="font-mono">clapcheeks restart</code>
         </p>
       </div>
     </div>
   )}
   ```

## Acceptance Criteria

- [ ] Platform worker crash count tracked per platform with 1-hour sliding window
- [ ] 3+ crashes in 1 hour triggers `mark_platform_degraded()`
- [ ] Degraded status pushed to `clapcheeks_agent_tokens` table
- [ ] `degraded_platform` and `degraded_reason` columns exist
- [ ] Dashboard shows amber warning banner with platform name when status is `degraded`
- [ ] Warning includes restart instructions

## Files to Modify

- `agent/daemon.py` (or equivalent) — crash tracking, degraded status push
- `supabase/migrations/20260303000010_agent_degraded_status.sql` — NEW
- `web/app/(main)/dashboard/page.tsx` or agent status component — degraded warning UI
