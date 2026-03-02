# Phase 24: Referral Program Summary

## One-liner
Referral system with nanoid codes, 30-day cookie tracking, Stripe credit conversion, and dashboard UI.

## What Was Built

### Database Migration (`web/scripts/010_referrals.sql`)
- `clapcheeks_referrals` table with status tracking (pending/converted/credited)
- Profile columns: `ref_code`, `referred_by`, `referral_credits`
- Indexes on ref_code and referrer_id

### API Routes
- `POST /api/referral/generate` — generates unique 8-char nanoid ref code, saves to profile
- `POST /api/referral/track` — validates ref code, sets 30-day httpOnly cookie
- `POST /api/referral/convert` — called by webhook on first payment, applies Stripe customer balance credit

### Middleware Update (`web/middleware.ts`)
- Captures `?ref=XXXX` URL parameter on any page visit
- Sets referral tracking cookie (30-day, httpOnly, secure, sameSite lax)
- Passes through to Supabase session middleware

### Referral Dashboard (`web/app/(main)/referrals/page.tsx`)
- Client component with real-time data loading
- Unique referral link display with copy button
- Share buttons (Twitter/X, Copy Link)
- Stats: referrals sent, converted, credits earned
- How it works: 3-step visual guide
- Referral list with status badges (pending/converted/credited)

## Dependencies Added
- `nanoid` — for generating unique referral codes

## Commit
- `cbdd40c`: feat(referral): phase 24 — referral program

## Deviations from Plan
None — plan executed as written.
