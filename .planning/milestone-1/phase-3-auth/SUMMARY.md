---
phase: 3
plan: auth
subsystem: authentication
tags: [supabase, auth, next-js, middleware, oauth, email-password, rls]
requires: [phase-2-landing]
provides: [user-auth, protected-routes, user-profiles-table]
affects: [phase-4-schema, phase-5-deploy]
tech-stack:
  added:
    - "@supabase/supabase-js ^2"
    - "@supabase/ssr ^0"
  patterns:
    - Supabase SSR with createServerClient/createBrowserClient
    - Next.js route groups for layout isolation
    - Server Actions for auth mutations
    - Middleware-based session refresh and route protection
key-files:
  created:
    - web/lib/supabase/client.ts
    - web/lib/supabase/server.ts
    - web/middleware.ts
    - web/app/auth/actions.ts
    - web/app/auth/callback/route.ts
    - web/app/login/page.tsx
    - web/app/login/layout.tsx
    - web/app/signup/page.tsx
    - web/app/signup/layout.tsx
    - web/app/(main)/layout.tsx
    - web/.env.local.example
    - supabase/migrations/20240101000001_create_user_profiles.sql
  modified:
    - web/app/layout.tsx
    - web/app/(main)/dashboard/page.tsx
decisions:
  - "Used route groups ((main) vs auth) to isolate Navbar/Footer from auth pages"
  - "Server Actions for login/signup/logout — keeps auth logic server-side"
  - "Middleware refreshes session on every request per Supabase SSR docs"
  - "Profiles table auto-created via DB trigger on auth.users insert"
completed: 2026-03-01
duration: "~25 minutes"
---

# Phase 3 Auth Summary

## One-liner

Supabase SSR auth with email/password + Google OAuth, middleware-protected /dashboard, and auto-provisioned user profiles via DB trigger.

## What Was Built

### Supabase Client Utilities

Two client factories following the @supabase/ssr pattern:

- `web/lib/supabase/client.ts` — `createBrowserClient` for client components
- `web/lib/supabase/server.ts` — `createServerClient` with cookie jar for Server Components and Route Handlers

### Auth Server Actions (`web/app/auth/actions.ts`)

- `login(formData)` — email+password sign in, redirects to /dashboard
- `signup(formData)` — creates account with optional full_name, redirects to /dashboard
- `loginWithGoogle()` — initiates OAuth flow, redirects to Supabase
- `logout()` — signs out, redirects to /

### OAuth Callback Route (`web/app/auth/callback/route.ts`)

Exchanges the OAuth code for a session cookie. Supabase redirects here after Google auth.

### Login Page (`/login`)

Dark-themed, matches brand aesthetic:
- Google OAuth button (top)
- Email + password form
- Error display from URL params or server action response
- Link to /signup

### Signup Page (`/signup`)

Dark-themed, matching login:
- Google OAuth button (top)
- Full name, email, password, confirm password fields
- Client-side password match validation
- Post-signup "check your email" confirmation screen
- Link to /login

### Middleware (`web/middleware.ts`)

Runs on every request (excluding static assets):
1. Refreshes Supabase session via cookie manipulation
2. Redirects unauthenticated users hitting /dashboard to /login?next=/dashboard
3. Redirects authenticated users hitting /login or /signup to /dashboard

### Route Group Restructure

Moved pages into `(main)` route group so Navbar/Footer only wrap public pages:
- `web/app/(main)/layout.tsx` — has Navbar + Footer
- `web/app/layout.tsx` — root layout, body only (no Navbar/Footer)
- Auth pages (login/signup) use root layout directly — no Navbar/Footer

### Dashboard Update

Dashboard is now a Server Component that:
- Reads current user via `supabase.auth.getUser()`
- Shows personalized greeting with user's name
- Has a sign-out form (server action)
- Shows user email in header

### Database Migration

`supabase/migrations/20240101000001_create_user_profiles.sql`:
- `public.profiles` table with id, email, full_name, avatar_url, timestamps
- RLS enabled: users can only view/update their own profile
- `handle_new_user()` trigger auto-creates profile row on `auth.users` insert
- `set_updated_at()` trigger keeps `updated_at` current

## Commits

| Hash    | Description |
|---------|-------------|
| 47bc07b | Install @supabase/supabase-js and @supabase/ssr, add env example and client utilities |
| 3e9d684 | Add /login page with email+password and Google OAuth |
| 4c13200 | Add /signup page with email+password and Google OAuth |
| 3cebc99 | Add Supabase SSR middleware for session refresh and route protection |
| b0127bf | Restructure routes into (main) group, protect /dashboard with auth |
| d3be488 | Add user profiles table migration with RLS policies and auto-create trigger |
| 3144b64 | Add NEXT_PUBLIC_SITE_URL to env example |

## Decisions Made

| Decision | Why |
|----------|-----|
| Route groups for layout isolation | Auth pages need no Navbar/Footer; cleaner than conditional rendering in root layout |
| Server Actions for auth | Keeps credentials server-side, enables seamless redirect after auth |
| @supabase/ssr (not auth-helpers) | auth-helpers deprecated; ssr package is the current recommendation |
| Profiles trigger on DB | Guarantees profile exists for every user regardless of how they signed up |
| Middleware pattern from Supabase docs | Required for session cookie refresh to work correctly with SSR |

## Pending: Supabase Credentials Checkpoint

All code is complete. To activate auth, the following is needed:

1. Create `.env.local` in `web/` with:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ```
2. Run the migration against your Supabase project
3. Enable Google OAuth in Supabase Auth settings (add `http://localhost:3000/auth/callback` as redirect URL)

## Next Phase Readiness

Phase 4 (Schema) can proceed — the `profiles` table is the base. Additional tables (swipes, matches, analytics) should reference `profiles.id` via foreign key.

## Deviations from Plan

### Auto-fixed: Route group restructure (Rule 1/2 — Required for correctness)

The root layout had Navbar/Footer unconditionally. Auth pages needed to render without them. Rather than adding conditional logic in the root layout (fragile), restructured into `(main)` route group with its own layout. This is the idiomatic Next.js 14 approach.

No other deviations — plan executed as written.
