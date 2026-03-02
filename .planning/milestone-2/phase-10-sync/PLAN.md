---
phase: 10-sync
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - agent/outward/sync.py
  - agent/outward/queue.py
  - api/routes/analytics.js
  - agent/outward/cli.py
  - agent/outward/session/rate_limiter.py
autonomous: true

must_haves:
  truths:
    - "`outward sync` pushes today's anonymized counts to the API and reports success/failure"
    - "If offline, metrics are queued locally and retried on next sync"
    - "POST /api/analytics/sync accepts per-platform daily rows with conversations_started, dates_booked, money_spent"
    - "Background daemon calls sync every hour automatically"
    - "`outward status` shows last sync time and pending queue count"
    - "NO personal data (names, messages, match details) ever leaves the device"
  artifacts:
    - path: "agent/outward/sync.py"
      provides: "Sync engine — collects local stats, POSTs per-platform rows to API"
    - path: "agent/outward/queue.py"
      provides: "Offline queue — persists failed syncs to disk, retries with backoff"
    - path: "api/routes/analytics.js"
      provides: "POST /api/analytics/sync endpoint with full field support"
  key_links:
    - from: "agent/outward/sync.py"
      to: "agent/outward/session/rate_limiter.py"
      via: "get_daily_summary() and get_daily_spend()"
    - from: "agent/outward/sync.py"
      to: "api/routes/analytics.js"
      via: "POST /api/analytics/sync with Bearer token"
    - from: "agent/outward/queue.py"
      to: "agent/outward/sync.py"
      via: "queue_sync() called on network failure, flush_queue() called on success"
    - from: "agent/outward/cli.py"
      to: "agent/outward/sync.py"
      via: "outward sync command and daemon loop"
---

<objective>
Phase 10: Cloud Sync — push ONLY anonymized aggregate metrics from the local agent to the clapcheeks.tech API.

Purpose: Users' dating activity stats (swipe counts, match counts, spend totals) sync to their cloud dashboard for analytics. Privacy is absolute — no names, messages, or personal data ever leave the device. Only integer counts and dollar totals per platform per day.

Output: Working `outward sync` command, offline queue with retry, updated API endpoint, background daemon sync, and sync status in `outward status`.
</objective>

<context>
@.planning/ROADMAP.md
@.planning/milestone-2/README.md
@agent/outward/cli.py — existing CLI with stub `sync` command (lines 170-198) and `status` command (lines 39-74)
@agent/outward/config.py — config loader, agent_token storage, api_url default
@agent/outward/session/rate_limiter.py — get_daily_summary() returns {platform_direction: count}, get_daily_spend() returns {platform: dollars}
@api/routes/analytics.js — existing POST /analytics/sync and GET /analytics/summary
@api/server.js — validateAgentToken middleware, Supabase client
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create sync engine and offline queue</name>
  <files>
    agent/outward/sync.py
    agent/outward/queue.py
  </files>
  <action>
**agent/outward/sync.py** — Sync engine module:

1. `collect_daily_metrics() -> list[dict]` — Reads local state to build per-platform sync payloads:
   - Call `get_daily_summary()` from `rate_limiter.py` — returns `{"tinder_right": 5, "tinder_left": 12, "bumble_right": 3, ...}`
   - Call `get_daily_spend()` from `rate_limiter.py` — returns `{"tinder": 4.99, "bumble": 2.99, ...}`
   - Group by platform (tinder/bumble/hinge). For each platform with any activity, build:
     ```python
     {
         "platform": "tinder",
         "date": "2026-03-01",  # today's date
         "swipes_right": counts.get("tinder_right", 0),
         "swipes_left": counts.get("tinder_left", 0),
         "matches": counts.get("tinder_matches", 0),
         "conversations_started": counts.get("tinder_conversations", 0),
         "dates_booked": counts.get("tinder_dates", 0),
         "money_spent": spend.get("tinder", 0.0),
     }
     ```
   - Return list of platform dicts (only platforms with activity)

2. `push_metrics(config: dict) -> tuple[int, int]` — POSTs each platform row to API:
   - For each row from `collect_daily_metrics()`:
     - POST to `{api_url}/analytics/sync` with `Authorization: Bearer {agent_token}`
     - On success (200): count as synced
     - On network error / non-200: call `queue_sync(row)` from queue.py, count as queued
   - Before pushing new metrics, call `flush_queue(config)` to retry any queued items
   - Return (synced_count, queued_count)
   - Use `requests` library with timeout=10

3. `get_last_sync_time() -> str | None` — Read last successful sync timestamp from `~/.outward/sync_state.json`

4. `record_sync_time()` — Write current ISO timestamp to `~/.outward/sync_state.json`

**agent/outward/queue.py** — Offline queue with retry:

1. Queue file: `~/.outward/sync_queue.json` — JSON list of pending payloads
2. `queue_sync(payload: dict) -> None` — Append payload to queue file. Deduplicate by (platform, date) — if same platform+date already queued, replace with newer payload.
3. `flush_queue(config: dict) -> int` — Try to POST each queued item to API. Remove successes, keep failures. Return count of successfully flushed items. Use exponential backoff metadata: each queued item gets a `retry_count` field, skip items where `retry_count > 10`.
4. `get_queue_size() -> int` — Return number of pending items in queue.
5. All file operations use atomic write (write to .tmp then rename) to avoid corruption.
  </action>
  <verify>
    - `python -c "from outward.sync import collect_daily_metrics; print(collect_daily_metrics())"` returns list of dicts (empty if no activity today)
    - `python -c "from outward.queue import get_queue_size; print(get_queue_size())"` returns 0
    - Both modules import cleanly with no errors
  </verify>
  <done>
    sync.py collects per-platform metrics from local state and POSTs to API. queue.py persists failed syncs and retries them. No personal data (messages, names, match details) appears in any payload.
  </done>
</task>

<task type="auto">
  <name>Task 2: Update API endpoint and wire CLI commands</name>
  <files>
    api/routes/analytics.js
    agent/outward/cli.py
  </files>
  <action>
**api/routes/analytics.js** — Extend POST /analytics/sync:

The existing endpoint (line 7-28) already handles: platform, date, swipes_right, swipes_left, matches, messages_sent, dates_booked. It upserts to `outward_analytics_daily`.

Add support for two missing fields from the phase 10 spec:
- `conversations_started` — extract from req.body, default to 0, include in upsert
- `money_spent` — extract from req.body, default to 0.0, include in upsert

Update the upsert object to include:
```javascript
conversations_started: conversations_started || 0,
money_spent: money_spent || 0,
```

Also update the destructuring on line 8 to include `conversations_started` and `money_spent`.

Do NOT change the GET /analytics/summary endpoint — that's Phase 16 work.

**agent/outward/cli.py** — Replace stub sync command and update status:

1. Replace the existing `sync` command (lines 170-198) with:
   ```python
   @main.command()
   def sync():
       """Sync today's anonymized metrics to your dashboard."""
       from outward.sync import push_metrics, get_last_sync_time, record_sync_time
       from outward.queue import get_queue_size

       config = load_config()
       if not config.get("agent_token"):
           console.print("[yellow]Not connected. Run [cyan]outward setup[/cyan] first.[/yellow]")
           return

       with console.status("[bold green]Syncing metrics...[/bold green]"):
           synced, queued = push_metrics(config)

       if synced > 0:
           record_sync_time()
           console.print(f"[green]Synced {synced} platform(s) to dashboard.[/green]")
       if queued > 0:
           console.print(f"[yellow]{queued} platform(s) queued (offline). Will retry next sync.[/yellow]")
       if synced == 0 and queued == 0:
           console.print("[dim]No activity to sync today.[/dim]")

       pending = get_queue_size()
       if pending > 0:
           console.print(f"[dim]{pending} item(s) pending in offline queue.[/dim]")
   ```

2. Update the `status` command (lines 39-74) to show sync info after the daily stats section:
   - Import `get_last_sync_time` from `outward.sync` and `get_queue_size` from `outward.queue`
   - After the daily stats table, add:
     ```python
     # Sync status
     last_sync = get_last_sync_time()
     pending = get_queue_size()
     sync_line = f"[dim]{last_sync or 'never'}[/dim]"
     if pending > 0:
         sync_line += f" [yellow]({pending} queued)[/yellow]"
     console.print(f"  Sync:    {sync_line}")
     ```

3. Add daemon command for background hourly sync:
   ```python
   @main.command()
   @click.option("--interval", default=3600, help="Sync interval in seconds.")
   def daemon(interval):
       """Run background sync daemon (every hour by default)."""
       import time as _time
       from outward.sync import push_metrics, record_sync_time

       config = load_config()
       if not config.get("agent_token"):
           console.print("[yellow]Not connected. Run [cyan]outward setup[/cyan] first.[/yellow]")
           return

       console.print(f"[bold green]Sync daemon started[/bold green] (every {interval}s)")
       console.print("[dim]Press Ctrl+C to stop.[/dim]")

       while True:
           try:
               synced, queued = push_metrics(config)
               if synced > 0:
                   record_sync_time()
               ts = __import__("datetime").datetime.now().strftime("%H:%M")
               console.print(f"  [{ts}] synced={synced} queued={queued}")
           except Exception as e:
               console.print(f"  [red]Sync error:[/red] {e}")
           _time.sleep(interval)
   ```
  </action>
  <verify>
    - `node -e "import('./api/routes/analytics.js')"` loads without syntax error
    - `python -c "from outward.cli import main"` imports cleanly
    - `outward sync --help` shows the sync command help text
    - `outward daemon --help` shows daemon command with --interval option
    - `outward status --help` works
  </verify>
  <done>
    API accepts conversations_started and money_spent fields. `outward sync` uses the sync engine (not inline requests). `outward daemon` runs hourly background sync. `outward status` shows last sync time and queue depth. All payloads contain only aggregate counts — no personal data.
  </done>
</task>

</tasks>

<verification>
1. **Privacy audit**: grep all new files for any reference to messages, names, conversations content, match names — must find NONE. Only integer counts and dollar amounts leave the device.
2. **Offline resilience**: Disconnect network, run `outward sync` — should queue gracefully. Reconnect, run `outward sync` — should flush queue.
3. **API roundtrip**: POST a test payload to `/analytics/sync` with valid token — verify row appears in Supabase `outward_analytics_daily` with all fields including conversations_started and money_spent.
4. **Idempotency**: Run `outward sync` twice — the upsert (onConflict: user_id,date,platform) should update, not duplicate.
5. **Status display**: Run `outward status` — should show sync time and queue count alongside daily stats.
</verification>

<success_criteria>
- `outward sync` pushes today's per-platform metrics to API and prints confirmation
- `outward daemon --interval 60` runs continuous sync loop
- `outward status` shows last sync time and pending queue count
- Offline sync attempts queue to `~/.outward/sync_queue.json` and retry on next run
- API POST /analytics/sync accepts and stores conversations_started and money_spent
- Zero personal data (messages, names, photos, match details) in any sync payload
</success_criteria>

<output>
After completion, create `.planning/milestone-2/phase-10-sync/SUMMARY.md`
</output>
