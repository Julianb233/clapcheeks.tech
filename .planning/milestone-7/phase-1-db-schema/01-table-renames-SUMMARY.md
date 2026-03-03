# Phase 1 Plan 01: Table Name Fixes Summary

**One-liner:** Renamed outward_agent_tokens and consolidated dual analytics_daily tables into clapcheeks_analytics_daily with all app code references updated.

**Requirements:** DB-01, DB-02
**Status:** Complete
**Completed:** 2026-03-03

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Fix outward_agent_tokens -> clapcheeks_agent_tokens | 24b0b40 | supabase/migrations/20260303000001_rename_agent_tokens.sql |
| 2 | Consolidate analytics_daily -> clapcheeks_analytics_daily | 07d7e80 | supabase/migrations/20260303000002_rename_analytics_daily.sql, 6 app code files, types.ts |
| 3 | Scan for remaining outward_ references | N/A | No changes needed — app code clean |

## Key Changes

### Migration 20260303000001: Agent Tokens Rename
- Safety rename of outward_agent_tokens if still exists
- Idempotent RLS policies (select/insert/update/delete)

### Migration 20260303000002: Analytics Daily Consolidation
- Drops old clapcheeks_analytics_daily (from outward rename, less complete schema)
- Renames analytics_daily (migration 009 schema with app column) to clapcheeks_analytics_daily
- Recreates index with clapcheeks prefix
- Adds RLS policies

### App Code Updates
- `web/app/(main)/dashboard/page.tsx` — updated table reference
- `web/app/profile/page.tsx` — updated table reference
- `web/app/api/analytics/summary/route.ts` — updated table reference
- `web/lib/coaching/generate.ts` — updated table reference
- `web/lib/reports/generate-report-data.ts` — updated 2 table references
- `web/app/api/coaching/tips/route.ts` — updated table reference
- `web/lib/supabase/types.ts` — updated clapcheeks_analytics_daily type to migration 009 schema, updated type alias

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Consolidated two analytics tables instead of simple rename**
- **Found during:** Task 2
- **Issue:** Two separate analytics_daily tables existed (one from outward rename, one from migration 009). Simple rename would conflict.
- **Fix:** Drop old clapcheeks_analytics_daily, rename analytics_daily to clapcheeks_analytics_daily
- **Files modified:** Migration file, 7 app code files
- **Commit:** 07d7e80
