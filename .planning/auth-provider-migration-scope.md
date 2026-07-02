# Auth Provider Migration — Scope & Provider Decision

**Linear:** AI-9538 (sub of AI-9526-E) — *"Supabase Auth + profiles to external auth provider"*
**Type:** SCOPE / DECISION ONLY — no implementation shipped in this pass.
**Author:** dev (autonomous)
**Date:** 2026-07-02
**Repo:** `clapcheeks.tech/web`

---

## TL;DR

The premise of the parent issue is **stale**. Clapcheeks is **not** running on Supabase Auth anymore.
The session layer was already migrated to a **bespoke, Convex-native single-operator session**
(`lib/auth/operator-session.ts`) behind a **Supabase-API compat facade** (`lib/convex/compat-client.ts`),
so the "127 call sites + bcrypt passwords + session middleware" migration described in the issue is
largely **already complete**.

What is actually left is smaller and different from "pick Clerk vs Auth.js":

1. **A product decision** (for Julian): does clapcheeks stay **single-operator** or does it ever need
   **true multi-user auth**? This is the only real fork and it gates everything below.
2. **Retire dead Supabase-Auth client code** (the `@supabase/ssr` browser client + a handful of pages
   that still import it).
3. **Migrate or formally keep** ~15 remaining Supabase **service-role DB** call sites (these are database
   access, **not** auth).
4. **Realtime**: one hook (`lib/realtime/messages.ts`) still uses Supabase Realtime channels.
5. **Session/password hardening** review before any multi-user expansion.

**Recommended provider decision:**
- **While single-operator (today):** keep the Convex-native operator session. Clerk and Auth.js are both
  premature overhead. Do **not** add a third-party IdP.
- **If/when multi-user is required:** choose **Clerk + Convex** (first-class native integration) over
  Auth.js + Convex Auth. Rationale in §5.

---

## 1. Current-state architecture (verified in code, 2026-07-02)

### 1.1 The session layer is already Convex-native and Supabase-Auth-free

`app/auth/actions.ts` (the login/logout server actions) call:

```ts
import { clearOperatorSession, setOperatorSession, signInOperator } from '@/lib/auth/operator-session'
```

`lib/auth/operator-session.ts` implements a self-contained session system:

| Concern | Implementation | Notes |
|---|---|---|
| Password hash | **PBKDF2-SHA256, 310,000 iterations**, 32-byte, per-hash random salt | Stored in env `CLAPCHEEKS_OPERATOR_PASSWORD_HASH`. **Not bcrypt.** |
| Session token | HMAC-SHA256 signed cookie `cc_operator_session` (`base64url(payload).sig`) | 7-day TTL, `httpOnly`/`secure`/`sameSite=lax` |
| Secret | `CLAPCHEEKS_AUTH_SECRET` (falls back to `NEXTAUTH_SECRET`) | HMAC signing key |
| Identity | **Single hardcoded operator** — `operatorUser()` returns one user (`CONVEX_FLEET_USER_ID` / `CLAPCHEEKS_OPERATOR_EMAIL`, default `fleet-julian` / Julian) | `signInOperator` **rejects any email except the one operator** |

**Implication:** the "user passwords (BCrypt → new hash)" migration line in the parent issue is moot.
There is exactly **one** operator credential, already hashed with PBKDF2. There is no table of end-user
passwords to migrate.

### 1.2 Supabase middleware is a no-op

`lib/supabase/middleware.ts`:

```ts
export async function updateSession(request: NextRequest) {
  return NextResponse.next({ request })
}
```

The root `middleware.ts` still calls `updateSession` (for cookie/ref-code + security headers) but it no
longer refreshes a Supabase session. The "session middleware" migration is done.

### 1.3 The 164 `supabase.*` call sites go through a compat facade

`lib/supabase/server.ts` no longer returns a real Supabase client:

```ts
import { createServerClient } from "@/lib/convex/compat-client"
import { getCurrentOperatorUser } from "@/lib/auth/operator-session"

export async function createClient() {
  return createServerClient({ user: await getCurrentOperatorUser() })
}
```

`lib/convex/compat-client.ts` (~35 KB) reimplements the Supabase `.from(table).select()/.insert()/...`
and `.auth.getUser()` surface on top of Convex queries/mutations (`tableToConvexList` map, etc.). This is
why the call sites did **not** all need rewriting — they call the facade, which routes to Convex. E.g. the
Google OAuth routes still read `await supabase.auth.getUser()` but that now resolves to the operator user,
not a Supabase JWT.

### 1.4 Convex is the system of record

`convex/schema.ts` keys ~everything by `user_id: v.string()` (comments still say "Supabase auth user id"
but it is now just the operator id string). Stripe mapping lives in Convex (`convex/billing.ts`
`stripe_customer_id`, `convex/schema.ts` `by_customer_ts` index) — so the "Stripe customer mapping"
concern is already Convex-side, not Supabase-Auth-coupled.

---

## 2. Corrected scope numbers (source-only, excludes node_modules/.next)

| Metric | Issue estimate | Verified actual | Notes |
|---|---|---|---|
| `supabase.auth.*` / query call sites | 127 | **164** | but nearly all routed through the compat facade already |
| Files touching supabase auth/client | — | **110** | most are facade consumers, not real Supabase |
| `from('profiles')` reads | 56 | **54** | served by compat facade → Convex |
| bcrypt password call sites | (implied) | **0** | no bcrypt in source; operator uses PBKDF2 |
| **Real** `@supabase/supabase-js` / `@supabase/ssr` imports | — | **15 files** | see §3 — these are DB/service-role/realtime, not auth |

The headline "127 call sites to migrate" overcounts the remaining work by ~10×, because the compat facade
already absorbed the bulk of it.

---

## 3. What actually still touches real Supabase (the true remaining surface)

These 15 files import `@supabase/supabase-js` or `@supabase/ssr` directly (bypassing the compat facade).
**None of them is session auth** — they are service-role DB access, browser DB client, or realtime:

**Service-role DB (server, `SUPABASE_SERVICE_ROLE_KEY`):**
- `app/api/notify/route.ts`
- `app/api/conversation/[matchId]/attach/route.ts`
- `app/api/conversation/[matchId]/typing/route.ts`
- `app/api/stripe/webhook/route.ts`
- `app/api/ingest/api-result/route.ts`
- `app/api/reports/weekly/route.ts`
- `app/api/affiliate/apply/route.ts`
- `app/api/referral/track/route.ts`
- `app/api/referral/convert/route.ts`
- `lib/billing/dunning.ts`
- `lib/supabase/admin.ts` (service-role factory)

**Browser DB client (`@supabase/ssr` `createBrowserClient`):**
- `lib/supabase/client.ts` (factory)
- `app/(main)/referrals/page.tsx`
- `app/(main)/support/page.tsx`

**Realtime:**
- `lib/realtime/messages.ts` (Supabase Realtime channels: `inbox-stream:${userId}`)

**Consequence:** Supabase is still live as a **database + realtime backend** for a slice of features even
though Supabase **Auth** is gone. "Replace Supabase Auth" is done; "fully retire Supabase" is a **separate,
larger** effort that overlaps the DB migration audit (AI-8769, `.planning/migration-audit/`).

---

## 4. The one real open decision (escalate to Julian)

**Does clapcheeks ever need multi-user auth, or is single-operator the permanent model?**

Everything today assumes a single operator (`fleet-julian`). The alpha/product docs (`docs/alpha/`) describe
end-user installs, which *could* imply future multi-tenant. Until this is answered, do **not** invest in a
third-party IdP — it would be built against an unknown requirement.

| If the answer is… | Then… |
|---|---|
| **Single-operator forever** (agency runs it on behalf of one principal) | Keep operator-session. Close AI-9538 by retiring dead Supabase-Auth code (§6.1) + hardening (§6.4). No IdP. |
| **Multi-user, soon** | Adopt **Clerk + Convex** (§5). Plan a distinct implementation epic; operator-session becomes the fallback/admin path or is replaced. |
| **Multi-user, someday (not now)** | Stay on operator-session now; record Clerk+Convex as the chosen future path so we don't re-litigate. |

---

## 5. Provider decision matrix (only relevant if multi-user is chosen)

The stack is **Next.js 15 App Router + Convex 1.37 as system of record**. That single fact dominates the
choice: pick whatever integrates most cleanly with Convex on the server and in React.

| Criterion | Clerk + Convex | Auth.js (NextAuth v5) + Convex Auth | Bespoke operator-session (today) |
|---|---|---|---|
| Native Convex integration | **First-class** (`ConvexProviderWithClerk`, JWT template, `ctx.auth`) | Convex Auth is Convex's own lib; Auth.js needs bridging | N/A (custom `user_id` string) |
| Multi-user / orgs / RBAC | **Built-in** (orgs, roles, invitations) | Roll your own | **None** — single operator |
| Hosted UI, MFA, passkeys, social | **Managed** | Self-hosted, more wiring | None |
| Password migration effort | Import via Clerk migration API (or force reset) | Manual | N/A (1 credential) |
| Ongoing cost | Per-MAU pricing | Free (self-host) | Free |
| Vendor lock-in | Higher | Lower | None |
| Time-to-multi-user | **Lowest** | Medium/High | N/A |

**Recommendation:** if multi-user is required, **Clerk + Convex**. Convex documents Clerk as a primary auth
integration, it removes the need to hand-build orgs/roles/MFA, and it maps cleanly onto the existing
`user_id`-keyed Convex schema (swap the operator id for Clerk's `subject`). Auth.js + Convex Auth is the
lower-cost / lower-lock-in alternative but shifts org/role/MFA/reset burden back onto us — not worth it for a
paid agency product that wants to ship, unless cost sensitivity is high.

**Do not** reintroduce Supabase Auth. The migration away from it is already paid for.

---

## 6. Remaining work breakdown (for the implementation sub-issue(s))

> Spawn these only after §4 is answered. Estimates assume single dev.

### 6.1 Retire dead Supabase-Auth client code — **~0.5 day** (safe now, regardless of §4)
- Audit `lib/supabase/client.ts` (`createBrowserClient`) consumers: `app/(main)/referrals/page.tsx`,
  `app/(main)/support/page.tsx`, `lib/realtime/messages.ts`.
- Confirm whether these still need Supabase (DB/realtime) or can move to Convex `useQuery`.
- Remove `@supabase/ssr` usage where it's only auth-shaped.

### 6.2 Migrate remaining service-role DB call sites to Convex — **~1–1.5 days** (overlaps AI-8769)
- The 11 service-role files in §3. Each reads/writes a Postgres table that has (or needs) a Convex
  equivalent. Coordinate with `.planning/migration-audit/inventory.md` so we don't migrate a table twice.
- Or **explicitly decide to keep Supabase as a DB** for these and document that boundary. (Cheapest path.)

### 6.3 Realtime — **~0.5 day**
- `lib/realtime/messages.ts` uses Supabase Realtime. Convex `useQuery` is already reactive
  (see AI-10022 dashboard-briefing realtime work). Port the inbox stream to a Convex subscription and drop
  the Supabase channel.

### 6.4 Session / password hardening — **~0.5 day**
- Operator session token has **no rotation/refresh** and a fixed 7-day exp; consider sliding expiry.
- HMAC secret + password hash both live in env; document rotation procedure.
- If going multi-user, PBKDF2-310k is fine but re-evaluate vs argon2id; and the single-operator
  short-circuit in `signInOperator` must be removed.

### 6.5 (Multi-user only) Clerk + Convex integration — **~1–2 days**
- Add `ConvexProviderWithClerk`, Clerk JWT template, swap `user_id` derivation to Clerk `subject`.
- Migrate/seed users; decide password strategy (import vs reset).
- Replace login/actions + operator-session, or keep operator-session as an admin backdoor.

**Total remaining (single-operator close-out): ~1.5–2 days.**
**Total remaining (full Supabase retirement + multi-user): ~4–6 days.**

---

## 7. Recommendation & next action

1. **Escalate §4 to Julian** — single-operator vs multi-user is a product call, not an engineering one.
2. **If single-operator:** re-scope AI-9538 to "retire dead Supabase-Auth code + session hardening"
   (§6.1, §6.4) — a ~1-day cleanup, not a 1–2-day auth migration. The scary parts are already done.
3. **If multi-user:** open an implementation epic for **Clerk + Convex** (§6.5) and sequence §6.1–6.4 under it.
4. Either way, **do not reintroduce Supabase Auth**, and **do not add Clerk/Auth.js speculatively** while
   the app is single-operator.

*This document is the deliverable for AI-9538 (scope only). No production code was changed.*
