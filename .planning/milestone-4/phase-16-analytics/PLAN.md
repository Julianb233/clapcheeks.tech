---
phase: 16-analytics
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - web/app/api/analytics/summary/route.ts
  - web/app/(main)/dashboard/page.tsx
  - web/app/(main)/dashboard/components/date-range-picker.tsx
  - web/app/(main)/analytics/page.tsx
  - web/components/layout/navbar.tsx
autonomous: true

must_haves:
  truths:
    - "User can view analytics charts (Rizz Score, swipe/match trend, platform breakdown, funnel, spending) on the dashboard"
    - "User can navigate to a dedicated /analytics page from the dashboard"
    - "User can select date ranges (7d, 30d, 90d) and see data update accordingly"
    - "Conversion rates display at each funnel stage (match rate, conversation rate, date rate)"
    - "Cost per date and cost per match are visible in spending section"
  artifacts:
    - path: "web/app/(main)/dashboard/page.tsx"
      provides: "Dashboard page wiring DashboardCharts component"
      contains: "DashboardCharts"
    - path: "web/app/(main)/dashboard/components/date-range-picker.tsx"
      provides: "Date range toggle component (7d, 30d, 90d)"
      exports: ["DateRangePicker"]
    - path: "web/app/(main)/analytics/page.tsx"
      provides: "Dedicated analytics page with full chart suite and date range picker"
      min_lines: 40
    - path: "web/app/api/analytics/summary/route.ts"
      provides: "Analytics API with days query param support"
      contains: "searchParams"
  key_links:
    - from: "web/app/(main)/dashboard/page.tsx"
      to: "web/app/(main)/dashboard/components/dashboard-charts.tsx"
      via: "import and render DashboardCharts"
      pattern: "DashboardCharts"
    - from: "web/app/(main)/analytics/page.tsx"
      to: "/api/analytics/summary"
      via: "fetch with days param"
      pattern: "api/analytics/summary"
    - from: "web/app/(main)/dashboard/components/date-range-picker.tsx"
      to: "URL search params"
      via: "useSearchParams or callback"
      pattern: "days|range"
---

<objective>
Wire up the analytics dashboard UI showing conversion funnel metrics, charts, and date range filtering.

Purpose: Phase 16 of the Outward roadmap — the analytics dashboard. Most chart components and the API route already exist but are not wired into the dashboard page. This plan connects everything and adds the missing pieces (date range picker, dedicated analytics page, API date filtering).

Output: Working analytics dashboard with charts on the main dashboard, a dedicated /analytics page with date range filtering, and navigation links.
</objective>

<execution_context>
@web/app/(main)/dashboard/page.tsx
@web/app/(main)/dashboard/components/dashboard-charts.tsx
@web/app/(main)/dashboard/components/dashboard-live.tsx
@web/app/api/analytics/summary/route.ts
</execution_context>

<context>
## What Already Exists

The heavy lifting is done. These components exist and work:

- `web/app/api/analytics/summary/route.ts` — Full analytics API (Rizz Score, trends, funnel, spending, platform breakdown, time series). Currently hardcoded to 30 days.
- `web/app/(main)/dashboard/components/dashboard-charts.tsx` — Client component that fetches from `/api/analytics/summary` and renders all chart sub-components. **NOT currently imported in the dashboard page.**
- `web/app/(main)/dashboard/components/analytics-charts.tsx` — Recharts AreaChart for swipes/matches over time
- `web/app/(main)/dashboard/components/conversion-funnel.tsx` — Recharts horizontal BarChart funnel
- `web/app/(main)/dashboard/components/platform-breakdown.tsx` — Recharts BarChart per-platform
- `web/app/(main)/dashboard/components/spending-chart.tsx` — Spending by category with cost-per-match/date
- `web/app/(main)/dashboard/components/rizz-score-card.tsx` — Circular gauge with trend arrow
- `web/app/(main)/dashboard/components/trend-card.tsx` — Stat card with week-over-week trend
- `web/app/(main)/dashboard/components/dashboard-live.tsx` — Platform stats table + text funnel (currently used in dashboard)
- `web/lib/rizz.ts` — Rizz Score calculation utilities
- `recharts@2.15.4` — Already installed

## Codebase Patterns

- Route group: `(main)` with Navbar + Footer layout
- Dashboard page is a server component at `web/app/(main)/dashboard/page.tsx`
- Auth pattern: `const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); if (!user) redirect('/login')`
- Dark theme: `bg-black`, `bg-white/5 border border-white/10 rounded-xl`, brand colors `brand-400` through `brand-700`, `text-white/40` for muted
- Dashboard header has inline nav links (Conversation AI, Billing, Sign out) — NOT the global Navbar
- Client components use `'use client'` directive
- Supabase table: `clapcheeks_analytics_daily`, `clapcheeks_conversation_stats`, `clapcheeks_spending`
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add date range support to analytics API and wire charts into dashboard</name>
  <files>
    web/app/api/analytics/summary/route.ts
    web/app/(main)/dashboard/page.tsx
    web/app/(main)/dashboard/components/dashboard-charts.tsx
  </files>
  <action>
1. **Update `/api/analytics/summary/route.ts`** to accept `?days=7|30|90` query param:
   - Import `NextRequest` and change `GET()` to `GET(request: NextRequest)`
   - Parse `request.nextUrl.searchParams.get('days')` — default to 30
   - Validate: only allow 7, 30, 90 (fall back to 30 for invalid values)
   - Replace hardcoded `thirtyDaysAgo` with dynamic date calculation based on days param
   - Keep the week-over-week trend logic (always compares last 7 vs previous 7, regardless of range)

2. **Wire `DashboardCharts` into `dashboard/page.tsx`**:
   - Import `DashboardCharts` from `./components/dashboard-charts`
   - Add `<DashboardCharts initialData={null} />` AFTER the existing `<DashboardLive>` section and BEFORE the "Elite Features" section
   - The DashboardCharts component already handles its own data fetching via `/api/analytics/summary`
   - This gives the dashboard: platform table (DashboardLive) + Rizz Score + charts + funnel + spending (DashboardCharts)

3. **Update `dashboard-charts.tsx`** to accept an optional `days` prop:
   - Add `days?: number` to `DashboardChartsProps`
   - When fetching, append `?days=${days || 30}` to the fetch URL
   - Re-fetch when `days` prop changes (add to useEffect dependency array)
  </action>
  <verify>
    - `curl -s 'http://localhost:3000/api/analytics/summary?days=7' | jq '.totals'` returns data
    - `curl -s 'http://localhost:3000/api/analytics/summary?days=90' | jq '.totals'` returns data
    - Dashboard page at `/dashboard` shows the DashboardCharts section with Rizz Score, charts, funnel, and spending below the platform table
  </verify>
  <done>
    API accepts days query param (7, 30, 90). Dashboard page renders all analytics charts via DashboardCharts component. Both DashboardLive (table) and DashboardCharts (visual charts) are visible on the dashboard.
  </done>
</task>

<task type="auto">
  <name>Task 2: Create dedicated analytics page with date range picker</name>
  <files>
    web/app/(main)/dashboard/components/date-range-picker.tsx
    web/app/(main)/analytics/page.tsx
    web/app/(main)/dashboard/page.tsx
  </files>
  <action>
1. **Create `date-range-picker.tsx`** in `web/app/(main)/dashboard/components/`:
   - `'use client'` component
   - Props: `{ value: number; onChange: (days: number) => void }`
   - Render 3 pill buttons: "7d", "30d", "90d"
   - Active pill: `bg-brand-600 text-white`, inactive: `bg-white/5 text-white/50 hover:bg-white/10 border border-white/10`
   - Use `rounded-lg px-3 py-1.5 text-xs font-medium` sizing
   - Wrap in `flex items-center gap-2`

2. **Create `/analytics` page** at `web/app/(main)/analytics/page.tsx`:
   - `'use client'` page (needs useState for date range, fetch for data)
   - Import `DateRangePicker`, `DashboardCharts` (from `../dashboard/components/`)
   - Layout: dark bg matching dashboard (`min-h-screen bg-black px-6 py-8`)
   - Header: "Analytics" title with gradient text, back link to `/dashboard`
   - DateRangePicker at top right, default to 30
   - DashboardCharts component with `days` prop from state
   - Add TrendCard row at top showing: Total Swipes, Matches, Dates Booked, Match Rate (fetch these from the same API response)
   - Import TrendCard from `../dashboard/components/trend-card`
   - Page metadata via head tag or just keep it simple as client component

3. **Add "Analytics" nav link** to `dashboard/page.tsx`:
   - In the dashboard header's nav links row (where "Conversation AI" and "Billing" links are), add an "Analytics" link to `/analytics`
   - Use same styling as existing nav links: `text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all`
   - Place it before "Conversation AI"
  </action>
  <verify>
    - Navigate to `/analytics` — page loads with date range picker and all charts
    - Click "7d" button — charts re-render with 7-day data
    - Click "90d" button — charts re-render with 90-day data
    - Dashboard at `/dashboard` has "Analytics" link in header nav
    - Clicking "Analytics" link navigates to `/analytics`
    - Mobile responsive: charts stack vertically on narrow screens
  </verify>
  <done>
    Dedicated /analytics page exists with date range picker (7d/30d/90d), all chart components (Rizz Score, swipe/match trend, platform breakdown, conversion funnel, spending), and trend stat cards. Dashboard has "Analytics" nav link. Date range selection updates chart data dynamically.
  </done>
</task>

</tasks>

<verification>
1. Dashboard at `/dashboard`:
   - Shows existing stats grid, agent status, DashboardLive table
   - Shows DashboardCharts section (Rizz Score, area chart, platform bar chart, funnel, spending)
   - Has "Analytics" link in header nav
2. Analytics page at `/analytics`:
   - Date range picker with 7d/30d/90d options
   - TrendCard row with key metrics
   - Full chart suite (Rizz Score, swipe/match area chart, platform breakdown, conversion funnel, spending chart)
   - Changing date range updates all charts
3. API at `/api/analytics/summary`:
   - `?days=7` returns 7 days of data
   - `?days=30` returns 30 days (default)
   - `?days=90` returns 90 days
   - Invalid/missing days param defaults to 30
4. All pages mobile responsive
5. Dark theme consistent with rest of app
</verification>

<success_criteria>
- Analytics charts visible on main dashboard (DashboardCharts wired in)
- Dedicated /analytics page accessible from dashboard nav
- Date range picker functional (7d, 30d, 90d)
- Conversion funnel shows rates at each stage
- Cost per date and cost per match visible
- Rizz Score gauge with trend arrow displayed
- All styling matches existing dark aesthetic
</success_criteria>

<output>
After completion, create `.planning/milestone-4/phase-16-analytics/16-01-SUMMARY.md`
</output>
