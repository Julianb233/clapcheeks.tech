---
plan: "Indexes & Constraints"
phase: "Phase 1: DB Schema Fixes"
wave: 3
autonomous: true
requirements: [DB-03, DB-07, DB-08]
goal: "Add missing performance indexes and a CHECK constraint to prevent invalid status values"
---

# Plan 03: Indexes & Constraints

**Phase:** Phase 1 — DB Schema Fixes
**Requirements:** DB-03, DB-07, DB-08
**Priority:** P1/P2
**Wave:** 3 (after RLS fixes)

## Context

- `clapcheeks_conversation_stats` and `clapcheeks_spending` have no indexes — full table scans on every dashboard load
- `clapcheeks_queued_replies.status` has no CHECK constraint, any string accepted
- Missing composite index on `queued_replies(user_id, status)` causes slow queue lookups

## Tasks

### Task 1: Add indexes on conversation_stats and spending tables (DB-03)

Create migration `supabase/migrations/20260303000006_performance_indexes.sql`:

```sql
-- Index for clapcheeks_conversation_stats
CREATE INDEX IF NOT EXISTS idx_conversation_stats_user_id
  ON clapcheeks_conversation_stats(user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_stats_date
  ON clapcheeks_conversation_stats(date DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_stats_user_date
  ON clapcheeks_conversation_stats(user_id, date DESC);

-- Index for clapcheeks_spending
CREATE INDEX IF NOT EXISTS idx_spending_user_id
  ON clapcheeks_spending(user_id);

CREATE INDEX IF NOT EXISTS idx_spending_date
  ON clapcheeks_spending(date DESC);

CREATE INDEX IF NOT EXISTS idx_spending_user_date
  ON clapcheeks_spending(user_id, date DESC);
```

### Task 2: Add CHECK constraint on queued_replies.status (DB-07)

Add to migration `supabase/migrations/20260303000007_queued_replies_constraints.sql`:

```sql
-- Add CHECK constraint for valid status values
ALTER TABLE clapcheeks_queued_replies
  ADD CONSTRAINT check_valid_status
  CHECK (status IN ('queued', 'sent', 'failed'));
```

Note: If existing rows have invalid status values this will fail. Check first:
```sql
SELECT DISTINCT status FROM clapcheeks_queued_replies;
```
If non-standard values exist, update them first or use `NOT VALID` and validate separately.

### Task 3: Add composite index on queued_replies(user_id, status) (DB-08)

Include in migration `supabase/migrations/20260303000007_queued_replies_constraints.sql`:

```sql
-- Composite index for efficient queue lookups
CREATE INDEX IF NOT EXISTS idx_queued_replies_user_status
  ON clapcheeks_queued_replies(user_id, status);

-- Also useful for web dashboard queries
CREATE INDEX IF NOT EXISTS idx_queued_replies_user_created
  ON clapcheeks_queued_replies(user_id, created_at DESC);
```

## Acceptance Criteria

- [ ] `idx_conversation_stats_user_date` index exists
- [ ] `idx_spending_user_date` index exists
- [ ] `CHECK (status IN ('queued','sent','failed'))` constraint on `clapcheeks_queued_replies`
- [ ] `idx_queued_replies_user_status` composite index exists
- [ ] All migrations apply cleanly without errors
- [ ] Dashboard API query time < 200ms on typical data volume

## Files to Modify

- `supabase/migrations/` — 2 new migration files (20260303000006, 20260303000007)
