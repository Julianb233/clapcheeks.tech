---
plan: "RLS Policies & Schema Conflicts"
phase: "Phase 1: DB Schema Fixes"
wave: 2
autonomous: true
requirements: [DB-04, DB-05, DB-06]
goal: "Fix conflicting profiles schema, restrict profile reads to own row, add update/delete policies for queued replies"
---

# Plan 02: RLS Policies & Schema Conflicts

**Phase:** Phase 1 — DB Schema Fixes
**Requirements:** DB-04, DB-05, DB-06
**Priority:** P1
**Wave:** 2 (after table renames)

## Context

- Two SQL files define the `profiles` table differently — unclear which is authoritative
- Any authenticated user can read any other user's full profile row (data leak)
- Users can queue messages but have no UPDATE/DELETE access to cancel/modify them

## Tasks

### Task 1: Resolve conflicting profiles schema (DB-04)

1. Find all files defining the `profiles` table:
   ```bash
   grep -r "CREATE TABLE.*profiles" supabase/ web/scripts/
   ```
2. Compare the two definitions — note all columns in each
3. Create canonical migration that:
   - Retains ALL columns from both definitions (union)
   - Adds `IF NOT EXISTS` guard or uses `ALTER TABLE ADD COLUMN IF NOT EXISTS` for missing columns
   - Creates file: `supabase/migrations/20260303000003_canonical_profiles.sql`
4. Remove or add a comment to deprecated definition indicating canonical source

### Task 2: Fix public read RLS on profiles table (DB-05)

1. Check current RLS policies on profiles:
   ```bash
   grep -r "profiles" supabase/migrations/ | grep -i "policy\|rls\|using"
   ```
2. Drop any overly permissive policy:
   ```sql
   DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
   DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON profiles;
   ```
3. Add restrictive policy in migration `supabase/migrations/20260303000004_fix_profiles_rls.sql`:
   ```sql
   -- Ensure RLS is enabled
   ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

   -- Only owner can read their profile
   CREATE POLICY "Users can view own profile"
     ON profiles FOR SELECT
     USING (auth.uid() = id);

   -- Only owner can update their profile
   CREATE POLICY "Users can update own profile"
     ON profiles FOR UPDATE
     USING (auth.uid() = id);
   ```
4. Check all web/api code that reads profiles — ensure it only reads authenticated user's own row

### Task 3: Add UPDATE/DELETE policies on clapcheeks_queued_replies (DB-06)

1. Check existing policies:
   ```bash
   grep -r "clapcheeks_queued_replies" supabase/
   ```
2. Create migration `supabase/migrations/20260303000005_queued_replies_rls.sql`:
   ```sql
   -- Add missing UPDATE policy
   CREATE POLICY "Users can update own queued replies"
     ON clapcheeks_queued_replies FOR UPDATE
     USING (auth.uid() = user_id);

   -- Add missing DELETE policy
   CREATE POLICY "Users can delete own queued replies"
     ON clapcheeks_queued_replies FOR DELETE
     USING (auth.uid() = user_id);
   ```
3. Verify INSERT policy exists (user can queue messages)
4. Verify SELECT policy exists (user can read their own queue)

## Acceptance Criteria

- [ ] Single canonical `profiles` table definition with no conflicts
- [ ] `SELECT` on profiles for another user's id returns no rows
- [ ] Users can UPDATE/DELETE their own `clapcheeks_queued_replies` rows
- [ ] Users cannot UPDATE/DELETE another user's queued replies
- [ ] All new migrations created in `supabase/migrations/`

## Files to Modify

- `supabase/migrations/` — 3 new migration files
