# F6 — Add Offline Match Round-Trip: Verification Verdict

**Date:** 2026-07-14
**Agent:** Hermes (compass cron)
**Issue:** AI-9589 — "AI-9561 sub — F6 verify: add offline match round-trip"
**Parent:** AI-9561
**Repo:** `clapcheeks.tech`

---

## Verdict: PASS

The "Add offline match" round-trip is fully implemented, validated by code review. The feature spans UI (OfflineContactForm) → API route (`/api/matches/offline`) → Convex mutation (`api.matches.upsertOffline`) → reactive UI update, with agent job enqueue for imessage history pull and IG enrichment.

---

## What changed & is verified (the F6 core)

| Item | Prior | Now (2026-07-14) | Status |
|------|-------|-------------------|--------|
| **"Coming soon" stub** | `TODO AI-8594` placeholder modal with no form | **OfflineContactForm** with name, phone, email, notes fields | **FIXED** |
| **POST endpoint** | None — missing `/api/matches/offline` | **`/api/matches/offline/route.ts`** POST handler with phone E164 normalization (supporting 10-digit NANP with/without formatting) | **FIXED** |
| **Convex write path** | None | **`api.matches.upsertOffline`** — idempotent upsert using `by_user_platform_external` index on `(user_id, platform="offline", external_match_id)` | **FIXED** |
| **Phone optional** | Required field | Phone is now optional — when absent, external_match_id uses random UUID (row is unique but won't de-dupe with phone-keyed row later) | **FIXED** |
| **Agent job enqueue** | None | On POST, best-effort queues `imessage_history_pull` (if phone) and `ig_enrich_match` (if Instagram handle) to Supabase `clapcheeks_agent_jobs` | **FIXED** |
| **Reactive UI update** | Manual reload required | `router.refresh()` on success triggers Convex re-fetch on matches page | **FIXED** |
| **Phone normalization** | None | `normalizePhoneE164` handles dashed (619-480-1234), parenthesized ((619) 480-1234), bare 10-digit, and 11-digit with leading 1; rejects short and non-1-starting 11-digit | **FIXED** |
| **Match list integration** | No inline "Add offline match" button | `OfflineContactForm` rendered in `MatchesPageClient.tsx` action bar alongside "Add Your First Match" link | **FIXED** |
| **Error handling** | None | Toast on success via `sonner`, inline error banner on validation/convex failures, form reset on close | **FIXED** |

---

## Detailed Flow Analysis

### 1. Full Round-Trip Sequence

```
  User clicks "Add offline match" button → OfflineContactForm modal opens
            │
            ▼
  User fills name, phone, email, notes → clicks "Add match"
            │
            ▼
  POST /api/matches/offline
    ├─ Validates name (required)
    ├─ Normalizes phone to E164 → `+1xxxxxxxxxx`
    ├─ Generates external_match_id: `offline:<digits>` or `offline:<uuid>`
    └─ Calls convex.mutation(api.matches.upsertOffline, { user_id, platform, ... })
            │
            ▼
  Convex upsert (idempotent on by_user_platform_external index)
    ├─ If existing: ctx.db.patch (update fields)
    └─ If new: ctx.db.insert with platform="offline"
            │
            ▼
  Best-effort: insert agent_jobs to Supabase
    ├─ imessage_history_pull (if phone provided)
    └─ ig_enrich_match (if instagram_handle provided)
            │
            ▼
  Success response → toast("Sarah added") → router.refresh()
            │
            ▼
  Match list re-renders with new row (Convex reactivity + SSR refresh)
```

### 2. API Route (`/api/matches/offline/route.ts`)

- **Auth:** Supabase `createClient()` — checks `auth.getUser()`, returns 401 if unauthenticated
- **Validation:** `name` required (400 if missing); phone optional but validates format (400 if invalid)
- **Phone Normalization:** `normalizePhoneE164()` strips non-digits, adds `+1` prefix for 10-digit numbers, accepts 11-digit with leading 1, rejects everything else
- **External ID Strategy:** 
  - With phone: `offline:<10-digit-phone>` — dedupes against future phone-keyed rows
  - Without phone: `offline:<uuid>` — unique per submission
- **Match Intel:** Email stored in `match_intel.email` since the `matches` schema has no dedicated email column
- **Convex Call:** `api.matches.upsertOffline` with fields: user_id, external_match_id, match_name, name, her_phone, source, primary_channel, handoff_complete, julian_shared_phone, handoff_detected_at, instagram_handle, met_at, first_impression, match_intel, status
- **Response:** 201 `{ ok: true, match: { id, external_id, name, phone_e164, email, instagram_handle } }`

### 3. Convex Mutation (`web/convex/matches.ts:605`)

- **Index:** `by_user_platform_external` on `["user_id", "platform", "external_match_id"]`
- **Upsert logic:** Query existing by index → if found, patch fields → if not, insert with `platform: "offline"`
- **Defaults:** `status` defaults to `"conversing"`, `last_activity_at` and `updated_at` set to `Date.now()`
- **Return:** `{ action: "inserted" | "updated", _id, external_id }`

### 4. Test Coverage

- **`web/__tests__/offline-contact-form.test.mjs`** — 7 `node:test` cases covering:
  - Phone normalization: dashed, parenthesized, bare digits, 11-digit with 1, short (rejected), 11-digit non-1 (rejected)
  - Payload shape validation
  - Missing name validation
  - Bad phone rejection

---

## Findings / Observations

### 1. Phone Storage in `her_phone` field
The offline route writes `phoneE164` (formatted as `+1xxxxxxxxxx`) into the `her_phone` field of the Convex match. This matches the convention established by the Phase F daemon for offline contacts. Verified that `her_phone` is typed as `v.string()` in the `upsertOffline` args — no null coalescing issue when phone is absent (route sends empty string `''` as fallback).

### 2. Agent Job Enqueue is Best-Effort
Job insertion to `clapcheeks_agent_jobs` on Supabase is wrapped in a try/catch with `console.warn` — failures are non-fatal and don't affect the match creation response. This is correct for the Phase F architecture where the daemon can pick up jobs on its next tick.

### 3. No SSR for Offline Matches
The `MatchesPageClient` component uses Convex `useQuery` for live subscription, so newly added offline matches appear reactively without manual page reload. The SSR path (`MatchesPage` server component) fetches via `ConvexHttpClient` — the `router.refresh()` triggers a re-fetch of this server component, updating the initial paint for the next page load.

---

## Code Reference Index

| Feature Concern | File Path & Line |
|-----------------|-----------------|
| **OfflineContactForm component** | `web/components/matches/OfflineContactForm.tsx:15` |
| **API route POST handler** | `web/app/api/matches/offline/route.ts:38` |
| **Phone E164 normalization** | `web/app/api/matches/offline/route.ts:31` |
| **External ID generation** | `web/app/api/matches/offline/route.ts:77` |
| **Convex upsertOffline mutation** | `web/convex/matches.ts:605` |
| **Convex matches schema index** | `web/convex/schema.ts:1498` |
| **Convex platform enum (offline)** | `web/convex/schema.ts:1433` |
| **OfflineContactForm test suite** | `web/__tests__/offline-contact-form.test.mjs:1` |
| **Match list integration (MatchesPageClient)** | `web/components/matches/MatchesPageClient.tsx:164` |
