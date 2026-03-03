# Phase 1 Plan 02: RLS Policies & Schema Conflicts Summary

**One-liner:** Canonical profiles schema migration, restricted profile reads to own-row, added UPDATE/DELETE policies on queued replies.

**Requirements:** DB-04, DB-05, DB-06
**Status:** Complete
**Completed:** 2026-03-03

## Tasks Completed

| Task | Description | Commit | Files |
|------|-------------|--------|-------|
| 1 | Resolve conflicting profiles schema | c91c9bd | supabase/migrations/20260303000003_canonical_profiles.sql |
| 2 | Fix public read RLS on profiles | bc9e1fc | supabase/migrations/20260303000004_fix_profiles_rls.sql |
| 3 | Add UPDATE/DELETE policies on queued_replies | 2f46b9d | supabase/migrations/20260303000005_queued_replies_rls.sql |

## Key Changes

### Migration 20260303000003: Canonical Profiles
- Ensures ALL columns from scripts/001, scripts/004, and migrations 001/005/011/012 exist
- Uses ADD COLUMN IF NOT EXISTS for idempotency
- Adds: display_name, bio, profile_image_url, phone, date_of_birth, city, country, role, and all subscription/referral columns

### Migration 20260303000004: Profiles RLS Fix
- Drops `profiles_select_all` policy (USING true) — security vulnerability
- Drops `profiles_delete_own` — profiles cascade from auth.users
- Ensures own-row SELECT, UPDATE, INSERT policies exist
- Admin pages unaffected (use service role client)

### Migration 20260303000005: Queued Replies RLS
- Adds UPDATE policy (users can modify own queued messages)
- Adds DELETE policy (users can cancel own queued messages)
- Both use auth.uid() = user_id guard

## Deviations from Plan

None — plan executed exactly as written.
