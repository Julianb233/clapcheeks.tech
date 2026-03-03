---
plan: "Plan Field Consolidation"
phase: "Phase 3: Billing Completion"
wave: 2
autonomous: true
requirements: [BILL-03]
goal: "Eliminate the plan vs subscription_tier dual-field inconsistency across Next.js, Express, and DB"
---

# Plan 02: Plan Field Consolidation

**Phase:** Phase 3 — Billing Completion
**Requirements:** BILL-03
**Priority:** P1
**Wave:** 2 (after payment lifecycle)

## Context

Two fields store the subscription level:
- `plan` — set by Next.js webhook handler
- `subscription_tier` — set by Express, read by plan-gating middleware

This causes billing UI to show correct plan while API enforces wrong tier (or vice versa). Must converge to one field.

## Tasks

### Task 1: Audit all usages of both fields

1. Find all reads/writes of `plan` field:
   ```bash
   grep -r "\.plan\b\|\"plan\"\|'plan'" web/app/ api/src/ --include="*.ts" --include="*.tsx" --include="*.js"
   ```

2. Find all reads/writes of `subscription_tier` field:
   ```bash
   grep -r "subscription_tier" web/app/ api/src/ --include="*.ts" --include="*.tsx" --include="*.js"
   ```

3. Document which direction each file reads/writes — map all touchpoints.

### Task 2: Decide canonical field name

- **Decision: use `subscription_tier`** (already used by Express plan-gating middleware and is more descriptive)
- `plan` field will be deprecated

### Task 3: Update Next.js webhook to write `subscription_tier` (not `plan`)

File: `web/app/api/stripe/webhook/route.ts`

Find all `update({ plan: ... })` calls and change to `update({ subscription_tier: ... })`:
```typescript
// Before:
await supabase.from('profiles').update({ plan: tier }).eq('stripe_customer_id', customerId)

// After:
await supabase.from('profiles').update({ subscription_tier: tier }).eq('stripe_customer_id', customerId)
```

### Task 4: Update all web UI components to read `subscription_tier`

Search for components that read `profile.plan` or `user.plan`:
- Billing page
- Dashboard plan display
- `EliteOnly` / `ProOnly` components
- Pricing page current plan indicator

Change all to read `profile.subscription_tier`.

### Task 5: Add migration to backfill and remove old `plan` column

```sql
-- Migration: supabase/migrations/20260303000009_consolidate_plan_field.sql

-- Backfill subscription_tier from plan where subscription_tier is null
UPDATE profiles
  SET subscription_tier = plan
  WHERE subscription_tier IS NULL AND plan IS NOT NULL;

-- Optional: drop plan column after confirming all code updated
-- ALTER TABLE profiles DROP COLUMN IF EXISTS plan;
-- NOTE: Only run DROP after verifying all code references are updated
```

Add a comment noting the `plan` column is deprecated — do the DROP only when verified safe.

### Task 6: Update TypeScript types

File: `web/types/` or wherever profile types are defined:
```typescript
interface Profile {
  // ...
  subscription_tier: 'free' | 'starter' | 'pro' | 'elite'
  // plan: string  // DEPRECATED — use subscription_tier
}
```

## Acceptance Criteria

- [ ] `plan` field no longer written by any code path
- [ ] All UI components read `subscription_tier`
- [ ] Express plan-gating reads `subscription_tier`
- [ ] Next.js Stripe webhook writes `subscription_tier`
- [ ] Migration created to backfill existing rows
- [ ] TypeScript types updated to only reference `subscription_tier`
- [ ] No TypeScript errors from removed `plan` references

## Files to Modify

- `web/app/api/stripe/webhook/route.ts` — write `subscription_tier`
- `web/app/(main)/billing/` — read `subscription_tier`
- `web/app/(main)/dashboard/` — read `subscription_tier`
- `web/components/` — update `EliteOnly`/`ProOnly` components
- `api/src/middleware/requirePlan.js` — confirm reads `subscription_tier`
- `supabase/migrations/20260303000009_consolidate_plan_field.sql` — NEW
