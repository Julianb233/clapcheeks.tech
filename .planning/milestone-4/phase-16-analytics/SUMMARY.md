# Phase 16: Analytics Dashboard Summary

**One-liner:** Full Recharts analytics dashboard with Rizz Score gauge, 30-day trend charts, platform breakdown, conversion funnel, and spend tracker

## What Was Built

### DB Migration (`web/scripts/005_analytics_extended.sql`)
- `clapcheeks_conversation_stats` table for tracking reply rates per user/day/platform
- `clapcheeks_spending` table for date spend tracking with category constraints
- RLS policies (select/insert/update own rows) matching existing pattern
- Composite indexes on (user_id, date) for query performance

### Rizz Score Library (`web/lib/rizz.ts`)
- `calculateRizzScore()` pure function: reply_rate * 0.40 + date_conversion * 0.40 + match_rate * 0.20, scaled 0-100
- `getRizzTrend()` week-over-week comparison returning direction + delta
- `getRizzColor()` for conditional styling (red < 40, yellow 40-70, green > 70)

### Analytics API Route (`web/app/api/analytics/summary/route.ts`)
- GET endpoint with Supabase auth
- 30-day aggregates across analytics_daily + conversation_stats + spending
- Per-platform breakdown, time series, conversion funnel
- Rizz Score with week-over-week trend
- Spending summary with cost-per-match and cost-per-date

### Dashboard Components (Recharts)
- **TrendCard** -- stat card with week-over-week trend arrow and delta percentage
- **RizzScoreCard** -- circular SVG gauge (0-100), color-coded, with trend and breakdown
- **SwipeMatchChart** -- AreaChart with dual gradients (purple swipes, pink matches)
- **PlatformBreakdown** -- grouped BarChart per platform (swipes vs matches)
- **ConversionFunnel** -- horizontal BarChart: Swipes -> Matches -> Conversations -> Dates
- **SpendingChart** -- totals row + category BarChart with color-coded bars
- **DashboardCharts** -- client wrapper that renders all chart components

### Dashboard Page Rewrite
- Expanded stats row from 4 to 5 cards: Swipes Today, Total Matches, Dates Booked, Match Rate, Rizz Score
- All stat cards now show week-over-week trend arrows
- Recharts section below the live platform table
- Empty state with install CTA when no agent connected
- Waiting state when agent connected but no data yet
- Preserved existing: DashboardLive (polling + platform table), Elite Features, AI Coaching
- Replaced non-rendering `brand-*` classes with standard Tailwind purple/pink

## Commits

| Hash | Description |
|------|-------------|
| fd4504f | chore(16): add analytics extended DB migration |
| 378bce0 | feat(16): add Rizz Score calculation library |
| 5a8b2a5 | feat(16): add analytics summary API route |
| 488d3f4 | feat(analytics): phase 16 full analytics dashboard |

## Key Files

### Created
- `web/scripts/005_analytics_extended.sql`
- `web/lib/rizz.ts`
- `web/app/api/analytics/summary/route.ts`
- `web/app/(main)/dashboard/components/trend-card.tsx`
- `web/app/(main)/dashboard/components/rizz-score-card.tsx`
- `web/app/(main)/dashboard/components/analytics-charts.tsx`
- `web/app/(main)/dashboard/components/platform-breakdown.tsx`
- `web/app/(main)/dashboard/components/conversion-funnel.tsx`
- `web/app/(main)/dashboard/components/spending-chart.tsx`
- `web/app/(main)/dashboard/components/dashboard-charts.tsx`

### Modified
- `web/app/(main)/dashboard/page.tsx`
- `web/app/(main)/dashboard/components/dashboard-live.tsx`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Concurrent agent modifications**
- Found during: Task 4 (dashboard rewrite)
- Issue: Other agents modified `page.tsx` concurrently, adding DashboardLive, PlanBadge, EliteOnly, CoachingSection, and rebranding to "Outward"
- Fix: Integrated analytics additions alongside existing components instead of replacing them
- Files modified: page.tsx

**2. [Rule 1 - Bug] Non-rendering `brand-*` CSS classes**
- Found during: Task 4
- Issue: `brand-400`, `brand-900`, etc. are not defined in any CSS/Tailwind config and don't render
- Fix: Replaced with standard Tailwind `purple-400`, `purple-900`, etc.
- Files modified: page.tsx, dashboard-live.tsx

## Decisions Made

| Decision | Reason |
|----------|--------|
| Server-side data fetching + client chart rendering | Recharts needs browser APIs; data stays secure server-side |
| DashboardCharts as single client wrapper | One `"use client"` boundary for all charts, receives pre-computed data as props |
| Preserved DashboardLive alongside new charts | Another agent built a polling platform table; both views complement each other |
| Standard Tailwind colors over custom `brand-*` | brand-* classes had no CSS definition |
