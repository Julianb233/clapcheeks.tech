---
phase: 19-reports
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - web/lib/email/weekly-report.tsx
  - web/app/api/reports/weekly/route.ts
  - web/app/(dashboard)/settings/page.tsx
  - vercel.json
  - web/package.json
autonomous: true
user_setup:
  - service: resend
    why: "Email delivery for weekly reports"
    env_vars:
      - name: RESEND_API_KEY
        source: "Resend Dashboard -> API Keys"
      - name: CRON_SECRET
        source: "Generate random string, add to Vercel env vars"
    dashboard_config:
      - task: "Verify sending domain clapcheeks.tech"
        location: "Resend Dashboard -> Domains"

must_haves:
  truths:
    - "Active users receive a styled weekly email every Monday at 9am UTC"
    - "Email contains this week stats (swipes, matches, conversations, dates) with trend arrows vs last week"
    - "Email contains an AI-generated top tip from the coaching engine"
    - "Email contains a CTA linking to the analytics dashboard"
    - "Users who opted out do NOT receive emails"
    - "Users can toggle weekly reports on/off and choose report day from settings"
  artifacts:
    - path: "web/lib/email/weekly-report.tsx"
      provides: "React Email HTML template for weekly report"
      contains: "@react-email/components"
    - path: "web/app/api/reports/weekly/route.ts"
      provides: "Cron-triggered endpoint that fetches analytics, generates AI summary, sends email"
      exports: ["GET"]
    - path: "web/app/(dashboard)/settings/page.tsx"
      provides: "Email preferences UI with weekly report toggle and day selector"
    - path: "vercel.json"
      provides: "Cron schedule for Monday 9am UTC"
      contains: "/api/reports/weekly"
  key_links:
    - from: "web/app/api/reports/weekly/route.ts"
      to: "clapcheeks_analytics_daily"
      via: "Supabase query for last 7 days"
      pattern: "clapcheeks_analytics_daily"
    - from: "web/app/api/reports/weekly/route.ts"
      to: "web/lib/email/weekly-report.tsx"
      via: "render() from @react-email/components"
      pattern: "render.*WeeklyReport"
    - from: "web/app/api/reports/weekly/route.ts"
      to: "resend"
      via: "Resend SDK emails.send()"
      pattern: "resend\\.emails\\.send"
    - from: "web/app/api/reports/weekly/route.ts"
      to: "@anthropic-ai/sdk"
      via: "Claude API for AI tip generation"
      pattern: "anthropic.*messages\\.create"
---

<objective>
Build the weekly report email system for Clap Cheeks.

Purpose: Users get a branded HTML email every Monday summarizing their dating performance with AI-powered recommendations, driving them back to the dashboard.

Output: React Email template, cron-triggered API route with AI summary, settings UI for email preferences, Vercel Cron config.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md

Existing code to build on:
- `web/lib/reports/generate-report-data.ts` -- already fetches analytics from `clapcheeks_analytics_daily`, computes week-over-week trends, aggregates per-platform stats, computes Rizz Score. Reuse this as-is.
- `web/lib/reports/send-report-email.ts` -- existing Resend integration (replace the basic HTML with React Email render).
- `web/app/api/reports/cron/route.ts` -- existing cron endpoint (PDF-based). The new `/api/reports/weekly` route replaces this with HTML email approach.
- `web/app/(main)/reports/report-preferences.tsx` -- existing preferences UI. Settings page should reuse this pattern.
- `web/lib/coaching/generate.ts` -- coaching engine that calls Claude API. Reuse the prompt pattern for generating the weekly AI tip.
- `web/app/api/reports/preferences/route.ts` -- existing preferences API (PUT to `clapcheeks_report_preferences` table).

DB tables already exist:
- `clapcheeks_analytics_daily` (Phase 16) -- daily stats per user per platform
- `clapcheeks_coaching_sessions` (Phase 17) -- cached coaching tips
- `clapcheeks_report_preferences` -- has `email_enabled`, `send_day`, `send_hour` columns
- `clapcheeks_weekly_reports` -- report history

Dependencies already installed: `resend`, `@anthropic-ai/sdk`, `@react-pdf/renderer`
Need to install: `@react-email/components`
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create React Email template and weekly report API route</name>
  <files>
    web/lib/email/weekly-report.tsx
    web/app/api/reports/weekly/route.ts
    web/package.json
  </files>
  <action>
    **Step 1: Install @react-email/components**
    ```bash
    cd web && npm install @react-email/components
    ```

    **Step 2: Create `web/lib/email/weekly-report.tsx`**
    React Email template using `@react-email/components` (Html, Head, Body, Container, Section, Text, Button, Hr, Img, Preview).

    Template props interface:
    ```typescript
    interface WeeklyReportEmailProps {
      stats: {
        swipes: number; swipesChange: number
        matches: number; matchesChange: number
        messages: number; messagesChange: number
        dates: number; datesChange: number
      }
      aiTip: string           // AI-generated top tip of the week
      dashboardUrl: string    // CTA link to analytics dashboard
      unsubscribeUrl: string  // One-click unsubscribe
    }
    ```

    Email design:
    - Subject line: "Your Clap Cheeks Week in Review"
    - Preview text: "Swipes, matches, and your top tip this week"
    - Dark background (#0a0a0a) with white text -- but test email client compatibility. If dark bg causes issues in Outlook/Gmail, use light theme with brand accents instead.
    - Header: "CLAP CHEEKS" in brand-600 (#c026d3) + "Week in Review" subtitle
    - Stats grid (2x2 table): Swipes, Matches, Conversations, Dates -- each with the number and a trend indicator (green up arrow / red down arrow / gray dash for no change). Use HTML entities for arrows.
    - AI Tip section: bordered card with the tip text, labeled "Top Tip of the Week"
    - CTA button: "View Full Analytics" linking to `https://clapcheeks.tech/analytics` -- brand-600 background, white text, rounded
    - Footer: "clapcheeks.tech" + "Unsubscribe" link + muted text

    Use inline styles (required for email HTML). Keep it simple -- email clients are limited. Use table-based layout for maximum compatibility.

    Export: `WeeklyReportEmail` component (default export) and a `render` helper that returns HTML string.

    **Step 3: Create `web/app/api/reports/weekly/route.ts`**
    GET endpoint, protected by CRON_SECRET bearer token (same pattern as existing `cron/route.ts`).

    Logic:
    1. Verify `Authorization: Bearer ${CRON_SECRET}` header
    2. Query `clapcheeks_report_preferences` joined with active subscriptions to get eligible users (where `email_enabled !== false`)
    3. For each eligible user (batched, 10 at a time via Promise.allSettled):
       a. Call `generateReportData()` from `web/lib/reports/generate-report-data.ts` for last 7 days
       b. Generate AI tip: call Claude API (claude-sonnet-4-6) with a short prompt summarizing the user's week stats and asking for ONE actionable dating tip (2-3 sentences). Reuse the Anthropic SDK pattern from `web/lib/coaching/generate.ts`. If Claude call fails, fall back to latest tip from `clapcheeks_coaching_sessions`.
       c. Render the React Email template to HTML string using `render()` from `@react-email/components`
       d. Send via Resend: from "Clap Cheeks <reports@clapcheeks.tech>", subject "Your Clap Cheeks Week in Review", html from step c
       e. Record in `clapcheeks_weekly_reports` table (upsert on user_id + week_start)
    4. Return JSON: `{ processed, errors, total }`

    Set `export const maxDuration = 300` for Vercel Pro timeout.

    Important: Do NOT use `supabase.auth.admin.getUserById()` in a loop -- instead batch-fetch user emails upfront via a single query or use the profiles table if available.

    AI tip prompt (keep short to minimize tokens):
    ```
    You are a dating coach. Based on these stats, give ONE specific actionable tip (2-3 sentences). Be direct, not generic.
    Stats: {swipes} swipes ({swipesChange}%), {matches} matches ({matchesChange}%), {messages} conversations ({messagesChange}%), {dates} dates ({datesChange}%).
    ```
  </action>
  <verify>
    - `cd /opt/agency-workspace/clapcheeks.tech/web && npx tsc --noEmit` passes (or only pre-existing errors)
    - `web/lib/email/weekly-report.tsx` exports a React component and render function
    - `web/app/api/reports/weekly/route.ts` exports GET handler
    - `@react-email/components` appears in `web/package.json` dependencies
  </verify>
  <done>
    Weekly report email template renders valid HTML. API route fetches analytics, generates AI tip via Claude, renders email, and sends via Resend for all eligible users. Opted-out users are excluded.
  </done>
</task>

<task type="auto">
  <name>Task 2: Add Vercel Cron config and settings page email preferences</name>
  <files>
    vercel.json
    web/app/(dashboard)/settings/page.tsx
  </files>
  <action>
    **Step 1: Update `vercel.json`**
    Add cron configuration to trigger weekly report generation every Monday at 9am UTC:
    ```json
    {
      "framework": "nextjs",
      "crons": [
        {
          "path": "/api/reports/weekly",
          "schedule": "0 9 * * 1"
        }
      ]
    }
    ```
    If there are existing crons (e.g., from Phase 17 coaching), merge them into the array -- do not overwrite.

    **Step 2: Update or create settings page**
    Check if `web/app/(dashboard)/settings/page.tsx` exists. If it does, add a "Weekly Reports" section. If it doesn't exist but the dashboard uses a different layout group (check `web/app/(main)/` vs `web/app/(dashboard)/`), create at the correct path.

    The settings page (or section) needs:
    - Toggle: "Email weekly reports" (on/off) -- maps to `email_enabled` in `clapcheeks_report_preferences`
    - Select: "Report day" with options Monday / Sunday / Friday (default Monday) -- maps to `send_day`
    - Save button that calls `PUT /api/reports/preferences`

    Follow the existing pattern from `web/app/(main)/reports/report-preferences.tsx` -- same Tailwind dark theme classes (bg-white/5, border-white/10, text-white/60 etc.). Can extract the preferences component and reuse it, or inline the form if the settings page is simple.

    If the dashboard route group is `(main)` not `(dashboard)`, create at `web/app/(main)/settings/page.tsx` instead. Match whichever layout group is used by the existing reports and analytics pages.

    Add `clapcheeks_report_preferences` columns `email_reports_enabled` and `report_day` to profiles table ONLY if the spec requires it. The existing `clapcheeks_report_preferences` table already has `email_enabled` and `send_day` columns -- use those. Do NOT duplicate data into profiles.
  </action>
  <verify>
    - `vercel.json` contains valid JSON with cron for `/api/reports/weekly` at `0 9 * * 1`
    - Settings page renders without errors (check with `npx tsc --noEmit`)
    - Settings page has toggle for email reports and day selector
    - Preferences save calls the existing `/api/reports/preferences` PUT endpoint
  </verify>
  <done>
    Vercel Cron triggers `/api/reports/weekly` every Monday 9am UTC. Users can toggle weekly reports on/off and select report day (Monday/Sunday/Friday) from settings page. Preferences persist in `clapcheeks_report_preferences` table.
  </done>
</task>

</tasks>

<verification>
1. `cd /opt/agency-workspace/clapcheeks.tech/web && npx tsc --noEmit` -- TypeScript compiles (or only pre-existing errors)
2. `cat vercel.json` shows cron config for `/api/reports/weekly`
3. `grep -r "@react-email/components" web/lib/email/` confirms React Email usage
4. `grep -r "resend" web/app/api/reports/weekly/` confirms Resend integration
5. `grep -r "anthropic\|claude" web/app/api/reports/weekly/` confirms AI tip generation
6. Settings page exists with email toggle and day selector
7. Email template includes: stats grid, trend arrows, AI tip section, CTA button, unsubscribe link
</verification>

<success_criteria>
- React Email template at `web/lib/email/weekly-report.tsx` renders branded HTML with stats, trends, AI tip, CTA, and unsubscribe
- `/api/reports/weekly` cron endpoint generates AI summary, renders email, sends via Resend to all eligible users
- Users who set `email_enabled=false` are excluded from sends
- `vercel.json` has cron: `0 9 * * 1` pointing to `/api/reports/weekly`
- Settings page lets users toggle weekly reports and choose send day
- No new DB tables needed (existing `clapcheeks_report_preferences` and `clapcheeks_weekly_reports` suffice)
</success_criteria>

<output>
After completion, create `.planning/milestone-4/phase-19-reports/19-01-SUMMARY.md`
</output>
