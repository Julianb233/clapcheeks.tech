# Phase 19: Weekly Reports

## Overview

Build an automated weekly performance report system that generates a branded PDF report and delivers it via email. Reports include all key metrics (swipes, matches, conversations, dates, spending, Rizz Score), week-over-week trends, AI coaching highlights, and personalized recommendations. Uses `@react-pdf/renderer` for PDF generation and Resend for email delivery.

## Key Technical Decisions

**@react-pdf/renderer for PDFs** -- Pure React component-based PDF generation. No headless browser needed (unlike Puppeteer). Lightweight, fast, works in serverless (Vercel). Can render the same dark-theme brand styling as the dashboard. Generates PDFs in-memory without Chrome/Chromium dependency.

**Resend for email** -- Modern developer-friendly email API. Clean SDK, good deliverability, React email templates support, simple DNS verification. Free tier: 3,000 emails/month (plenty for weekly reports). Pairs naturally with Next.js.

**Vercel Cron for scheduling** -- Trigger report generation every Monday morning. Same cron infrastructure as coaching (Phase 17). Process users in batches.

**Dark theme PDF matching brand** -- The PDF uses the same color palette as the web dashboard: black background, white text, brand-600 (#c026d3) accents, gradient headers. This maintains brand consistency.

**Report stored in Supabase Storage** -- Generated PDFs uploaded to Supabase Storage bucket. Users can download past reports from the dashboard. Email contains the PDF as attachment + link to dashboard.

## DB Schema Changes

### New table: `clapcheeks_weekly_reports`
```sql
create table if not exists public.clapcheeks_weekly_reports (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  week_start date not null,
  week_end date not null,
  report_data jsonb not null,          -- all metrics snapshot
  pdf_storage_path text,               -- path in Supabase Storage
  email_sent boolean default false,
  email_sent_at timestamptz,
  resend_message_id text,              -- for tracking delivery
  created_at timestamptz default now() not null,
  unique(user_id, week_start)
);

alter table clapcheeks_weekly_reports enable row level security;
-- RLS: users see own reports only
```

### New table: `clapcheeks_report_preferences`
```sql
create table if not exists public.clapcheeks_report_preferences (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  email_enabled boolean default true,
  preferred_day text default 'monday' check (preferred_day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  preferred_time text default '08:00',  -- HH:MM in user's timezone
  timezone text default 'America/New_York',
  include_spending boolean default true,
  include_coaching boolean default true,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table clapcheeks_report_preferences enable row level security;
```

## API Endpoints

### Server Actions
- `getReportHistory(userId)` -- List past weekly reports
- `getReportPreferences(userId)` -- Get email/schedule preferences
- `updateReportPreferences(userId, prefs)` -- Update preferences
- `generateReport(userId, weekStart)` -- Generate report on demand
- `downloadReport(userId, reportId)` -- Get signed URL for PDF download

### API Routes
- `POST /api/reports/generate` -- Vercel Cron endpoint: generate reports for all opted-in users
- `GET /api/reports/[id]/download` -- Redirect to signed Supabase Storage URL

### Vercel Cron
```json
{
  "crons": [{
    "path": "/api/reports/generate",
    "schedule": "0 8 * * 1"  // Every Monday at 8 AM UTC
  }]
}
```

## Report Template Design

### PDF Layout (dark theme)
```
+------------------------------------------+
|  [Logo] CLAP CHEEKS WEEKLY REPORT        |
|  Week of Mar 1 - Mar 7, 2026             |
+------------------------------------------+
|                                           |
|  RIZZ SCORE: 73/100  (+5 from last week) |
|  [circular gauge visualization]           |
|                                           |
+------------------------------------------+
|  THIS WEEK AT A GLANCE                   |
|  +--------+  +--------+  +--------+      |
|  | 342    |  | 28     |  | 3      |      |
|  | Swipes |  | Matches|  | Dates  |      |
|  | +12%   |  | +8%    |  | +50%   |      |
|  +--------+  +--------+  +--------+      |
+------------------------------------------+
|  PLATFORM BREAKDOWN                       |
|  Tinder:  180 swipes, 12 matches (6.7%)  |
|  Bumble:  90 swipes, 9 matches (10.0%)   |
|  Hinge:   72 swipes, 7 matches (9.7%)    |
+------------------------------------------+
|  CONVERSION FUNNEL                        |
|  Swipes -> Matches: 8.2%                 |
|  Matches -> Convos: 71.4%                |
|  Convos -> Dates: 15.0%                  |
+------------------------------------------+
|  SPENDING                                 |
|  Total: $127.50                           |
|  Dates: $95 | Boosts: $22.50 | Subs: $10 |
|  Cost per date: $42.50                    |
+------------------------------------------+
|  AI COACH SAYS                            |
|  - Top tip from this week                 |
|  - Second tip                             |
+------------------------------------------+
|  clapcheeks.tech | Unsubscribe            |
+------------------------------------------+
```

### Color palette for PDF
- Background: #0a0a0a (near-black)
- Text: #ffffff (white), #ffffff99 (white/60 for secondary)
- Accent: #c026d3 (brand-600), #e879f9 (brand-400)
- Positive: #4ade80 (green-400)
- Negative: #f87171 (red-400)
- Cards: #ffffff0d (white/5)

## Frontend Components

### New file structure
```
web/app/(main)/dashboard/
  reports/
    page.tsx                    -- Report history list
  components/
    report-history.tsx          -- List of past reports with download links
    report-preferences.tsx      -- Email preferences form
lib/
  reports/
    generate-pdf.tsx            -- @react-pdf/renderer document definition
    generate-report-data.ts     -- Gather all metrics for a report
    send-report-email.ts        -- Resend email with PDF attachment
```

### Component details

**`generate-pdf.tsx`** -- React PDF document
- Uses `@react-pdf/renderer` components: Document, Page, View, Text, Image
- Styled with StyleSheet.create() matching brand dark theme
- Sections: header, rizz score, stats grid, platform breakdown, funnel, spending, coaching
- Returns a renderable PDF document component

**`report-history.tsx`** (client)
- Table/list of past reports
- Columns: week, rizz score, highlights, download button
- Download button gets signed URL from server action

**`report-preferences.tsx`** (client)
- Toggle: email reports on/off
- Timezone selector
- Include spending toggle
- Include coaching toggle
- Save via server action

## Implementation Steps

### Step 1: Install dependencies
```bash
cd web && npm install @react-pdf/renderer resend
```

### Step 2: Create DB migration
- `clapcheeks_weekly_reports` table
- `clapcheeks_report_preferences` table
- RLS policies
- Supabase Storage bucket: `weekly-reports`

### Step 3: Build report data gathering
- `lib/reports/generate-report-data.ts`:
  1. Query analytics for the week (outward_analytics_daily)
  2. Query conversation stats (clapcheeks_conversation_stats)
  3. Query spending (clapcheeks_spending)
  4. Compute Rizz Score (reuse from Phase 16)
  5. Compute week-over-week trends
  6. Load latest coaching tips (from Phase 17)
  7. Return structured report data object

### Step 4: Build PDF template
- `lib/reports/generate-pdf.tsx`:
  - Define React PDF components for each section
  - Dark theme styling with brand colors
  - Receive report data as props
  - Export function that renders to Buffer

### Step 5: Build email sending
- `lib/reports/send-report-email.ts`:
  - Initialize Resend client
  - Compose email with subject "Your Week in Review - Clap Cheeks"
  - Attach PDF as buffer
  - Include preview text with Rizz Score
  - Send via Resend API

### Step 6: Build generation API route
- `POST /api/reports/generate`:
  - Verify cron secret
  - Query all users with email_enabled=true
  - For each user: generate data -> render PDF -> upload to Storage -> send email -> record in DB
  - Process in batches (10 at a time) to avoid timeouts

### Step 7: Build report history page
- Server component: fetch from `clapcheeks_weekly_reports`
- List view with download links
- Report preferences form

### Step 8: Build preferences UI
- Form in dashboard settings area
- Toggle email on/off
- Timezone selection
- Save to `clapcheeks_report_preferences`

### Step 9: On-demand report generation
- "Generate now" button in report history
- Rate-limited to 1/day
- Same pipeline as cron but for single user

### Step 10: Integrate into dashboard
- Add "Reports" tab to dashboard navigation
- Show latest report summary card on main dashboard

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| @react-pdf/renderer styling limitations | Can't replicate exact dashboard look | Design PDF-specific layout. Keep it clean and simple. Test rendering early. |
| Vercel serverless timeout (10s default) | Report generation too slow | Use streaming, increase timeout to 60s in vercel.json, batch users, or use Vercel background functions |
| Resend deliverability | Emails hit spam | Verify sending domain with DNS (SPF/DKIM), use professional from address, include unsubscribe link |
| PDF file size | Large attachments bounce | Keep PDF simple (no heavy images), target <500KB per report. Use vector graphics not bitmaps. |
| Empty data weeks | Useless report for inactive users | Skip report generation if user has <1 day of data that week. Send "We missed you" email instead. |
| Timezone handling | Reports generated at wrong time | Store user timezone, use date-fns-tz for calculations, cron runs at fixed UTC and filters by user timezone |
| Storage costs | PDF accumulation | Set lifecycle policy on Storage bucket: delete PDFs older than 90 days. Keep report_data in DB permanently. |
| Unsubscribe compliance | Legal requirement (CAN-SPAM) | Include unsubscribe link in every email. One-click unsubscribe header. Honor immediately. |
