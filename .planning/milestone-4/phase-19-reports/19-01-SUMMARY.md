---
phase: 19-reports
plan: 01
subsystem: email
tags: [react-email, resend, anthropic, vercel-cron, weekly-reports]
dependency-graph:
  requires: [16-analytics, 17-coaching]
  provides: [weekly-email-reports, email-preferences-settings]
  affects: []
tech-stack:
  added: ["@react-email/components"]
  patterns: [react-email-templates, cron-triggered-email-pipeline, ai-content-generation]
key-files:
  created:
    - web/lib/email/weekly-report.tsx
    - web/app/api/reports/weekly/route.ts
    - web/app/(main)/settings/page.tsx
  modified:
    - vercel.json
    - web/package.json
    - web/app/api/reports/preferences/route.ts
decisions:
  - id: light-email-theme
    decision: "Light theme email (white bg) instead of dark for email client compatibility"
    reason: "Dark backgrounds cause rendering issues in Outlook/Gmail; light theme with brand accents is safer"
  - id: profiles-email-fetch
    decision: "Batch fetch emails from profiles table instead of admin.getUserById loop"
    reason: "Single query vs N queries; follows plan guidance to avoid auth admin loop"
metrics:
  duration: "~10 min"
  completed: "2026-03-02"
---

# Phase 19 Plan 01: Weekly Report Email System Summary

React Email template with AI-generated tips, Resend delivery, Vercel Cron scheduling, and settings page for email preferences.

## What Was Built

### React Email Template (`web/lib/email/weekly-report.tsx`)
- Built with `@react-email/components` (Html, Head, Body, Container, Section, Text, Button, Hr, Preview)
- Light theme for email client compatibility (white background, brand accents)
- Stats grid: 2x2 table with Swipes, Matches, Conversations, Dates
- Trend indicators: green up arrow / red down arrow / gray dash with percentage
- AI Tip section: bordered card in fuchsia accent
- CTA button: "View Full Analytics" linking to /dashboard
- Footer: clapcheeks.tech + Unsubscribe link
- Exported `renderWeeklyReportEmail()` helper for HTML string output

### Weekly Report API Route (`web/app/api/reports/weekly/route.ts`)
- GET endpoint protected by `Authorization: Bearer CRON_SECRET`
- Queries active subscribers, filters by `email_enabled` preference
- Batch-fetches user emails from `profiles` table (avoids admin.getUserById loop)
- For each eligible user (batched 10 at a time via Promise.allSettled):
  - Calls `generateReportData()` for last 7 days
  - Generates AI tip via Claude (`claude-sonnet-4-6`) with coaching session fallback
  - Renders React Email template to HTML
  - Sends via Resend from `reports@clapcheeks.tech`
  - Records in `clapcheeks_weekly_reports` (upsert on user_id + week_start)
- Returns JSON: `{ processed, errors, total }`
- `maxDuration = 300` for Vercel Pro timeout

### Vercel Cron Configuration (`vercel.json`)
- Added cron: `0 9 * * 1` (Monday 9am UTC) for `/api/reports/weekly`

### Settings Page (`web/app/(main)/settings/page.tsx`)
- Toggle: "Email weekly reports" (on/off)
- Select: Report day (Monday/Friday/Sunday)
- Save button calling `PUT /api/reports/preferences`
- Loads current preferences via new `GET /api/reports/preferences` handler
- Dark theme Tailwind classes matching existing UI (bg-white/5, border-white/10, etc.)

### Preferences API Enhancement (`web/app/api/reports/preferences/route.ts`)
- Added GET handler to load current user preferences
- Returns defaults if no preferences set yet

## Deviations from Plan

### Auto-added Missing Critical Functionality

**1. [Rule 2 - Missing Critical] Added GET handler for preferences API**
- **Found during:** Task 2
- **Issue:** Settings page needs to load current preferences, but only PUT existed
- **Fix:** Added GET handler returning user's preferences or sensible defaults
- **Files modified:** `web/app/api/reports/preferences/route.ts`
- **Commit:** f35da1f

**2. [Rule 1 - Bug] Light theme instead of dark for email**
- **Found during:** Task 1
- **Issue:** Plan noted dark bg may cause issues in Outlook/Gmail
- **Fix:** Used light theme (white bg) with brand color accents for maximum compatibility
- **Files modified:** `web/lib/email/weekly-report.tsx`
- **Commit:** 5805dbd

## Dependencies
- `@react-email/components` added to web/package.json

## Environment Variables Required
- `RESEND_API_KEY` - Resend email service API key
- `CRON_SECRET` - Bearer token for Vercel Cron authentication
- `ANTHROPIC_API_KEY` - For AI tip generation (already exists from coaching)
