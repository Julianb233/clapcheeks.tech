# Phase 16: Analytics Dashboard

## Overview

Build a full-featured analytics dashboard replacing the current basic stats grid in `/web/app/(main)/dashboard/page.tsx`. The dashboard will show time-series charts (swipes, matches, conversations, dates, spending), conversion funnels, per-platform breakdowns, Rizz Score calculation, and week-over-week trend arrows. Uses Recharts (already in the project ecosystem, needs to be installed) for all chart rendering.

## Key Technical Decisions

**Recharts for charts** -- Declarative React components, composable, great for dashboards with <1000 data points (our use case). Already the standard choice for Next.js dashboards. Install `recharts` as a dependency.

**Client components for charts** -- Recharts requires browser APIs (SVG rendering). The dashboard page stays as a server component that fetches data, then passes it to client chart components via props. This keeps data fetching server-side (secure, fast) while rendering charts client-side.

**Rizz Score formula** -- Weighted composite:
- Reply rate: 40% (messages_sent that got replies / total messages_sent)
- Date conversion: 40% (dates_booked / matches)
- Match rate: 20% (matches / swipes_right)
- Score = (reply_rate * 0.4 + date_conversion * 0.4 + match_rate * 0.2) * 100, clamped 0-100

**Week-over-week trends** -- Compare current 7-day window to previous 7-day window. Show green up arrow / red down arrow / gray dash with percentage change.

**New DB tables needed** -- The existing `outward_analytics_daily` table covers swipes/matches/messages/dates. We need a `clapcheeks_conversations_analytics` table for reply-rate tracking (needed for Rizz Score) and a `clapcheeks_spending` table for date spending tracking.

## DB Schema Changes

### New table: `clapcheeks_conversation_stats`
```sql
create table if not exists public.clapcheeks_conversation_stats (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  platform text not null,
  messages_sent int default 0,
  messages_received int default 0,
  conversations_started int default 0,
  conversations_replied int default 0,  -- they replied to our opener
  conversations_ghosted int default 0,  -- no reply after 48h
  avg_response_time_mins int,           -- average time to get reply
  created_at timestamptz default now() not null,
  unique(user_id, date, platform)
);

alter table clapcheeks_conversation_stats enable row level security;
-- RLS: users can view/insert/update own rows (same pattern as other tables)
```

### New table: `clapcheeks_spending`
```sql
create table if not exists public.clapcheeks_spending (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  platform text,            -- nullable (spending can be general dating)
  category text not null check (category in ('date', 'subscription', 'boost', 'gift', 'other')),
  amount numeric(10,2) not null,
  description text,
  created_at timestamptz default now() not null
);

create index idx_spending_user_date on clapcheeks_spending(user_id, date);
alter table clapcheeks_spending enable row level security;
```

### View: `clapcheeks_rizz_score` (computed)
```sql
-- Materialized or computed in application code:
-- rizz_score = (reply_rate * 0.4 + date_conversion * 0.4 + match_rate * 0.2) * 100
```

## API Endpoints

All data fetching happens via Supabase client in server components. No custom API routes needed for read operations.

### Server Actions (in `app/(main)/dashboard/actions.ts`)
- `getAnalyticsSummary(userId, dateRange)` -- Aggregated stats for the selected period
- `getTimeSeriesData(userId, dateRange, metric)` -- Daily data points for charting
- `getPlatformBreakdown(userId, dateRange)` -- Per-platform stats
- `getRizzScore(userId)` -- Computed Rizz Score with component breakdown
- `getWeekOverWeekTrends(userId)` -- Current vs previous week comparison
- `getSpendingSummary(userId, dateRange)` -- Spending by category

### Spending tracking API route
- `POST /api/spending` -- Log a spending entry (called from local agent)

## Frontend Components

### New file structure
```
web/app/(main)/dashboard/
  page.tsx                    -- Server component, data fetching, layout
  actions.ts                  -- Server actions for data queries
  components/
    analytics-charts.tsx      -- Client component: time series line/area charts
    rizz-score-card.tsx       -- Client component: circular gauge + breakdown
    platform-breakdown.tsx    -- Client component: bar chart per platform
    trend-card.tsx            -- Stat card with trend arrow (week-over-week)
    spending-chart.tsx        -- Client component: spending by category pie/bar
    conversion-funnel.tsx     -- Client component: swipes -> matches -> convos -> dates
    date-range-picker.tsx     -- Client component: 7d / 30d / 90d / all time toggle
```

### Component details

**`analytics-charts.tsx`** (client)
- Recharts `<AreaChart>` for swipes/matches over time
- Recharts `<LineChart>` for conversations/dates over time
- Responsive container, dark theme (bg transparent, white/brand axis colors)
- Tooltip with dark background matching brand

**`rizz-score-card.tsx`** (client)
- Circular progress gauge showing 0-100 score
- Color coded: 0-30 red, 31-60 yellow, 61-100 green/brand
- Breakdown below: reply rate %, date conversion %, match rate %
- Each sub-metric shows its own mini trend arrow

**`trend-card.tsx`** (server-compatible)
- Replaces current plain stat cards
- Shows: value, label, trend arrow (up/down/flat), percentage change
- Green for improvement, red for decline, gray for <2% change

**`conversion-funnel.tsx`** (client)
- Horizontal funnel: Swipes Right -> Matches -> Conversations -> Dates
- Shows conversion rate between each step
- Uses Recharts `<BarChart>` in horizontal mode or custom SVG

**`date-range-picker.tsx`** (client)
- Simple button group: 7d | 30d | 90d | All
- Updates URL search params, triggers server re-fetch
- Styled as pill buttons matching brand

## Implementation Steps

### Step 1: Install dependencies
```bash
cd web && npm install recharts
```

### Step 2: Create DB migration
- Write migration SQL for `clapcheeks_conversation_stats` and `clapcheeks_spending`
- Add RLS policies matching existing pattern
- Add to `supabase/migrations/`

### Step 3: Create server actions (`actions.ts`)
- Query `outward_analytics_daily` for core metrics
- Query `clapcheeks_conversation_stats` for reply rates
- Query `clapcheeks_spending` for spending data
- Compute Rizz Score from aggregated data
- Compute week-over-week trends

### Step 4: Build chart components
- Start with `analytics-charts.tsx` (most visible)
- Then `rizz-score-card.tsx`, `trend-card.tsx`
- Then `platform-breakdown.tsx`, `conversion-funnel.tsx`
- Then `spending-chart.tsx`
- All use dark theme: `stroke="#e879f9"` (brand-400), dark tooltips, white/40 axis labels

### Step 5: Build date range picker
- URL search param `?range=7d|30d|90d|all`
- Default to 30d (matching current behavior)

### Step 6: Rebuild dashboard page
- Replace current stats grid with new `<TrendCard>` components
- Add chart sections below stats
- Add Rizz Score card in prominent position (top right or hero area)
- Add platform breakdown section
- Add spending section
- Responsive: stack charts on mobile, 2-col on desktop

### Step 7: Add spending API route
- `POST /api/spending` with auth validation
- Used by local agent to log date expenses

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Recharts SSR issues | Charts won't render server-side | Use `"use client"` directive on all chart components, dynamic import with `ssr: false` if needed |
| Empty state (new users) | Ugly empty charts | Show placeholder state with "Install agent to start tracking" message when no data |
| Performance with large date ranges | Slow queries | Add composite indexes on (user_id, date), limit to 90d max for charts, aggregate older data |
| Rizz Score edge cases | Division by zero | Default to 0 when denominator is 0, show "Not enough data" when < 7 days of data |
| Dark theme chart styling | Recharts defaults to light theme | Custom theme object passed to all chart components, brand color palette |
