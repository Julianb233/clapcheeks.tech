# Phase 3 Plan 02: Plan Field Consolidation Summary

**Requirements:** BILL-03
**Commit:** eac7ceb
**Duration:** ~8 min

## One-liner

Eliminated dual plan/subscription_tier field inconsistency — all code now reads and writes subscription_tier exclusively, with backfill migration for existing rows.

## What Was Done

### Task 1: Audit all usages
- Identified all reads/writes of `plan` field across web/ and api/
- Confirmed API (Express) already uses `subscription_tier` consistently
- Found 5 files in web/ reading the deprecated `plan` field from profiles

### Task 2-4: Update all code paths
- `web/app/api/stripe/webhook/route.ts`: Removed all `plan:` writes, only writes `subscription_tier`
- `web/app/(main)/billing/page.tsx`: Selects and passes `subscription_tier` instead of `plan`
- `web/app/(main)/dashboard/page.tsx`: Reads `subscription_tier` instead of `plan`
- `web/app/onboarding/page.tsx`: Selects and reads `subscription_tier` instead of `plan`
- `web/app/api/billing/route.ts`: Selects and returns `subscription_tier`

### Task 5: Backfill migration
- Created `20260303000009_consolidate_plan_field.sql`
- Backfills `subscription_tier` from `plan` where `subscription_tier IS NULL`
- `plan` column left in place but deprecated (DROP in future migration)

### Task 6: TypeScript types
- Updated `subscription_tier` type to union: `'free' | 'starter' | 'pro' | 'elite' | null`
- Added `access_expires_at` and `trial_end` fields to Profile type
- Marked `plan` field with `@deprecated` JSDoc tag

## Files Changed

| Action | File |
|--------|------|
| Modified | `web/app/api/stripe/webhook/route.ts` |
| Modified | `web/app/(main)/billing/page.tsx` |
| Modified | `web/app/(main)/dashboard/page.tsx` |
| Modified | `web/app/onboarding/page.tsx` |
| Modified | `web/app/api/billing/route.ts` |
| Modified | `web/lib/supabase/types.ts` |
| Created | `supabase/migrations/20260303000009_consolidate_plan_field.sql` |

## Deviations from Plan

- `web/app/profile/page.tsx` reads `subscription?.plan` from `subscriptions` table (not profiles) — left unchanged as it's a different table
- `web/app/(main)/pricing/pricing-client.tsx` uses `tier.plan` which is a UI interface property, not a DB field — left unchanged
