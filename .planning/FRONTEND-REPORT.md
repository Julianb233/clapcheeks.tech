# Frontend Audit Report

## Audit Scope
All `page.tsx` files under `web/app/`, root layout, `(main)/layout.tsx`, navbar, middleware, and Supabase middleware.

Total pages audited: 40

---

## Issues Found & Fixed

### 1. CRITICAL: "Outward" Branding Bugs (5 occurrences - ALL FIXED)

| File | Line | Old Text | Fix |
|------|------|----------|-----|
| `app/home/page.tsx` | 43 | `Outward` (header) | Changed to `Clapcheeks` |
| `app/safety/page.tsx` | 48 | `...by the Outward agent` | Changed to `Clapcheeks agent` |
| `app/diagnostics/page.tsx` | 108 | `...the Outward agent is running` | Changed to `Clapcheeks agent` |
| `app/diagnostics/page.tsx` | 110 | `outward status` (CLI cmd) | Changed to `clapcheeks status` |
| `app/groups/page.tsx` | 52 | `...your Outward agent` | Changed to `Clapcheeks agent` |

### 2. Spanish Language Text in `complete-profile/page.tsx` (ALL FIXED)

The entire complete-profile page was in Spanish. Translated all labels, placeholders, error messages, and button text to English:
- "Completa tu Perfil" -> "Complete Your Profile"
- "Foto de Perfil" -> "Profile Photo"
- "Tomar Foto" / "Subir Archivo" -> "Take Photo" / "Upload File"
- "Telefono" -> "Phone"
- "Direccion" -> "Address"
- "Fecha de Nacimiento" -> "Date of Birth"
- "Contacto de Emergencia" -> "Emergency Contact"
- "Nombre Completo" -> "Full Name"
- "Guardando..." / "Completar Perfil" -> "Saving..." / "Complete Profile"
- Phone placeholders changed from Chilean format (+56) to US format (+1)
- "o" -> "or" connector
- Error messages translated

### 3. Grammar Fix in `affiliate/apply/page.tsx` (FIXED)

- "Become an Clapcheeks Affiliate" -> "Become a Clapcheeks Affiliate"

---

## Issues Found - NOT Fixed (Require Other Teams)

### 4. Legacy Light-Theme Pages (UI/UX team)

Several pages use a light pink/purple gradient theme (`bg-gradient-to-br from-pink-50 via-purple-50 to-teal-50`) instead of the brand-mandated dark theme (`bg-black`). These are legacy "Outward" era pages that were never restyled:

- `app/home/page.tsx` - Old dashboard (light theme, uses legacy nav)
- `app/safety/page.tsx` - Privacy/data page (light theme)
- `app/diagnostics/page.tsx` - Agent status (light theme)
- `app/groups/page.tsx` - Conversations list (light theme)
- `app/notifications/page.tsx` - Notifications (light theme)
- `app/events/page.tsx` - Upcoming dates (light theme)
- `app/profile/page.tsx` - User profile (light theme, references sports/events - not dating)
- `app/profile/edit/page.tsx` - Edit profile (light theme)
- `app/profile/verify/page.tsx` - Verification (light theme)
- `app/complete-profile/page.tsx` - Profile completion (light theme)
- `app/auth/sign-up/page.tsx` - Sign-up form (light theme)
- `app/auth/verify-email/page.tsx` - Email verification (light theme)
- `app/auth/sign-up-success/page.tsx` - Sign-up success (light theme)

These pages need full restyling to match the dark theme used by all `(main)/` routes.

### 5. Legacy Content Mismatch in `profile/page.tsx`

The profile page references "sports", "events created", "events joined", "groups", "reputation score" - these are from a different product (sports social app). This page needs a full rewrite to match the dating co-pilot product.

### 6. Middleware: `complete-profile` Redirect (Backend team)

`web/lib/supabase/middleware.ts` lines 63-71 force all authenticated users to `/complete-profile` if `profile_completed` is falsy. This blocks access to all app routes for users who haven't completed the legacy profile form. The backend team should review whether this redirect is still desired, or if it should be removed/made optional since the main dashboard flow doesn't require it.

### 7. `home/page.tsx` Legacy Dashboard

The `/home` route is a legacy dashboard page that duplicates functionality of the new `/dashboard` route. It has a completely different design and references "Outward" styling patterns. Consider removing or redirecting to `/dashboard`.

### 8. Missing Route Protection

The middleware `publicRoutes` list includes `/diagnostics` as public, but the diagnostics page itself checks for auth and redirects. This is inconsistent but not broken. The `/device` and `/safety` routes are not listed as public but are behind the `(main)` layout which wraps public landing content - this may cause issues for unauthenticated users trying to view these pages.

---

## Pages Audited - No Issues Found

These pages are clean, properly branded, and well-structured:

- `app/layout.tsx` - Root layout (correct metadata, dark mode forced)
- `app/(main)/layout.tsx` - Main layout with Navbar + Footer
- `app/(main)/page.tsx` - Landing page (Hero, Features, HowItWorks, etc.)
- `app/(main)/dashboard/page.tsx` - Full dashboard with analytics, charts, coaching
- `app/(main)/settings/page.tsx` - Weekly report preferences
- `app/(main)/intelligence/page.tsx` - Conversation intelligence analytics
- `app/(main)/device/page.tsx` - Device add-on landing page
- `app/(main)/affiliate/page.tsx` - Affiliate dashboard
- `app/(main)/pricing/page.tsx` - Pricing page with tiers and FAQ
- `app/(main)/reports/page.tsx` - Weekly reports
- `app/(main)/billing/page.tsx` - Billing management
- `app/(main)/analytics/page.tsx` - Analytics deep dive
- `app/(main)/coaching/page.tsx` - AI coaching tips
- `app/(main)/conversation/page.tsx` - Conversation AI with voice profiles
- `app/(main)/referrals/page.tsx` - Referral program
- `app/(main)/photos/page.tsx` - Photo optimizer
- `app/login/page.tsx` - Login page
- `app/signup/page.tsx` - Signup page
- `app/onboarding/page.tsx` - Onboarding wizard
- `app/auth/login/page.tsx` - Auth login redirect
- `app/privacy/page.tsx` - Privacy policy
- `app/terms/page.tsx` - Terms of service
- `app/press/page.tsx` - Press & media kit
- `app/activate/page.tsx` - Device activation
- `app/affiliate/apply/page.tsx` - Affiliate application
- `app/admin/page.tsx` - Admin overview
- `app/admin/revenue/page.tsx` - Admin revenue
- `app/admin/users/page.tsx` - Admin users
- `app/admin/events/page.tsx` - Admin events

---

## Navbar & Layout Review

- `components/layout/navbar.tsx` - Correct. Links to Features, How It Works, Pricing, Device. Sign in links to /dashboard.
- `app/(main)/layout.tsx` - Correct. Renders Navbar, Footer, PageOrbs.
- `middleware.ts` - Handles referral cookie and delegates to Supabase middleware for auth.
- `lib/supabase/middleware.ts` - Protects routes, redirects to /login, has complete-profile redirect.

---

## Summary

| Category | Count |
|----------|-------|
| Branding bugs fixed ("Outward") | 5 |
| Spanish text translated | 15+ strings |
| Grammar fixes | 1 |
| Legacy theme pages (needs UI/UX) | 13 |
| Legacy content pages (needs rewrite) | 1 |
| Middleware concerns (backend) | 1 |
