# Clapcheeks Migrations Runbook

**Last updated:** 2026-04-27 (AI-8769)

This runbook documents the canonical migration workflow for Clapcheeks. There is exactly **one** place migrations live: `supabase/migrations/`. Anything else is wrong.

## TL;DR

- New schema change? Write a file in `supabase/migrations/` named `YYYYMMDDHHMMSS_what_it_does.sql`.
- Never put SQL in `web/scripts/`. Never create a `web/supabase/migrations/` directory. Both are deprecated as of AI-8769.
- Test locally with `supabase db reset` (if you have Supabase CLI + Docker), then `supabase db push` to apply to prod. Ops handles the prod push.
- Tables with many ALTERs? Snapshot them under `supabase/schema-snapshots/<table>.sql` so reviewers don't have to grep 13 migrations to know the shape.

## Where migrations live

```
supabase/
├── migrations/                 ← ONLY place for migrations
│   ├── 20240101000001_*.sql     ← old migrations, do not edit
│   ├── ...
│   ├── 20260427190001_legacy_notifications_capture.sql   ← latest as of audit
│   └── .archive/                ← retired migrations (read-only, do not run)
│       └── web-scripts-20260427/
└── schema-snapshots/            ← read-only canonical shape for hot tables
    └── clapcheeks_matches.sql
```

### Deprecated locations (do not use)

- ~~`web/scripts/*.sql`~~ — archived to `supabase/migrations/.archive/web-scripts-20260427/` on 2026-04-27. The 14 SQL files were either superseded by canonical migrations or were dead code. See the archive's `README.md` for the file-by-file mapping.
- ~~`web/supabase/migrations/`~~ — deleted on 2026-04-27. Only ever held one duplicate (stripped-down) `alpha_feedback` migration that was already canonically in `supabase/migrations/`.

## Writing a new migration

### 1. Pick a timestamp

Use a UTC timestamp with second-level precision so it sorts after every prior migration:

```bash
date -u +%Y%m%d%H%M%S
# e.g. 20260427231542
```

### 2. Name the file

`<timestamp>_<snake_case_summary>.sql` — keep it short and descriptive:

```
20260428120000_add_match_archive_reason.sql
20260428130000_create_billing_events.sql
```

### 3. Make it idempotent

Every clause should be safely re-runnable:

| Doing | Use |
|---|---|
| Create a table | `CREATE TABLE IF NOT EXISTS public.foo (...)` |
| Add a column | `ALTER TABLE public.foo ADD COLUMN IF NOT EXISTS bar text` |
| Create an index | `CREATE INDEX IF NOT EXISTS idx_foo_bar ON public.foo(bar)` |
| Create an RLS policy | `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='foo' AND policyname='view own foo') THEN CREATE POLICY "view own foo" ON public.foo FOR SELECT USING ((auth.uid() = user_id)); END IF; END $$;` |
| Add a constraint | wrap in `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='foo_bar_key') THEN ALTER TABLE ... END IF; END $$;` |
| Create a trigger | `DROP TRIGGER IF EXISTS bar ON public.foo; CREATE TRIGGER bar ...` |
| Define a function | `CREATE OR REPLACE FUNCTION ...` |

Idempotent migrations let us re-apply the migration set against a populated DB to fix drift, and let CI run `supabase db reset` repeatedly.

### 4. Avoid timestamp collisions

Multiple devs / agents have hit the same minute before. Use `HHMMSS` precision (not just `HHMM00`). When in doubt, add 1 second. We currently have one collision — `20260420400000_alpha_feedback.sql` and `20260420400000_dunning_and_monitoring.sql` — both `IF NOT EXISTS`-guarded so it works, but it's confusing.

### 5. Reference the Linear issue

First line of every migration:

```sql
-- AI-XXXX: short description of why this migration exists
```

## Testing locally (recommended)

If you have Supabase CLI + Docker:

```bash
cd /opt/agency-workspace/clapcheeks.tech
supabase db reset --local       # nukes and re-applies every migration
psql -h localhost -U postgres -d postgres -c "\d public.foo"
```

If `db reset` fails on your migration but works without it, your migration is broken. Fix it.

## Applying to prod

**This is the ops agent's job, not the feature agent's.** Do NOT push migrations to prod from the feature branch.

The flow:

1. Feature branch: write migration, commit, open PR
2. PR review: another agent reads the migration, checks for destructive ops
3. Merge to `main`
4. Ops agent runs `supabase db push` against prod (or it's auto-applied by CI if we wire that up)
5. Ops agent verifies with a quick `pg_dump --schema-only --table=<tbl>` and confirms shape matches the migration

## Schema snapshots

Some tables (notably `public.clapcheeks_matches`) have been ALTER'd 13+ times. Reading 13 migrations to know the current shape is hostile to reviewers and AI agents.

For any table with more than ~5 ALTER migrations, generate a snapshot:

```bash
PGPASSWORD='<from 1Password>' pg_dump \
  --host=db.oouuoepmkeqdyzsxrnjh.supabase.co \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  --schema-only --no-owner --no-privileges \
  --table=public.<table_name> \
  > supabase/schema-snapshots/<table_name>.sql
```

Then:
- Add a header comment listing every migration that contributed
- Add a `DO NOT RUN THIS FILE` warning
- Commit alongside the migration that pushed it past the threshold
- Re-snapshot whenever a future migration ALTERs that table

Current snapshots:

- `supabase/schema-snapshots/clapcheeks_matches.sql` (regenerate when 5+ new ALTERs land)

## Capturing legacy state

Sometimes prod has tables/columns that aren't in any migration (technical debt from pre-migration days). Examples found during AI-8769:

- `public.users` — exists on prod, used as FK target by `public.notifications`, never tracked in any migration → backfilled by `20260427190000_legacy_users_capture.sql`
- `public.notifications` — exists on prod with a different shape than `web/scripts/001_create_schema.sql` defined → backfilled by `20260427190001_legacy_notifications_capture.sql`

**The pattern:** when you find untracked prod state, write a `*_legacy_<name>_capture.sql` migration that mirrors the LIVE prod schema (use `pg_dump`, don't reconstruct from memory). Make every clause `IF NOT EXISTS` / `DO`-guarded so it's safe against the populated prod DB. This makes `supabase db reset` produce a DB shape that matches prod.

## Audit trail

The full audit that produced this runbook lives at:

- `.planning/migration-audit/inventory.md` — every migration file with what it does
- `.planning/migration-audit/cross-reference.md` — web/scripts → canonical mapping
- `supabase/migrations/.archive/web-scripts-20260427/README.md` — what was archived and why

## Known issues / follow-ups

Open Linear bugs (file via `escalate-bug-to-linear.sh` if not yet tracked):

1. `clapcheeks_matches` has prod columns (`reschedule_count`, `last_reschedule_at`, `last_flake_at`) and triggers (`trg_clapcheeks_matches_preserve_user_intel`) and functions (`clapcheeks_matches_preserve_user_intel`, `clapcheeks_matches_touch_updated_at`) that aren't in any committed migration. Need a `*_backfill_matches_*.sql` migration to capture them.
2. `public.users` is parallel to `auth.users` and `public.profiles`. Long-term we should consolidate. Risk: notifications.user_id FK targets `public.users(id)`.
3. Timestamp collision: `20260420400000_alpha_feedback.sql` and `20260420400000_dunning_and_monitoring.sql`. Re-date one of them on the next quiet window.
4. Duplicate `CREATE TABLE` migrations (all `IF NOT EXISTS`-guarded so they're safe today but confusing): `clapcheeks_swipe_decisions` (autonomy_engine + phase_h_swipe_decisions), `clapcheeks_scheduled_messages` (contact_intelligence + scheduled_messages), `profile_photos` (profile_photos + photo_ai_scoring).
