# Archived: `web/scripts/*.sql` and `web/supabase/migrations/*.sql`

**Archived on:** 2026-04-27 by AI-8769 migration audit
**Branch:** `feat/clapcheeks-migration-audit`

## What this is

The 14 SQL files originally at `web/scripts/*.sql` plus the 1 file at `web/supabase/migrations/20260420400000_alpha_feedback.sql`, archived here for recovery. **Do NOT run these against any database.**

## Why archived

These predate the `supabase/migrations/` system. Each file has been replaced by an equivalent (and usually more complete) migration in the canonical `supabase/migrations/` directory. See `.planning/migration-audit/cross-reference.md` for the file-by-file mapping.

Re-running any of these files against a populated DB would:

- Re-create tables that already exist (most use `IF NOT EXISTS` so this is no-op, but a few use bare `CREATE TABLE`)
- Re-add columns that may have been DROPPED or RENAMED by later migrations
- Re-create RLS policies with conflicting names
- Re-add triggers and functions that have evolved since these files were written

## Specific call-outs

| File | Why archived |
|---|---|
| `001_create_schema.sql` | profiles → superseded by `20240101000001_create_user_profiles.sql`. events/groups/event_participants/group_members → orphan, never deployed to prod, no app code references. notifications → orphan but live; LIVE prod schema is captured separately by `20260427190001_legacy_notifications_capture.sql` |
| `002_add_profile_completion.sql` | superseded by `20240101000005_onboarding.sql` + `20240101000012_audit_fixes_phase2.sql` |
| `003_add_profile_trigger.sql` | superseded by `20240101000001_create_user_profiles.sql` |
| `004_clap_cheeks_profile.sql` | superseded by `20260303000003_canonical_profiles.sql` |
| `005_analytics_extended.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` |
| `005_stripe_events.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` (which has explicit comment `-- stripe_events (from 005_stripe_events.sql)`) |
| `006_coaching.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` |
| `007_conversation_ai.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` |
| `008_usage_limits.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` |
| `009_reports.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` |
| `010_referrals.sql` | superseded by `20240101000006_referrals.sql` + `20240101000014_referral_cleanup.sql` |
| `011_affiliates.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` (explicit comment `-- clapcheeks_affiliate_applications (from 011_affiliates.sql)`) |
| `012_queued_replies.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` + `20260303000005_queued_replies_rls.sql` + `20260303000007_queued_replies_constraints.sql` |
| `013_device_codes.sql` | superseded by `20240101000012_audit_fixes_phase2.sql` (explicit comment `-- clapcheeks_device_codes (from 013_device_codes.sql)`) |
| `duplicate_alpha_feedback_from_web_supabase.sql` (renamed from `20260420400000_alpha_feedback.sql`) | duplicate of canonical `supabase/migrations/20260420400000_alpha_feedback.sql` (a stripped-down minified version). |

## Recovery

If you ever need to read the original content (e.g. to confirm a column default that's been forgotten), the files are here verbatim and tracked in git history.

To find which canonical migration replaces each one, see `.planning/migration-audit/cross-reference.md`.
