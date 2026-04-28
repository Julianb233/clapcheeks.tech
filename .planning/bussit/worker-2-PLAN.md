# AI-8767 — Replace Mac Service-Role Key with Scoped User JWT

## Problem

Every operator Mac holds `SUPABASE_SERVICE_KEY` (service-role) in `~/.clapcheeks/.env`.
Service-role bypasses ALL Row-Level Security. One compromised consumer Mac = all users' data exposed.

## Surface Area

Files currently using `SUPABASE_SERVICE_KEY` / service-role on the Mac side:

| File | Operation | Fix |
|------|-----------|-----|
| `agent/clapcheeks/sync.py` | `push_metrics_supabase()` — upsert operator's own daily stats | User JWT |
| `agent/clapcheeks/sync.py` | `_load_supabase_env()` — loads key from `.env` | Replace key with user JWT session |
| `agent/clapcheeks/daemon.py` | `push_agent_status()` — update operator's own agent token row | User JWT |
| `agent/clapcheeks/scoring.py` | `load_persona()` — fetch operator's own persona | User JWT |
| `agent/clapcheeks/roster/health.py` | health check on operator's matches | User JWT |
| `agent/clapcheeks/imessage/notification_poller.py` | iMessage notifications for operator | User JWT |
| `agent/clapcheeks/imessage/queue_poller.py` | queue polling for operator | User JWT |
| `agent/clapcheeks/job_queue.py` | cross-user job management | **Keep service-role — server-side only** |
| `agent/clapcheeks/match_sync.py` | multi-user match sync | **Keep service-role — VPS/daemon only** |

## Plan

1. **New `agent/clapcheeks/supabase_client.py`** — canonical user-JWT Supabase client factory.
   - `get_user_client()` → returns a `supabase-py` Client authenticated with the operator's user JWT.
   - Reads `SUPABASE_ANON_KEY` + `SUPABASE_USER_ACCESS_TOKEN` + `SUPABASE_USER_REFRESH_TOKEN` from env / `~/.clapcheeks/.env`.
   - Refreshes token automatically when it expires (calls `auth.refresh_session()`).
   - Caches the client in a module-level singleton; thread-safe via a lock.
   - `get_service_client()` → ONLY called from `job_queue.py` / `match_sync.py`. Asserts we are NOT running as a single-user Mac process.

2. **Refactor `agent/clapcheeks/sync.py`** — `_load_supabase_env()` returns `(url, anon_key)` tuple; `push_metrics_supabase()` uses `get_user_client()` instead of `create_client(url, service_key)`.

3. **Refactor daemon / scoring / health / pollers** — swap `_load_supabase_env()` calls that use the service key with `get_user_client()`.

4. **RLS migration** — add upsert (INSERT+UPDATE) policy for `clapcheeks_analytics_daily` under `auth.uid() = user_id` if missing. (Already exists per migration 20260303000002, confirming user JWT will work.)

5. **Update `.env.example`** — remove `SUPABASE_SERVICE_KEY`; add `SUPABASE_ANON_KEY`, `SUPABASE_USER_ACCESS_TOKEN`, `SUPABASE_USER_REFRESH_TOKEN`.

6. **Update daemon `REQUIRED_ENV_VARS`** — swap `SUPABASE_SERVICE_KEY` → `SUPABASE_ANON_KEY` + `SUPABASE_USER_ACCESS_TOKEN`.

7. **Unit tests** — `agent/tests/test_supabase_client.py` covering token refresh, expired-token retry, missing-env error.

8. **Migration note** — `agent/README.md` upgrade section on rotating away the service key.

## Scope Boundary

- `job_queue._client()` and `match_sync.sync_matches()` are multi-user / cross-user operations.
  They legitimately need service-role BUT run on the operator's local daemon process against their
  own user's data path. The real fix is to move them behind an API endpoint — that is a larger
  refactor tracked separately. For this PR we document them clearly with `# FIXME: AI-8767` and
  leave them unchanged. The critical win is removing service-role from `sync.py` (daily metrics),
  `daemon.push_agent_status()`, `scoring.load_persona()`, and the pollers — the highest-frequency
  Mac-side writes.
