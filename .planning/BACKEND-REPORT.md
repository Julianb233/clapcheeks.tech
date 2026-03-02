# Backend Audit Report

## Issues Found & Fixes Applied (Round 2 — DB Audit Follow-up)

### 10. Referral Convert Route Uses Wrong Column Name (`referee_id` vs `referred_id`)
- **File:** `web/app/api/referral/convert/route.ts:38`
- **Issue:** Queries `.eq('referee_id', profile.id)` but the canonical column from migration 006 is `referred_id`. All other code (referrals page, API project) uses `referred_id`.
- **Fix:** Changed to `.eq('referred_id', profile.id)`.

### 11. Referral Convert RPC Parameter Name Mismatch
- **File:** `web/app/api/referral/convert/route.ts:82`
- **Issue:** Passes `{ user_id: ... }` to `increment_referral_credits` RPC, but the DB function parameter is `p_user_id`. Supabase RPC matches by parameter name, so this would fail at runtime with a "function not found" error.
- **Fix:** Changed to `{ p_user_id: ... }`.

---

## Issues Found & Fixes Applied (Round 2 -- DB Audit Follow-up)

### 8. Webhook Not Syncing `subscription_tier` Column
- **File:** `web/app/api/stripe/webhook/route.ts:56-61,76-79,86-89`
- **Issue:** Webhook only updates `plan` column but admin pages read `subscription_tier`. The two columns drift out of sync, causing admin dashboard to show wrong plan info.
- **Fix:** Webhook now updates BOTH `plan` and `subscription_tier` on all subscription events (checkout.session.completed, subscription.updated, subscription.deleted).

### 9. Broken Table References in Page Components
- **File:** `web/app/events/page.tsx:22` — queries `.from("dates")` which doesn't exist
- **File:** `web/app/groups/page.tsx:22` — queries `.from("conversations")` which doesn't exist
- **Fix:** Changed to `clapcheeks_dates` and `clapcheeks_conversations` respectively, matching the project's table naming convention.

---

## Issues Found & Fixes Applied (Round 1 — Initial Audit)

### 1. Debug Console Logs Leaking Supabase Credentials
- **File:** `web/lib/supabase/client.ts:4-5`
- **Issue:** `console.log("[v0] Supabase URL:", process.env.NEXT_PUBLIC_SUPABASE_URL)` and key existence logging left from development. Leaks environment info to browser console.
- **Fix:** Removed both console.log statements.

### 2. Stripe Fallback Key Masking Misconfiguration
- **File:** `web/lib/stripe.ts:3`
- **Issue:** `process.env.STRIPE_SECRET_KEY || 'sk_not_configured'` silently creates an invalid Stripe instance instead of failing fast. Stripe API calls would fail with confusing errors downstream.
- **Fix:** Changed to `process.env.STRIPE_SECRET_KEY!` with a `console.warn` if unset. Fails clearly at the point of use.

### 3. Webhook/Cron Routes Blocked by Auth Middleware
- **File:** `web/lib/supabase/middleware.ts:32-47`
- **Issue:** API routes that don't carry user sessions (Stripe webhook, cron jobs, referral tracking, affiliate apply) were NOT in the public routes list. The middleware would redirect them to `/login`, causing webhooks and cron jobs to fail silently with 307 redirects.
- **Fix:** Added `/api/stripe/webhook`, `/api/affiliate/apply`, `/api/referral/track`, `/api/reports/cron`, `/api/reports/weekly`, `/api/referral/convert` to the public routes list.

### 4. Webhook Plan Detection Only Recognizes `elite_monthly`
- **File:** `web/app/api/stripe/webhook/route.ts:71-72`
- **Issue:** `const plan = priceId === 'elite_monthly' ? 'elite' : 'base'` means users who subscribe to `starter` or `pro` plans, or any annual plan, get mapped to `base`. Their paid features are lost.
- **Fix:** Parse plan tier from lookup key format `plan_interval` (e.g., `pro_monthly` -> `pro`). Validate against known plans.

### 5. Cron Route Uses Anon Key for Admin Operations
- **File:** `web/app/api/reports/cron/route.ts:16,84`
- **Issue:** Uses `createClient()` (anon key) from `@/lib/supabase/server` but then calls `supabase.auth.admin.getUserById()` which requires service role key. This will fail at runtime with a permission error.
- **Fix:** Changed to `createAdminClient()` from `@/lib/supabase/admin` since this is a cron-only endpoint already guarded by `CRON_SECRET`.

### 6. Report Generate Route Uses Anon Key for Admin Auth Lookup
- **File:** `web/app/api/reports/generate/route.ts:99`
- **Issue:** Same as #5. Calls `supabase.auth.admin.getUserById(targetUserId)` using anon-key server client.
- **Fix:** Added `createAdminClient()` import and use it for the admin getUserById call.

### 7. Plan Active Status Ignores Trialing Subscriptions
- **File:** `web/lib/plan-server.ts:26`
- **Issue:** `isActive: profile.subscription_status === 'active'` doesn't account for Stripe's `trialing` status, meaning trial users get treated as inactive and lose access to paid features.
- **Fix:** Changed to `profile.subscription_status === 'active' || profile.subscription_status === 'trialing'`.

---

## Security Concerns

### Service Role Key Usage (Acceptable)
The service role key (`SUPABASE_SERVICE_ROLE_KEY`) is used in these server-only files:
- `web/lib/supabase/admin.ts` - Admin client factory (server-only)
- `web/app/api/stripe/webhook/route.ts` - Webhook handler (server-only, signature-verified)
- `web/app/api/affiliate/apply/route.ts` - Affiliate applications (server-only)
- `web/app/api/referral/track/route.ts` - Referral tracking (server-only)
- `web/app/api/referral/convert/route.ts` - Referral conversion (server-only, auth-header verified)
- `web/app/api/reports/weekly/route.ts` - Weekly reports cron (server-only, cron-secret verified)

**None of these are exposed client-side.** The key is never in `NEXT_PUBLIC_` prefixed vars, so it won't be bundled into client JS. This is correct usage.

### Auth Check Coverage
All user-facing API routes properly validate auth via `supabase.auth.getUser()`:
- `/api/agent/status` - GET, auth check
- `/api/analytics/summary` - GET, auth check
- `/api/billing` - GET, auth check
- `/api/coaching/feedback` - POST, auth check
- `/api/coaching/generate` - POST, auth check + usage limits
- `/api/coaching/tips` - GET, auth check
- `/api/conversation/send` - POST, auth check
- `/api/conversation/suggest` - POST, auth check + usage limits
- `/api/conversation/voice-profile` - GET/POST, auth check
- `/api/photos/score` - POST, auth check
- `/api/referral/generate` - POST, auth check
- `/api/reports/generate` - POST, auth check (or cron secret)
- `/api/reports/preferences` - GET/PUT, auth check
- `/api/reports/send` - POST, auth check
- `/api/stripe/checkout` - POST, auth check
- `/api/stripe/portal` - POST, auth check
- `/api/usage` - GET, auth check

### Server-only routes with alternative auth:
- `/api/stripe/webhook` - Stripe signature verification
- `/api/reports/cron` - CRON_SECRET bearer token
- `/api/reports/weekly` - CRON_SECRET bearer token
- `/api/referral/convert` - Service role key bearer token
- `/api/affiliate/apply` - Public (intentional, no auth needed)
- `/api/referral/track` - Public (intentional, just sets cookie)

### No SQL Injection Risk
All Supabase queries use the query builder (`.eq()`, `.gte()`, `.in()`, etc.) - no raw SQL in any API route.

### No Hardcoded Secrets
No API keys, tokens, or secrets are hardcoded in any file. All come from `process.env`.

---

## Plan Naming Inconsistency (Non-Breaking but Confusing)

There are TWO plan naming schemes in the codebase:
1. `plan.ts` (client-side gating): `free | starter | pro | elite`
2. `usage.ts` (usage tracking): `base | elite`
3. `types.ts` (DB types): `starter | pro | elite`
4. Webhook/checkout: `base | starter | pro | elite`

The `usage.ts` system only has `base` and `elite` tiers for usage limits (swipes, coaching_calls, ai_replies). The `plan.ts` system has 4 tiers for feature gating (platforms, conversationAI, etc.). These serve different purposes but the naming overlap between `free` and `base` is confusing.

**Recommendation:** Align on one naming convention. Either rename `free` to `base` in `plan.ts` or rename `base` to `free` in `usage.ts` and the profiles table.

---

## Required Environment Variables

| Variable | Used In | Required |
|----------|---------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase clients (server, client, middleware, admin) | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase clients (server, client, middleware) | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin client, webhook, affiliate, referral, reports | Yes |
| `STRIPE_SECRET_KEY` | Stripe client (`web/lib/stripe.ts`) | Yes |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification | Yes |
| `NEXT_PUBLIC_SITE_URL` | Stripe checkout success/cancel URLs, auth redirects | Yes |
| `CRON_SECRET` | Cron endpoint auth (`reports/cron`, `reports/weekly`, `reports/generate`) | Yes |
| `ANTHROPIC_API_KEY` | Claude AI calls (voice-profile, coaching, conversation-ai, weekly reports) | Yes |
| `RESEND_API_KEY` | Email sending (send-report-email, weekly reports) | Yes |
| `NEXT_PUBLIC_AI_URL` | Photo scoring service URL (defaults to `http://localhost:8000`) | Optional |
| `NEXT_PUBLIC_API_URL` | External API URL (intelligence page, activate page) | Optional |
| `NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL` | Dev override for auth redirect | Optional (dev only) |

**Note:** No `.env.example` file exists. One should be created.

---

## Database Tables Referenced by API Routes

These tables are queried across the API routes (for db-engineer reference):
- `profiles` (core user table, has plan/subscription/stripe fields)
- `devices`
- `analytics_daily`
- `clapcheeks_conversation_stats`
- `clapcheeks_spending`
- `clapcheeks_subscriptions`
- `clapcheeks_usage_daily`
- `clapcheeks_coaching_sessions`
- `clapcheeks_tip_feedback`
- `clapcheeks_queued_replies`
- `clapcheeks_voice_profiles`
- `clapcheeks_reply_suggestions`
- `clapcheeks_affiliate_applications`
- `clapcheeks_referrals`
- `clapcheeks_report_preferences`
- `clapcheeks_weekly_reports`
- `stripe_events`

RPC functions referenced:
- `increment_usage(p_user_id, p_field, p_amount)`
- `increment_referral_credits(p_user_id)`

Storage buckets:
- `weekly-reports`

---

## Potential Issues for DB Engineer

1. **`usage.ts` column mismatch:** `checkLimit()` queries `clapcheeks_usage_daily` selecting the field name directly (e.g., `swipes`), but `getUsageSummary()` selects `swipes_used, coaching_calls_used, ai_replies_used`. The column names may not match what `checkLimit` expects. Verify the actual DB column names.

2. **`profiles` table schema drift:** The TypeScript types in `supabase/types.ts` don't include `subscription_tier`, `subscription_status`, `stripe_customer_id`, `stripe_subscription_id`, `ref_code`, `referred_by`, `plan`, or `profile_completed` - all of which are queried by API routes. The types file is outdated.

3. **RLS consideration:** The cron and webhook routes use admin client (service role) which bypasses RLS. This is correct. But the `reports/cron` route was using the anon-key server client - if RLS is enabled on any of the tables it queries, those queries would fail for cross-user data. Fixed by switching to admin client.
