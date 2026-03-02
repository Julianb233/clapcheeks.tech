# Phase 19: Weekly Reports Summary

Automated weekly PDF report system with @react-pdf/renderer for generation, Resend for email delivery, and Vercel Cron for scheduling.

## What Was Built

### Database
- `clapcheeks_weekly_reports` table with metrics_snapshot JSONB, pdf_url, sent_at
- `clapcheeks_report_preferences` table with email_enabled, send_day, send_hour
- RLS policies for user-scoped access

### PDF Report (`lib/reports/generate-pdf.tsx`)
- Dark-themed A4 PDF using @react-pdf/renderer
- Sections: Header, Rizz Score (large centered), Stats Grid (swipes/matches/dates/messages with week-over-week changes), Platform Breakdown, Conversion Funnel, AI Coaching Tips
- Colors: bg #0a0a0a, brand #c026d3, accent #e879f9, positive #4ade80, negative #f87171

### Report Data Generation (`lib/reports/generate-report-data.ts`)
- Queries clapcheeks_analytics_daily for current and previous week
- Aggregates per-platform stats
- Calculates conversion funnel (swipes->matches->convos->dates)
- Computes Rizz Score composite metric (match rate 40%, convo rate 30%, date rate 30%)
- Extracts latest coaching tips from clapcheeks_coaching_sessions

### Email Delivery (`lib/reports/send-report-email.ts`)
- Resend SDK integration
- Dark-themed HTML email with Rizz Score highlight
- PDF attached to email
- List-Unsubscribe header for compliance

### API Routes
- `POST /api/reports/generate` - generates report for authenticated user or cron
- `POST /api/reports/send` - sends latest report via email
- `GET /api/reports/cron` - batch processes all active subscribers (10 at a time)
- `PUT /api/reports/preferences` - updates email preferences

### Vercel Cron
- `vercel.json` configured: Sunday 8am UTC
- Batch processing with Promise.allSettled

### Frontend (`/reports` page)
- Report history list with download links
- Metrics preview (Rizz Score, matches)
- "Generate This Week" manual trigger button
- Report preferences form (email toggle, send day, send hour)

## Dependencies Added
- `@react-pdf/renderer` - PDF generation
- `resend` - email delivery

## Key Files
- `web/scripts/009_reports.sql`
- `web/lib/reports/generate-pdf.tsx`
- `web/lib/reports/generate-report-data.ts`
- `web/lib/reports/send-report-email.ts`
- `web/app/api/reports/generate/route.ts`
- `web/app/api/reports/send/route.ts`
- `web/app/api/reports/cron/route.ts`
- `web/app/api/reports/preferences/route.ts`
- `web/app/(main)/reports/page.tsx`
- `web/app/(main)/reports/reports-list.tsx`
- `web/app/(main)/reports/report-preferences.tsx`
- `web/vercel.json`

## Environment Variables Added
- `RESEND_API_KEY` - Resend email service
- `CRON_SECRET` - Vercel Cron authentication
