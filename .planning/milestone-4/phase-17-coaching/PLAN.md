---
phase: 17-coaching
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - web/lib/coaching/benchmarks.ts
  - web/app/api/coaching/tips/route.ts
  - web/app/(main)/coaching/page.tsx
  - web/app/(main)/dashboard/page.tsx
autonomous: true
user_setup: []

must_haves:
  truths:
    - "User can navigate to a dedicated AI Coach page from the dashboard"
    - "AI Coach page shows a performance score 0-100 based on research-backed benchmarks"
    - "AI Coach page displays top 3 coaching tips with priority badges"
    - "AI Coach page shows benchmark comparisons (user metric vs top performers)"
    - "AI Coach page has a What's Working section for positive reinforcement"
    - "Coaching tips are cached for 24h so Claude is not called on every page load"
  artifacts:
    - path: "web/lib/coaching/benchmarks.ts"
      provides: "Research-backed benchmark constants and scoring functions"
      exports: ["BENCHMARKS", "calculatePerformanceScore", "compareToBenchmarks"]
    - path: "web/app/api/coaching/tips/route.ts"
      provides: "GET endpoint returning cached coaching tips with benchmarks"
      exports: ["GET"]
    - path: "web/app/(main)/coaching/page.tsx"
      provides: "Dedicated AI Coach dashboard page"
  key_links:
    - from: "web/app/(main)/coaching/page.tsx"
      to: "/api/coaching/tips"
      via: "fetch on mount"
      pattern: "fetch.*api/coaching/tips"
    - from: "web/app/api/coaching/tips/route.ts"
      to: "web/lib/coaching/benchmarks.ts"
      via: "import calculatePerformanceScore, compareToBenchmarks"
      pattern: "import.*from.*benchmarks"
    - from: "web/app/api/coaching/tips/route.ts"
      to: "web/lib/coaching/generate.ts"
      via: "import getLatestCoaching, generateCoaching"
      pattern: "import.*from.*generate"
---

<objective>
Build a dedicated AI Coach page with research-backed benchmarks, performance scoring, and personalized coaching tips.

Purpose: Phase 16 shows raw metrics. This phase adds an AI interpretation layer that tells users what the numbers mean and what to do about it. The coaching page becomes the "so what?" for all analytics data.

Output: A `/coaching` page with performance score, benchmark comparisons, coaching tips, and positive reinforcement -- plus the benchmarks library and tips API endpoint to power it.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

Existing coaching infrastructure already built:
- `web/lib/coaching/generate.ts` -- Core Claude API integration (claude-sonnet-4-6), fetches 30-day analytics, calls Claude, caches in `clapcheeks_coaching_sessions` table. Has `getLatestCoaching()` and `generateCoaching()`.
- `web/app/api/coaching/generate/route.ts` -- POST endpoint with usage limit checking via `checkLimit`/`incrementUsage`.
- `web/app/api/coaching/feedback/route.ts` -- POST endpoint for thumbs up/down on tips.
- `web/app/(main)/dashboard/components/coaching-section.tsx` -- Client component showing tips inline on dashboard. Has generate button, feedback buttons, category/priority badges.
- `web/app/api/analytics/summary/route.ts` -- GET endpoint returning 30-day aggregates, platform breakdown, funnel, spending, rizz score, trends.
- `web/lib/rizz.ts` -- Existing `calculateRizzScore()` and `getRizzTrend()` functions.

Research findings to encode as benchmarks:
- Profile photos are 21x more impactful than openers
- 0.25 like ratio is algorithmically optimal; warn if user above 0.4
- GIF openers get 30% higher response rate
- Hinge Most Compatible has 8x date rate
- Direct date ask after 7 messages (skip phone number step)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create benchmarks library and tips API endpoint</name>
  <files>web/lib/coaching/benchmarks.ts, web/app/api/coaching/tips/route.ts</files>
  <action>
    Create `web/lib/coaching/benchmarks.ts`:
    - Export benchmark constants:
      - `MATCH_RATE_GOOD = 0.15` (15% swipe-to-match)
      - `CONVERSATION_RATE_GOOD = 0.40` (40% match-to-conversation)
      - `DATE_RATE_GOOD = 0.15` (15% match-to-date)
      - `LIKE_RATIO_OPTIMAL = 0.25` (25% right-swipe ratio)
      - `LIKE_RATIO_WARNING = 0.40` (above this, algorithm penalizes)
      - `GIF_RESPONSE_BOOST = 0.30` (30% higher response rate)
      - `OPTIMAL_MESSAGES_BEFORE_DATE_ASK = 7`
    - Export `calculatePerformanceScore(metrics: { matchRate: number, conversationRate: number, dateRate: number, likeRatio: number }): number`
      - Weighted score 0-100: matchRate weight 35, conversationRate weight 25, dateRate weight 30, likeRatio weight 10
      - Each component: `Math.min(1, actual / benchmark) * weight`
      - Clamp final to 0-100
    - Export `compareToBenchmarks(metrics: same type): Array<{ metric: string, userValue: number, benchmark: number, delta: number, status: 'above' | 'below' | 'at' }>`
      - Returns delta for each metric vs benchmark
      - Status: within 10% of benchmark = 'at', above = 'above', below = 'below'
    - Export `getPositiveInsights(metrics: same type): string[]`
      - Return array of positive reinforcement strings for metrics that are at or above benchmark
      - Examples: "Your match rate of 18% beats the 15% benchmark -- your profile is working"
      - Only return insights for metrics that are genuinely good (at or above benchmark)

    Create `web/app/api/coaching/tips/route.ts`:
    - Authenticated GET endpoint (use `createClient` from `@/lib/supabase/server`, check `supabase.auth.getUser()`)
    - Fetch user's last 30 days analytics from `clapcheeks_analytics_daily` (same pattern as existing `generate.ts`)
    - Compute matchRate, conversationRate, dateRate, likeRatio from aggregated data
    - Call `calculatePerformanceScore()` and `compareToBenchmarks()` and `getPositiveInsights()` from benchmarks lib
    - Call `getLatestCoaching()` from existing `generate.ts` to get cached tips
    - If no cached tips exist, call `generateCoaching()` (this handles the Claude API call and 24h caching)
    - Return JSON: `{ score: number, tips: CoachingTip[], benchmarks: BenchmarkComparison[], positives: string[], generatedAt: string }`
    - Do NOT re-implement Claude calling -- reuse existing `generateCoaching()` from `web/lib/coaching/generate.ts`
  </action>
  <verify>
    - `npx tsc --noEmit` passes with no errors in benchmarks.ts or tips/route.ts
    - `calculatePerformanceScore({ matchRate: 0.15, conversationRate: 0.40, dateRate: 0.15, likeRatio: 0.25 })` returns 100
    - `calculatePerformanceScore({ matchRate: 0, conversationRate: 0, dateRate: 0, likeRatio: 0 })` returns 0
  </verify>
  <done>
    - benchmarks.ts exports BENCHMARKS constants, calculatePerformanceScore, compareToBenchmarks, getPositiveInsights
    - /api/coaching/tips GET endpoint returns score, tips, benchmarks, positives, generatedAt
    - Endpoint reuses existing coaching generation (no duplicate Claude calls)
  </done>
</task>

<task type="auto">
  <name>Task 2: Build dedicated AI Coach page</name>
  <files>web/app/(main)/coaching/page.tsx</files>
  <action>
    Create `web/app/(main)/coaching/page.tsx` as a client component ('use client'):
    - Fetch from `/api/coaching/tips` on mount with useEffect
    - Show loading skeleton while fetching (use same dark theme as dashboard)
    - Layout sections (top to bottom):

    1. **Header**: "AI Coach" title with Sparkles icon, subtitle "Personalized insights from your dating data"

    2. **Performance Score**: Large circular or semi-circular score display (0-100)
       - Color: red (<40), yellow (40-70), green (>70)
       - Label: "Performance Score" below
       - Use CSS/Tailwind for the visual -- no charting library needed. A simple large number with colored ring/border is fine.

    3. **Benchmark Comparison**: Grid of cards showing each metric vs benchmark
       - Format: "Your match rate: 12% / Top performers: 15%"
       - Show delta with up/down arrow and color (green if above, red if below, gray if at)
       - 2-column grid on desktop, 1-column on mobile

    4. **Top 3 Coaching Tips**: Reuse the same tip card design from `coaching-section.tsx`
       - Category badge (timing=blue, messaging=purple, platform=green, general=gray)
       - Priority badge (high=red, medium=yellow, low=gray)
       - Title, tip text, supporting data
       - Thumbs up/down feedback buttons (POST to `/api/coaching/feedback`)

    5. **What's Working**: Section showing positive insights
       - Green-tinted card with checkmark icons
       - List of positive reinforcement strings from the API
       - Only show if there are positives (hide section if empty)

    6. **Footer**: "Last updated: [date]" and "AI analyzes your stats, never your messages" disclaimer

    Style: Match existing dashboard dark theme (bg-black, bg-white/5 cards, border-white/10, text-white, text-white/40 muted). Use lucide-react icons.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - Page renders at `/coaching` route (check that `(main)` layout wraps it with Navbar/Footer)
    - All 5 sections visible in the component code
  </verify>
  <done>
    - Dedicated /coaching page exists with performance score, benchmarks, tips, and What's Working sections
    - Matches existing dark theme
    - Fetches from /api/coaching/tips endpoint
  </done>
</task>

<task type="auto">
  <name>Task 3: Add AI Coach link to dashboard navigation</name>
  <files>web/app/(main)/dashboard/page.tsx</files>
  <action>
    In `web/app/(main)/dashboard/page.tsx`, add an "AI Coach" navigation link in the header bar (lines ~176-198) alongside the existing "Conversation AI" and "Billing" links.

    Add this Link element after the "Conversation AI" link:
    ```tsx
    <Link
      href="/coaching"
      className="text-white/40 hover:text-white/70 text-xs bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-lg transition-all"
    >
      AI Coach
    </Link>
    ```

    This follows the exact same pattern as the existing nav links on line 177-188.
  </action>
  <verify>
    - `npx tsc --noEmit` passes
    - Dashboard page header shows "AI Coach" link between "Conversation AI" and "Billing"
    - Link points to `/coaching`
  </verify>
  <done>
    - "AI Coach" link appears in dashboard header navigation
    - Clicking it navigates to the dedicated /coaching page
  </done>
</task>

</tasks>

<verification>
1. `cd /opt/agency-workspace/clapcheeks.tech/web && npx tsc --noEmit` -- no type errors
2. `grep -r "calculatePerformanceScore" web/lib/coaching/benchmarks.ts` -- function exists
3. `grep -r "compareToBenchmarks" web/lib/coaching/benchmarks.ts` -- function exists
4. `grep -r "getPositiveInsights" web/lib/coaching/benchmarks.ts` -- function exists
5. `grep -r "/coaching" web/app/\(main\)/dashboard/page.tsx` -- nav link exists
6. File exists: `web/app/(main)/coaching/page.tsx`
7. File exists: `web/app/api/coaching/tips/route.ts`
</verification>

<success_criteria>
- benchmarks.ts has research-backed constants (MATCH_RATE_GOOD=0.15, LIKE_RATIO_OPTIMAL=0.25, etc.)
- calculatePerformanceScore returns 0-100 weighted score
- /api/coaching/tips returns score + tips + benchmarks + positives in single response
- /coaching page renders performance score, benchmark comparisons, coaching tips, and What's Working
- Dashboard has "AI Coach" nav link pointing to /coaching
- No duplicate Claude API calling -- reuses existing generate.ts infrastructure
</success_criteria>

<output>
After completion, create `.planning/milestone-4/phase-17-coaching/17-01-SUMMARY.md`
</output>
