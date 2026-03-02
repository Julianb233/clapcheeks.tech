# Database Audit Report

**Date:** 2026-03-02
**Auditor:** database-engineer
**Scope:** All migrations (`supabase/migrations/`), SQL scripts (`web/scripts/`), and app code cross-reference

---

## Table Inventory

### From Supabase Migrations (supabase/migrations/)

| Table | Migration | Purpose |
|-------|-----------|---------|
| `profiles` | 001, 002, 005, 006 | User profiles with subscription, onboarding, referral fields |
| `clapcheeks_agent_tokens` | 002 (as outward_*), renamed in 004 | Registered agent devices per user |
| `clapcheeks_sessions` | 002, renamed 004 | Swiping session tracking |
| `clapcheeks_matches` | 002, renamed 004 | Match tracking per platform |
| `clapcheeks_conversations` | 002, renamed 004 | Conversation tracking |
| `clapcheeks_analytics_daily` | 002, renamed 004 | Daily metrics per user per platform |
| `devices` | 009 | Registered local agents per user |
| `analytics_daily` | 009 | Daily metrics per user per app (tinder/bumble/hinge) |
| `ai_suggestions` | 009 | AI coaching suggestions |
| `clapcheeks_subscriptions` | 009 | Stripe subscription tracking |
| `clapcheeks_referrals` | 006 | Referral tracking |
| `clapcheeks_opener_log` | 007 | AI-generated opener tracking |
| `clapcheeks_conversation_events` | 007 | Conversation stage progressions |
| `clapcheeks_agent_events` | 008 | Agent event log |
| `clapcheeks_push_tokens` | 008 | Push notification tokens |
| `clapcheeks_photo_scores` | 010 | Photo scoring results |

### From Web Scripts (web/scripts/)

| Table | Script | Purpose |
|-------|--------|---------|
| `profiles` (extra columns) | 001, 002, 004, 010 | Additional profile fields |
| `events` | 001 | Sports events (LEGACY - wrong project) |
| `event_participants` | 001 | Event participation (LEGACY) |
| `groups` | 001 | Sports groups (LEGACY) |
| `group_members` | 001 | Group membership (LEGACY) |
| `notifications` | 001 | User notifications (LEGACY) |
| `stripe_events` | 005 | Stripe webhook idempotency |
| `clapcheeks_conversation_stats` | 005_analytics_extended | Conversation analytics per day/platform |
| `clapcheeks_spending` | 005_analytics_extended | Spending tracker |
| `clapcheeks_coaching_sessions` | 006 | AI coaching sessions |
| `clapcheeks_tip_feedback` | 006 | Coaching tip feedback |
| `clapcheeks_voice_profiles` | 007 | User voice/tone profiles for AI |
| `clapcheeks_reply_suggestions` | 007 | AI reply suggestions |
| `clapcheeks_usage_daily` | 008 | Daily usage limit tracking |
| `clapcheeks_weekly_reports` | 009 | Weekly report storage |
| `clapcheeks_report_preferences` | 009 | Report delivery preferences |
| `clapcheeks_referrals` | 010 | Referrals (DUPLICATE - conflicts with migration 006) |
| `clapcheeks_affiliate_applications` | 011 | Affiliate program applications |
| `clapcheeks_queued_replies` | 012 | Queued AI replies |
| `clapcheeks_device_codes` | 013 | Device pairing codes |

---

## RLS Coverage Map

| Table | RLS Enabled | SELECT | INSERT | UPDATE | DELETE | Notes |
|-------|:-----------:|:------:|:------:|:------:|:------:|-------|
| `profiles` | Yes | Own | Own | Own | Own (script 001) | Migration 001 has select+update only; script 001 adds insert+delete |
| `clapcheeks_agent_tokens` | Yes | Own | Own | Own | Own | Full coverage |
| `clapcheeks_sessions` | Yes | Own | Own | Own | - | Missing DELETE |
| `clapcheeks_matches` | Yes | Own | Own | Own | - | Missing DELETE |
| `clapcheeks_conversations` | Yes | Own | Own | Own | - | Missing DELETE |
| `clapcheeks_analytics_daily` | Yes | Own | Own | Own | - | Missing DELETE |
| `devices` | Yes | Own | Own | Own | Own | Via migration 003 |
| `analytics_daily` | Yes | Own | Own | Own | - | Via migration 003 |
| `ai_suggestions` | Yes | Own | Own | Own | - | Via migration 003 |
| `clapcheeks_subscriptions` | Yes | Own | - | - | - | SELECT only - correct for user-facing |
| `clapcheeks_referrals` | Yes | Own (referrer) | - | - | - | SELECT only for referrer_id |
| `clapcheeks_opener_log` | Yes | ALL (own) | ALL (own) | ALL (own) | ALL (own) | Uses FOR ALL |
| `clapcheeks_conversation_events` | Yes | ALL (own) | ALL (own) | ALL (own) | ALL (own) | Uses FOR ALL |
| `clapcheeks_agent_events` | Yes | Own | **MISSING** | - | - | **FIXED in 011** - added INSERT |
| `clapcheeks_push_tokens` | Yes | ALL (own) | ALL (own) | ALL (own) | ALL (own) | Uses FOR ALL |
| `clapcheeks_photo_scores` | Yes | ALL (own) | ALL (own) | ALL (own) | ALL (own) | Uses FOR ALL |
| `clapcheeks_conversation_stats` | Yes | Own | Own | Own | - | |
| `clapcheeks_spending` | Yes | Own | Own | Own | Own | Full coverage |
| `clapcheeks_coaching_sessions` | Yes | Own | Own | - | - | |
| `clapcheeks_tip_feedback` | Yes | Own | Own | Own | - | |
| `clapcheeks_voice_profiles` | Yes | Own | Own | Own | - | |
| `clapcheeks_reply_suggestions` | Yes | Own | Own | - | - | |
| `clapcheeks_usage_daily` | Yes | Own | - | - | - | INSERT/UPDATE via SECURITY DEFINER function |
| `clapcheeks_weekly_reports` | Yes | Own | - | - | - | Writes via service role |
| `clapcheeks_report_preferences` | Yes | Own | Own | Own | - | |
| `clapcheeks_queued_replies` | Yes | Own | Own | - | - | |
| `stripe_events` | **NO** | - | - | - | - | **FIXED in 011** - RLS enabled, service_role only |
| `clapcheeks_affiliate_applications` | **NO** | - | - | - | - | **FIXED in 011** - RLS enabled, public INSERT |
| `clapcheeks_device_codes` | **NO** | - | - | - | - | **FIXED in 011** - RLS enabled, own-user policies |
| `events` | Yes | All | Own | Own | Own | LEGACY table from wrong project |
| `event_participants` | Yes | All | Own | Own | Own | LEGACY |
| `groups` | Yes | All | Own | Own | Own | LEGACY |
| `group_members` | Yes | All | Own | Own | Own | LEGACY |
| `notifications` | Yes | Own | Own | Own | Own | LEGACY |

---

## Issues Found and Fixed (Migration 011)

### 1. Missing ON DELETE CASCADE on Foreign Keys
**Severity: HIGH**
Tables with user_id FK but no cascade behavior would leave orphaned rows when a user is deleted:
- `clapcheeks_referrals.referrer_id` -> CASCADE
- `clapcheeks_referrals.referred_id` -> SET NULL
- `clapcheeks_opener_log.user_id` -> CASCADE
- `clapcheeks_conversation_events.user_id` -> CASCADE
- `clapcheeks_agent_events.user_id` -> CASCADE
- `clapcheeks_push_tokens.user_id` -> CASCADE
- `clapcheeks_photo_scores.user_id` -> CASCADE
- `clapcheeks_queued_replies.user_id` -> CASCADE
- `clapcheeks_device_codes.user_id` -> CASCADE

### 2. Missing Indexes on Foreign Keys
**Severity: MEDIUM**
FK columns without indexes cause slow JOINs and cascade deletes:
- `clapcheeks_sessions.user_id`
- `clapcheeks_matches.user_id`
- `clapcheeks_conversations.user_id`
- `clapcheeks_analytics_daily.user_id`
- `clapcheeks_referrals.referrer_id`
- `clapcheeks_push_tokens.user_id`
- `clapcheeks_photo_scores.user_id`
- `profiles.stripe_customer_id` (queried by Stripe webhook to find user)

### 3. Missing RLS on 3 Tables
**Severity: HIGH**
- `stripe_events` - No RLS at all. Now enabled (service_role only).
- `clapcheeks_affiliate_applications` - No RLS. Now enabled with public INSERT policy.
- `clapcheeks_device_codes` - No RLS. Now enabled with user-scoped policies.

### 4. Missing INSERT Policy on clapcheeks_agent_events
**Severity: HIGH**
The table only had a SELECT policy. Agent code could not insert events. Fixed.

### 5. SQL Injection in increment_usage Function
**Severity: HIGH**
The `p_field` TEXT parameter was used directly in `format()` for dynamic SQL without validation. An attacker could pass arbitrary column names. Fixed with allowlist check.

### 6. subscription_tier Column Ensured on profiles
**Severity: MEDIUM**
`plan-server.ts` and admin pages query `subscription_tier` from profiles. Migration 002 adds it but scripts may conflict. Ensured with `ADD COLUMN IF NOT EXISTS`.

---

## Issues Found But NOT Fixed (Require Discussion)

### 1. Legacy Tables from Wrong Project (script 001)
**Severity: LOW (if not deployed)**
`web/scripts/001_create_schema.sql` creates tables for a sports events platform (`events`, `event_participants`, `groups`, `group_members`, `notifications`). These are NOT Clapcheeks tables. Some app pages (`events/page.tsx`, `groups/page.tsx`, `profile/page.tsx`) still reference them.

**Recommendation:** If these scripts were never run against the Supabase project, ignore. If they were, consider dropping these tables in a future migration.

### 2. Duplicate clapcheeks_referrals Definition
**Severity: MEDIUM**
- Migration 006: `referrer_id`, `referred_id`, `referral_code`, status values `pending|converted|rewarded`
- Script 010: `referrer_id`, `referee_id`, `ref_code`, status values `pending|converted|credited`

The profile columns also differ: migration 006 adds `referral_code`, `referred_by`, `free_months_earned`; script 010 adds `ref_code`, `referred_by`, `referral_credits`.

**Recommendation:** Consolidate to one definition. The app code (`referrals/page.tsx`) queries `clapcheeks_referrals` and `profiles.referral_code`.

### 3. Duplicate analytics_daily vs clapcheeks_analytics_daily
**Severity: MEDIUM**
Two similar tables exist:
- `clapcheeks_analytics_daily` (migration 002, renamed from outward): `platform` column, columns like `swipes_right/left`, `matches`, `messages_sent`, `dates_booked`
- `analytics_daily` (migration 009): `app` column (with CHECK constraint for tinder/bumble/hinge), columns like `swipes_right/left`, `matches`, `conversations_started`, `dates_booked`, `money_spent`

The app code uses `analytics_daily` (coaching, reports, dashboard). Admin pages use `clapcheeks_analytics_daily`.

**Recommendation:** Consolidate into one table. `analytics_daily` appears to be the canonical version used by the app.

### 4. "Outward" References in Migration 002
**Severity: LOW**
Migration 002 file name is `outward_core.sql` and has "Outward" in comments. Since migration 004 renames the tables, this is functionally correct but aesthetically a brand violation. Cannot rename the file without breaking Supabase migration history.

### 5. Missing Admin/Super-Admin RLS Policies
**Severity: MEDIUM**
No admin or super_admin role-based policies exist. Admin pages use `supabase.from("profiles").select("*")` which would be blocked by the `auth.uid() = id` SELECT policy (users can only see their own profile). The admin pages likely work because they use the service role client, but proper admin RLS policies would be more secure.

**Recommendation:** Add admin read policies using a `user_role` column or a lookup function.

### 6. App Code References Non-Existent Tables
- `web/app/events/page.tsx` queries `dates` table - does not exist
- `web/app/groups/page.tsx` queries `conversations` table - does not exist (there is `clapcheeks_conversations`)

---

## Schema Gaps (App Expects but May Not Exist)

| Table Referenced in App | Exists in Migrations? | Exists in Scripts? |
|------------------------|:---------------------:|:-----------------:|
| `profiles` | Yes | Yes |
| `clapcheeks_subscriptions` | Yes (009) | No |
| `clapcheeks_usage_daily` | No | Yes (008) |
| `analytics_daily` | Yes (009) | No |
| `clapcheeks_conversation_stats` | No | Yes (005_ext) |
| `clapcheeks_spending` | No | Yes (005_ext) |
| `devices` | Yes (009) | No |
| `clapcheeks_agent_tokens` | Yes (002+004) | No |
| `clapcheeks_analytics_daily` | Yes (002+004) | No |
| `clapcheeks_agent_events` | Yes (008) | No |
| `clapcheeks_referrals` | Yes (006) | Yes (010) - CONFLICTING |
| `clapcheeks_coaching_sessions` | No | Yes (006) |
| `clapcheeks_tip_feedback` | No | Yes (006) |
| `clapcheeks_voice_profiles` | No | Yes (007) |
| `clapcheeks_reply_suggestions` | No | Yes (007) |
| `clapcheeks_weekly_reports` | No | Yes (009) |
| `clapcheeks_report_preferences` | No | Yes (009) |
| `clapcheeks_affiliate_applications` | No | Yes (011) |
| `clapcheeks_queued_replies` | No | Yes (012) |
| `clapcheeks_device_codes` | No | Yes (013) |
| `stripe_events` | No | Yes (005) |
| `dates` | **NO** | **NO** |
| `conversations` | **NO** | **NO** |

**Key concern:** Many tables only exist in `web/scripts/` which are not part of the Supabase migration pipeline. These scripts need to either be converted to proper migrations or confirmed as already applied to the database.

---

## Recommendations

1. **Consolidate scripts into migrations:** Move all `web/scripts/` SQL into proper Supabase migrations so they are tracked and version-controlled.

2. **Remove legacy schema (script 001):** The events/groups/notifications tables from the sports platform should be removed or the pages that reference them should be updated.

3. **Consolidate duplicate tables:** `analytics_daily` vs `clapcheeks_analytics_daily` and the two `clapcheeks_referrals` definitions need to be unified.

4. **Add admin RLS policies:** Admin pages need proper role-based RLS instead of relying on service role.

5. **Fix broken table references:** `dates` and `conversations` tables don't exist anywhere. The pages referencing them will error.

6. **Unify profile subscription columns:** Both `plan` and `subscription_tier` exist on profiles, used by different parts of the app. Should consolidate to one.
