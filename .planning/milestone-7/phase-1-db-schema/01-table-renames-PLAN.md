---
plan: "Table Name Fixes"
phase: "Phase 1: DB Schema Fixes"
wave: 1
autonomous: true
requirements: [DB-01, DB-02]
goal: "Fix the two critical table name mismatches that completely break agent authentication and dashboard analytics"
---

# Plan 01: Table Name Fixes

**Phase:** Phase 1 — DB Schema Fixes
**Requirements:** DB-01, DB-02
**Priority:** P0 (hard blockers)
**Wave:** 1 (runs first)

## Context

Two migrations created tables with old "outward" naming while the codebase references "clapcheeks" names. This means:
- Agent registration fails (no `clapcheeks_agent_tokens` table exists, only `outward_agent_tokens`)
- Dashboard analytics shows nothing (`analytics_daily` exists, code queries `clapcheeks_analytics_daily`)

## Tasks

### Task 1: Fix outward_agent_tokens → clapcheeks_agent_tokens (DB-01)

1. Find the migration file that creates `outward_agent_tokens`
   - `ls supabase/migrations/` and `cat web/scripts/*.sql`
2. Create a new migration: `supabase/migrations/20260303000001_rename_agent_tokens.sql`
   ```sql
   -- Rename outward_agent_tokens to clapcheeks_agent_tokens
   ALTER TABLE IF EXISTS outward_agent_tokens RENAME TO clapcheeks_agent_tokens;
   ```
3. Also check and fix RLS policies referencing the old name:
   ```sql
   -- Drop old policies, recreate with correct table name
   DROP POLICY IF EXISTS "Users can view their own tokens" ON clapcheeks_agent_tokens;
   CREATE POLICY "Users can view their own tokens" ON clapcheeks_agent_tokens
     FOR SELECT USING (auth.uid() = user_id);
   ```
4. Verify no other references to `outward_agent_tokens` remain in codebase:
   - `grep -r "outward_agent_tokens" .`

### Task 2: Fix analytics_daily → clapcheeks_analytics_daily (DB-02)

1. Find the migration creating `analytics_daily`
2. Create a new migration: `supabase/migrations/20260303000002_rename_analytics_daily.sql`
   ```sql
   -- Rename analytics_daily to clapcheeks_analytics_daily
   ALTER TABLE IF EXISTS analytics_daily RENAME TO clapcheeks_analytics_daily;
   ```
3. Verify API code references correct name:
   - `grep -r "analytics_daily" api/` — all should be `clapcheeks_analytics_daily`
4. Verify dashboard queries work after rename

### Task 3: Scan for any other "outward_" table references

1. `grep -r "outward_" supabase/ api/ web/` — catch any remaining old names
2. Fix any found by adding migrations or updating code references

## Acceptance Criteria

- [ ] `clapcheeks_agent_tokens` table exists in Supabase
- [ ] `outward_agent_tokens` no longer exists (or is renamed)
- [ ] `clapcheeks_analytics_daily` table exists
- [ ] `analytics_daily` table renamed
- [ ] `grep -r "outward_agent_tokens"` returns no results in application code
- [ ] Migration files created in `supabase/migrations/`

## Files to Modify

- `supabase/migrations/` — add 2 new migration files
- Possibly `api/` routes if they reference old table names directly
