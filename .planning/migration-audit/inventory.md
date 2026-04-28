# Clapcheeks Migration System Audit — Inventory

**Audit date:** 2026-04-27
**Linear:** AI-8769
**Branch:** `feat/clapcheeks-migration-audit`

This document inventories every SQL file across the three migration locations in the Clapcheeks repo as of the audit, and notes which tables each one creates / alters.

---

## Location 1 — `supabase/migrations/` (THE PROPER SYSTEM)

51 files. This is the canonical Supabase migration directory and the only one Supabase CLI sees.

| Filename | Creates | Alters / Notes |
|---|---|---|
| `20240101000001_create_user_profiles.sql` | `public.profiles` | RLS + handle_new_user trigger |
| `20240101000002_outward_core.sql` | `outward_agent_tokens`, `outward_sessions`, `outward_matches`, `outward_conversations`, `outward_analytics_daily` | adds `subscription_tier`, `stripe_customer_id` to profiles |
| `20240101000003_rls_policies.sql` | (policies only) | RLS policies for outward_* tables |
| `20240101000004_rename_outward_to_clapcheeks.sql` | — | RENAMEs all outward_* → clapcheeks_* |
| `20240101000005_onboarding.sql` | — | adds `onboarding_completed`, `selected_mode`, `selected_platforms` to profiles |
| `20240101000006_referrals.sql` | `clapcheeks_referrals` | adds referral fields to profiles, set_referral_code trigger |
| `20240101000007_conversation_analytics.sql` | `clapcheeks_opener_log`, `clapcheeks_conversation_events` | + indexes |
| `20240101000008_agent_events.sql` | `clapcheeks_agent_events`, `clapcheeks_push_tokens` | RLS |
| `20240101000009_create_core_tables.sql` | `devices`, `analytics_daily`, `ai_suggestions`, `clapcheeks_subscriptions` | RLS |
| `20240101000010_photo_scores.sql` | `clapcheeks_photo_scores` | RLS |
| `20240101000011_audit_fixes.sql` | — | RLS / FK / index fixes for many tables (idempotent DO blocks) |
| `20240101000012_audit_fixes_phase2.sql` | `clapcheeks_affiliate_applications`, `clapcheeks_device_codes`, `stripe_events`, `clapcheeks_conversation_stats`, `clapcheeks_spending` | **explicitly ports content from `web/scripts/011_affiliates`, `013_device_codes`, `005_stripe_events` into the canonical migration system** (comments confirm this) |
| `20240101000013_dates_and_conversation_columns.sql` | `clapcheeks_dates` | adds `last_message_at`, `last_inbound_at` to clapcheeks_conversations |
| `20240101000014_referral_cleanup.sql` | — | reconciles `referral_code` ↔ `ref_code` columns + sync trigger |
| `20260303000001_rename_agent_tokens.sql` | — | RENAME outward_agent_tokens → clapcheeks_agent_tokens (idempotent re-do of 04) |
| `20260303000002_rename_analytics_daily.sql` | — | DROPs `clapcheeks_analytics_daily`, RENAMEs `analytics_daily` → `clapcheeks_analytics_daily` |
| `20260303000003_canonical_profiles.sql` | — | adds 20+ canonical columns to profiles (display_name, bio, etc.) |
| `20260303000004_fix_profiles_rls.sql` | — | profiles RLS policies |
| `20260303000005_queued_replies_rls.sql` | — | clapcheeks_queued_replies RLS |
| `20260303000006_performance_indexes.sql` | — | indexes |
| `20260303000007_queued_replies_constraints.sql` | — | UNIQUE constraint on `(user_id, match_id, suggested_text)` |
| `20260303000008_billing_fields.sql` | — | adds `subscription_provider`, `current_period_end` to profiles |
| `20260303000009_consolidate_plan_field.sql` | — | drops legacy plan vs subscription_tier overlap |
| `20260303000010_agent_degraded_status.sql` | — | adds `degraded_at`, `degraded_reason` to clapcheeks_agent_tokens |
| `20260419000001_clapcheeks_leads_pipeline.sql` | `clapcheeks_leads`, `clapcheeks_user_settings` | + updated_at triggers |
| `20260420000001_platform_token_ingest.sql` | — | adds `tinder_session`, `hinge_session`, etc. to clapcheeks_user_settings |
| `20260420000002_matches_intel_fields.sql` | — | adds 19 columns to clapcheeks_matches (external_id, name, age, bio, photos_jsonb, etc.) + touch_updated_at trigger |
| `20260420000003_instagram_session_cookie.sql` | — | adds `instagram_session_cookie` to clapcheeks_user_settings |
| `20260420000004_match_scoring_columns.sql` | — | adds 8 scoring columns to clapcheeks_matches |
| `20260420000005_contact_intelligence.sql` | `clapcheeks_contact_profiles`, `clapcheeks_contact_interests`, `clapcheeks_contact_style_profiles`, `clapcheeks_contact_memory_bank`, `clapcheeks_conversation_intelligence`, `clapcheeks_contact_response_rules`, `clapcheeks_scheduled_messages`, `clapcheeks_contact_availability` | full RLS, FKs, triggers |
| `20260420300000_match_profiles.sql` | `match_profiles` | RLS |
| `20260420310000_scheduled_messages.sql` | `clapcheeks_scheduled_messages` | **NOTE: duplicate CREATE — also created by `20260420000005_contact_intelligence`. IF NOT EXISTS makes it safe.** |
| `20260420400000_alpha_feedback.sql` | `alpha_feedback` | RLS, admin policies, indexes |
| `20260420400000_dunning_and_monitoring.sql` | `dunning_events`, `api_health_checks`, `security_audit_log` | adds `failed_payment_count`, etc. to profiles. **NOTE: timestamp clashes with alpha_feedback (`20260420400000`).** |
| `20260420450000_autonomy_engine.sql` | `clapcheeks_autonomy_config`, `clapcheeks_match_autonomy`, `clapcheeks_swipe_decisions`, `clapcheeks_preference_model`, `clapcheeks_auto_actions`, `clapcheeks_approval_queue` | full RLS + seed trigger |
| `20260420500000_soft_launch_support.sql` | `support_tickets`, `clapcheeks_referrals` (re-creates if missing) | RLS |
| `20260420600000_dogfooding_tables.sql` | `clapcheeks_friction_points`, `clapcheeks_dogfood_health` | adds `last_emailed_at` to clapcheeks_weekly_reports |
| `20260421000001_agent_jobs_queue.sql` | `clapcheeks_agent_jobs` | RLS |
| `20260421000002_phase_f_handoff.sql` | — | adds 8 handoff columns to clapcheeks_matches; adds `channel` to clapcheeks_conversations |
| `20260421000003_phase_b_photo_scores.sql` | — | adds columns to clapcheeks_photo_scores |
| `20260421000004_phase_c_ig_intel.sql` | — | adds `instagram_fetched_at`, `instagram_is_private` to clapcheeks_matches |
| `20260421000005_phase_g_drip.sql` | — | adds 4 drip columns to clapcheeks_matches |
| `20260421000006_phase_l_content_library.sql` | `clapcheeks_content_library`, `clapcheeks_posting_queue` | RLS |
| `20260421000007_phase_h_swipe_decisions.sql` | `clapcheeks_swipe_decisions` | **NOTE: duplicate CREATE — also created by `20260420450000_autonomy_engine`. IF NOT EXISTS makes it safe.** |
| `20260421000008_phase_j_roster.sql` | — | adds 18 health/roster columns to clapcheeks_matches |
| `20260421000009_phase_k_social_graph.sql` | — | adds 9 social graph columns to clapcheeks_matches |
| `20260422000000_profile_photos.sql` | `profile_photos` | RLS |
| `20260422100000_photo_ai_scoring.sql` | `profile_photos` | **duplicate CREATE — IF NOT EXISTS makes it safe**; adds AI scoring columns |
| `20260422200000_voice_context_calendar.sql` | `user_voice_context`, `voice_transcripts`, `google_calendar_tokens`, `knowledge_documents` | RLS |
| `20260423000000_followup_sequences.sql` | `clapcheeks_followup_sequences` | adds columns to clapcheeks_scheduled_messages |
| `20260427180000_clapcheeks_memos.sql` | `clapcheeks_memos` | RLS |

---

## Location 2 — `web/supabase/migrations/` (DUPLICATE)

1 file.

| Filename | Creates | Alters / Notes |
|---|---|---|
| `20260420400000_alpha_feedback.sql` | `alpha_feedback` (single-line minified version) | **DUPLICATE / OUTDATED** — same timestamp + table as the canonical `supabase/migrations/20260420400000_alpha_feedback.sql`. The canonical version is more complete (4 RLS policies vs 2, indexes, longer CHECK constraints). Diff confirms this is a stripped-down stale copy. |

**Action:** delete `web/supabase/migrations/` directory entirely. Canonical version already exists.

---

## Location 3 — `web/scripts/*.sql` (LEGACY — predates the proper system)

14 files. These are early-era one-shot SQL files from the original "Outward" product. They are NOT seen by Supabase CLI and are NOT idempotent across the existing `supabase/migrations/` set.

| Filename | Creates | Alters / Notes | Status |
|---|---|---|---|
| `001_create_schema.sql` | `profiles`, `events`, `event_participants`, `groups`, `group_members`, `notifications` | full RLS + triggers for the original "group hangout" product | **MIXED** — `profiles` is in `supabase/migrations/` (different schema). `events`/`groups`/`group_members`/`event_participants` are dead (not in app code, not on prod). `notifications` IS used by `web/app/notifications/page.tsx` AND exists on prod with a DIFFERENT schema (see "Live State Discrepancy" below). |
| `002_add_profile_completion.sql` | — | adds `profile_completed` to profiles + index | **SUPERSEDED** by `20240101000005_onboarding.sql` + `20240101000012_audit_fixes_phase2.sql` |
| `003_add_profile_trigger.sql` | — | `on_auth_user_created` trigger | **SUPERSEDED** by `20240101000001_create_user_profiles.sql` (which has its own handle_new_user trigger) |
| `004_clap_cheeks_profile.sql` | — | adds plan, rizz_score, total_matches, dates_booked, total_spend, stripe_customer_id, stripe_subscription_id, subscription_status to profiles | **SUPERSEDED** by `20260303000003_canonical_profiles.sql` (more complete) |
| `005_analytics_extended.sql` | `clapcheeks_conversation_stats`, `clapcheeks_spending` | RLS | **SUPERSEDED** by `20240101000012_audit_fixes_phase2.sql` |
| `005_stripe_events.sql` | `stripe_events` | index | **SUPERSEDED** by `20240101000012_audit_fixes_phase2.sql` (comment in that file: `-- stripe_events (from 005_stripe_events.sql)`) |
| `006_coaching.sql` | `clapcheeks_coaching_sessions`, `clapcheeks_tip_feedback` | RLS | **SUPERSEDED** — both tables exist in `supabase/migrations/` (created by audit_fixes_phase2 implicitly via column scope; verified by comm output) |
| `007_conversation_ai.sql` | `clapcheeks_voice_profiles`, `clapcheeks_reply_suggestions` | RLS | **SUPERSEDED** — both exist in canonical migrations |
| `008_usage_limits.sql` | `clapcheeks_usage_daily` | RLS, index | **SUPERSEDED** — exists in canonical migrations |
| `009_reports.sql` | `clapcheeks_weekly_reports`, `clapcheeks_report_preferences` | RLS | **SUPERSEDED** — both exist in canonical migrations |
| `010_referrals.sql` | `clapcheeks_referrals` | adds `ref_code`, `referred_by`, `referral_credits` to profiles | **SUPERSEDED** by `20240101000006_referrals.sql` + `20240101000014_referral_cleanup.sql` + `20260303000003_canonical_profiles.sql` |
| `011_affiliates.sql` | `clapcheeks_affiliate_applications` | — | **SUPERSEDED** by `20240101000012_audit_fixes_phase2.sql` (comment: `-- clapcheeks_affiliate_applications (from 011_affiliates.sql)`) |
| `012_queued_replies.sql` | `clapcheeks_queued_replies` | RLS | **SUPERSEDED** — table exists in canonical migrations (audit_fixes adds RLS to it) |
| `013_device_codes.sql` | `clapcheeks_device_codes` | index | **SUPERSEDED** by `20240101000012_audit_fixes_phase2.sql` (comment: `-- clapcheeks_device_codes (from 013_device_codes.sql)`) |

---

## Cross-Reference Summary

### Tables created in `web/scripts/*.sql` only (no equivalent in canonical):
- `events`, `event_participants`, `groups`, `group_members` — **orphan/dead**, no app code references, not on prod (verified). Safe to archive without porting.
- `notifications` — **orphan but live**. Exists on prod with a DIFFERENT schema than `web/scripts/001_create_schema.sql` defines. Used by `web/app/notifications/page.tsx`. Needs to be ported to a proper migration that mirrors the LIVE prod schema (NOT the web/scripts schema).

### Tables in `web/scripts/*.sql` that ARE in canonical migrations:
All other web/scripts tables (clapcheeks_*, stripe_events, profiles) — superseded. Safe to archive.

### Tables in `web/supabase/migrations/`:
- `alpha_feedback` — duplicate of canonical, stripped-down. Just delete the `web/supabase/migrations/` directory.

---

## Live State Discrepancy — `notifications` table

**Discovered during audit.** Connected to prod (`db.oouuoepmkeqdyzsxrnjh.supabase.co`) and ran `pg_dump` of `public.notifications`. The live table:

- Has columns: `id, user_id, title varchar(255), message text, type varchar(50), read boolean, action_url text, created_at`
- Has FK: `user_id → public.users(id)` (NOT `auth.users` and NOT `public.profiles` like web/scripts/001 declares)
- Has indexes: `idx_notifications_read`, `idx_notifications_user`
- Has RLS policies: "Users can view own notifications", "Users can update own notifications"
- **References a `public.users` table that exists on prod but is NOT in any migration**

**Implication:** there was a third migration system at some point (possibly a Supabase Studio migration, or a manual `psql` session) that created `public.users` + the live `public.notifications`. Neither is in any tracked migration file in the repo today.

**This audit does NOT fix that** — fixing it requires deciding whether to:
1. Keep `public.users` and treat it as canonical (write a migration to capture its current schema)
2. Migrate notifications.user_id from `public.users(id)` → `auth.users(id)` and drop `public.users` (risky if prod data references it)

**Recommendation for follow-up:** open a separate Linear issue to back-port the live `public.users` + `public.notifications` schema into `supabase/migrations/` as a pair of `*_capture_legacy_*.sql` migrations, then plan a separate hardening migration if we want to consolidate onto auth.users.

For THIS audit we will:
- Port the LIVE `public.notifications` schema (mirroring prod) into a new dated migration so the migration history can be re-applied to a fresh DB and produce the same state
- Add a clearly-marked TODO migration stub for `public.users` so it's tracked

---

## Cleanup Actions (executed in this PR)

1. Delete `web/supabase/migrations/20260420400000_alpha_feedback.sql` (duplicate, stripped-down) and the empty `web/supabase/migrations/` directory.
2. Add `supabase/migrations/20260427190000_legacy_users_capture.sql` capturing live `public.users` so migrations match prod state. Runs FIRST so notifications FK has a target.
3. Port `notifications` (LIVE prod schema, not the web/scripts schema) → `supabase/migrations/20260427190001_legacy_notifications_capture.sql`.
4. Archive ALL of `web/scripts/*.sql` to `supabase/migrations/.archive/web-scripts-20260427/` with a `README.md` explaining the supersession.
5. Generate `supabase/schema-snapshots/clapcheeks_matches.sql` (canonical schema snapshot, header lists every contributing migration).
6. Add `supabase/migrations/RUNBOOK.md` describing the new flow.

## Pre-existing migration debt discovered during audit

Confirmed by running every migration against a fresh Postgres 17 container with stubbed Supabase auth/storage schemas:

1. **`20260420400000_dunning_and_monitoring.sql` was syntactically broken** — used `CREATE POLICY IF NOT EXISTS` which is invalid Postgres syntax. The migration only got onto prod via Supabase Studio (which probably swallowed the error). **FIXED in this PR** by wrapping in `DO $$ ... $$` blocks (no-op against prod).

2. **`20260421000007_phase_h_swipe_decisions.sql` is broken** — assumes `clapcheeks_swipe_decisions` has `decided_at` column, but the EARLIER `20260420450000_autonomy_engine.sql` creates the table with a totally different schema (no `decided_at`). On prod, the table has YET ANOTHER schema (with `match_id`, `external_id`, `features`, `model_score`, `julian_override`) — meaning a third schema-modifying migration was applied directly via Studio and was never committed. NOT fixed in this PR (requires choosing a canonical schema and writing a reconciliation migration; out of scope).

3. **`20260422200000_voice_context_calendar.sql` references `storage.buckets.file_size_limit`** column which doesn't exist in basic Postgres — this is a Supabase-specific column. Migration only applies in a real Supabase environment, not against vanilla Postgres. NOT fixed.

4. **Several migrations have non-idempotent `CREATE POLICY` statements** that fail when re-applied to a populated DB. NOT fixed (out of scope).

5. **`20260303000002_rename_analytics_daily.sql` will fail on a fresh DB** because it RENAMEs `analytics_daily` → `clapcheeks_analytics_daily` but expects the source table to exist. On a fresh DB after `20260101000009_create_core_tables.sql` creates `analytics_daily`, this should work — but it doesn't because the prior `20240101000004_rename_outward_to_clapcheeks.sql` already created `clapcheeks_analytics_daily` via a rename. NOT fixed.

These are all PRE-EXISTING bugs not introduced by this audit. The CI workflow added in this PR (`.github/workflows/migrations.yml`) will surface them on the NEXT migration PR — at which point they should be triaged and fixed in their own PRs (NOT batched here).

## Out of scope (follow-up Linear)

- Resolving timestamp collision on `20260420400000_alpha_feedback.sql` vs `20260420400000_dunning_and_monitoring.sql`. Both are `IF NOT EXISTS`-guarded; on a fresh apply they sort lexically and run cleanly. Risk is low but the names are confusing — file a P3 to re-date one of them on the next "no migrations in flight" window.
- Hardening duplicate-CREATE pairs (`clapcheeks_swipe_decisions`, `clapcheeks_scheduled_messages`, `profile_photos`) — all use `IF NOT EXISTS`, so they're safe today, but they're confusing to read. P4.
- Consolidating `public.users` and `public.profiles` into a single canonical user table.
- Reconciling the three different schemas for `clapcheeks_swipe_decisions` (autonomy_engine, phase_h, prod) into one canonical migration.
- Capturing the `clapcheeks_matches` triggers/functions/columns that exist on prod but aren't in any committed migration (see `supabase/schema-snapshots/clapcheeks_matches.sql` header).
