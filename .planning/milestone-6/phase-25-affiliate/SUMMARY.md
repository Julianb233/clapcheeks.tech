# Phase 25: Affiliate Dashboard Summary

## One-liner
Public affiliate application page with form, API route, database migration, and placeholder Rewardful dashboard.

## What Was Built

### Database Migration (`web/scripts/011_affiliates.sql`)
- `clapcheeks_affiliate_applications` table with name, email, platform, audience_size, message, status

### Public Application Page (`web/app/affiliate/apply/page.tsx`)
- No auth required — fully public page
- Headline: "Become a [brand] Affiliate"
- Commission details: 25% recurring, 60-day cookie, monthly payouts
- Earning potential calculator (10 Base = $242.50/mo, 10 Elite = $492.50/mo)
- Application form: name, email, platform select, audience size, message
- Success confirmation state

### API Route (`web/app/api/affiliate/apply/route.ts`)
- POST handler with input validation
- Email format validation
- Saves to clapcheeks_affiliate_applications table

### Placeholder Dashboard (`web/app/(main)/affiliate/page.tsx`)
- For authenticated affiliates
- Shows Rewardful integration setup instructions
- Links to apply page for non-affiliates

### Footer Update
- Added "Affiliates" and "Press" links to footer Company section

### Public Routes
- Added `/affiliate/apply`, `/press`, `/privacy`, `/terms` to public routes in Supabase middleware

## Commit
- Files included in rebrand commit `e86b37e` via auto-commit hook

## Deviations from Plan
None — plan executed as written. Rewardful integration deferred as planned (requires account setup).
