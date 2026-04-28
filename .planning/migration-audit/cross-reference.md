# Cross-Reference: web/scripts/*.sql vs supabase/migrations/*.sql

For each table created in `web/scripts/`, this matrix shows whether a corresponding (intent-equivalent) definition exists in `supabase/migrations/`.

| web/scripts/ table | web/scripts/ file | Canonical migration(s) | Status | Action |
|---|---|---|---|---|
| `profiles` | 001_create_schema | `20240101000001_create_user_profiles.sql` (+ 5 more that ALTER it) | SUPERSEDED — canonical version is more complete | **archive** |
| `events` | 001_create_schema | (none) | ORPHAN, not in app code, not on prod | **archive (no port)** |
| `event_participants` | 001_create_schema | (none) | ORPHAN, not in app code, not on prod | **archive (no port)** |
| `groups` | 001_create_schema | (none) | ORPHAN, not in app code, not on prod | **archive (no port)** |
| `group_members` | 001_create_schema | (none) | ORPHAN, not in app code, not on prod | **archive (no port)** |
| `notifications` | 001_create_schema | (none) — LIVE on prod with a different schema | ORPHAN BUT LIVE — used by `web/app/notifications/page.tsx` | **archive web/scripts version, port LIVE prod schema as new migration** |
| (profile.profile_completed col) | 002_add_profile_completion | `20240101000005_onboarding.sql`, `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| (handle_new_user trigger) | 003_add_profile_trigger | `20240101000001_create_user_profiles.sql` | SUPERSEDED | **archive** |
| (profile.plan, rizz_score, etc cols) | 004_clap_cheeks_profile | `20260303000003_canonical_profiles.sql` | SUPERSEDED | **archive** |
| `clapcheeks_conversation_stats` | 005_analytics_extended | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_spending` | 005_analytics_extended | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `stripe_events` | 005_stripe_events | `20240101000012_audit_fixes_phase2.sql` (explicit comment: "from 005_stripe_events.sql") | SUPERSEDED | **archive** |
| `clapcheeks_coaching_sessions` | 006_coaching | `20240101000012_audit_fixes_phase2.sql` (RLS in audit_fixes) | SUPERSEDED | **archive** |
| `clapcheeks_tip_feedback` | 006_coaching | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_voice_profiles` | 007_conversation_ai | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_reply_suggestions` | 007_conversation_ai | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_usage_daily` | 008_usage_limits | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_weekly_reports` | 009_reports | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_report_preferences` | 009_reports | `20240101000012_audit_fixes_phase2.sql` | SUPERSEDED | **archive** |
| `clapcheeks_referrals` | 010_referrals | `20240101000006_referrals.sql` + `20240101000014_referral_cleanup.sql` + `20260420500000_soft_launch_support.sql` | SUPERSEDED | **archive** |
| `clapcheeks_affiliate_applications` | 011_affiliates | `20240101000012_audit_fixes_phase2.sql` (explicit comment: "from 011_affiliates.sql") | SUPERSEDED | **archive** |
| `clapcheeks_queued_replies` | 012_queued_replies | `20240101000012_audit_fixes_phase2.sql` + `20260303000005_queued_replies_rls.sql` + `20260303000007_queued_replies_constraints.sql` | SUPERSEDED | **archive** |
| `clapcheeks_device_codes` | 013_device_codes | `20240101000012_audit_fixes_phase2.sql` (explicit comment: "from 013_device_codes.sql") | SUPERSEDED | **archive** |

## Summary

- **20 of 20 distinct table-creates in `web/scripts/`**: 14 superseded by canonical migrations, 5 truly orphaned and dead, 1 (`notifications`) orphaned and live.
- **Action**: archive the entire `web/scripts/*.sql` set to `supabase/migrations/.archive/web-scripts-20260427/`; port LIVE notifications schema into a new migration; delete duplicate `web/supabase/migrations/`.
