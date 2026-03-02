# Phase 17: AI Coaching Engine

## Overview

Build an AI coaching engine powered by Claude (claude-sonnet-4-6) that analyzes user dating patterns and generates personalized weekly tips. The engine runs as a server-side process, feeds Claude anonymized aggregate stats (never personal messages), caches responses to avoid redundant API calls, and stores coaching history in Supabase. Users see coaching cards in the dashboard with actionable, specific advice.

## Key Technical Decisions

**Claude claude-sonnet-4-6 via Anthropic SDK** -- Best balance of quality and cost for coaching insights. Smart enough to generate nuanced dating advice from statistical patterns. Use `@anthropic-ai/sdk` npm package.

**Anonymized stats only** -- Privacy-first: Claude receives aggregate numbers (reply rate, match rate, time-of-day patterns, platform comparisons) but never message content, names, or personal details. This is a firm boundary.

**Weekly generation with on-demand refresh** -- Coaching tips generated once per week (Sunday night via Vercel Cron or on first dashboard visit of the week). Users can manually trigger a refresh (rate-limited to 1/day).

**Response caching in Supabase** -- Store generated coaching responses in `clapcheeks_coaching_sessions` table. Serve cached response until next scheduled generation. Avoids redundant Claude API calls.

**Structured output** -- Claude returns JSON with typed tip objects (category, tip text, supporting data, priority). Parse and store as JSONB in Supabase.

## DB Schema Changes

### New table: `clapcheeks_coaching_sessions`
```sql
create table if not exists public.clapcheeks_coaching_sessions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  generated_at timestamptz default now() not null,
  week_start date not null,           -- Monday of the coaching week
  input_snapshot jsonb not null,       -- anonymized stats fed to Claude
  tips jsonb not null,                 -- array of tip objects
  overall_assessment text,             -- 1-2 sentence overall assessment
  rizz_score_at_generation int,        -- snapshot of rizz score
  model_used text default 'claude-sonnet-4-6',
  tokens_used int,
  created_at timestamptz default now() not null,
  unique(user_id, week_start)
);

alter table clapcheeks_coaching_sessions enable row level security;
-- RLS: users see own coaching sessions only
```

### New table: `clapcheeks_tip_feedback`
```sql
create table if not exists public.clapcheeks_tip_feedback (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  coaching_session_id uuid references clapcheeks_coaching_sessions(id) on delete cascade not null,
  tip_index int not null,              -- index into the tips array
  helpful boolean not null,            -- thumbs up / thumbs down
  created_at timestamptz default now() not null,
  unique(user_id, coaching_session_id, tip_index)
);

alter table clapcheeks_tip_feedback enable row level security;
```

## API Endpoints

### Server Actions
- `getLatestCoaching(userId)` -- Return cached coaching for current week, or null
- `generateCoaching(userId)` -- Trigger new coaching generation (rate-limited)
- `submitTipFeedback(userId, sessionId, tipIndex, helpful)` -- Record thumbs up/down

### API Routes
- `POST /api/coaching/generate` -- Webhook endpoint for Vercel Cron to trigger weekly generation for all active users
- `POST /api/coaching/feedback` -- Record tip feedback

### Vercel Cron
```json
// vercel.json
{
  "crons": [{
    "path": "/api/coaching/generate",
    "schedule": "0 3 * * 1"  // Every Monday at 3 AM UTC
  }]
}
```

## Claude Prompt Engineering

### System prompt
```
You are a dating coach AI for Clap Cheeks, a dating app optimization platform.
You analyze anonymized dating statistics and provide actionable, specific advice.

Rules:
- Be direct and specific, not generic. Reference actual numbers.
- Each tip must be actionable (user can do something THIS WEEK).
- Tone: confident, slightly irreverent, supportive. Not corporate.
- Never reference personal messages or individual matches.
- Focus on patterns and behaviors the user can change.

Output format: JSON array of tip objects.
```

### User prompt template
```
Here are my dating stats for the past week:

Platform breakdown:
{platform_stats}

Key metrics:
- Match rate: {match_rate}% (prev week: {prev_match_rate}%)
- Reply rate: {reply_rate}% (prev week: {prev_reply_rate}%)
- Date conversion: {date_conversion}% (prev week: {prev_date_conversion}%)
- Rizz Score: {rizz_score}/100 (prev week: {prev_rizz_score}/100)
- Most active day: {best_day}
- Least active day: {worst_day}
- Average response time received: {avg_response_time} mins

Trends:
- {trend_descriptions}

Previous tip feedback (what helped / didn't help):
{previous_feedback_summary}

Generate 3-5 personalized coaching tips for this week.
Return JSON: [{ "category": "timing|messaging|platform|general", "title": "short title", "tip": "2-3 sentence actionable advice", "supporting_data": "the stat that prompted this", "priority": "high|medium|low" }]
```

### Example output
```json
[
  {
    "category": "timing",
    "title": "Weekend warrior mode",
    "tip": "Your reply rate drops 34% on weekdays vs weekends. Schedule your swiping sessions for Friday and Saturday evenings when matches are most responsive.",
    "supporting_data": "Weekday reply rate: 12%, Weekend reply rate: 46%",
    "priority": "high"
  },
  {
    "category": "platform",
    "title": "Hinge is your goldmine",
    "tip": "Your Hinge match rate is 3x higher than Tinder. Consider spending more time on Hinge and less on Tinder this week.",
    "supporting_data": "Hinge match rate: 15%, Tinder match rate: 5%",
    "priority": "high"
  }
]
```

## Frontend Components

### New file structure
```
web/app/(main)/dashboard/components/
  coaching-card.tsx          -- Client component: displays coaching tips
  coaching-tip.tsx           -- Single tip with feedback buttons
  coaching-skeleton.tsx      -- Loading state
```

### Component details

**`coaching-card.tsx`** (client)
- Card with "AI Coach" header and sparkle icon
- Overall assessment at top
- List of tips below, each with category badge and priority indicator
- "Refresh" button (disabled if already refreshed today)
- "Last updated: [date]" footer

**`coaching-tip.tsx`** (client)
- Category badge (color-coded: timing=blue, messaging=purple, platform=green, general=gray)
- Title in bold, tip text below
- Supporting data in muted text
- Thumbs up / thumbs down buttons
- Feedback state persisted via server action

## Implementation Steps

### Step 1: Install Anthropic SDK
```bash
cd web && npm install @anthropic-ai/sdk
```

### Step 2: Create DB migration
- `clapcheeks_coaching_sessions` table
- `clapcheeks_tip_feedback` table
- RLS policies

### Step 3: Build coaching generation logic
- `lib/coaching/generate.ts` -- Core function:
  1. Gather last 7 days of analytics data
  2. Gather last 7 days of conversation stats
  3. Compute week-over-week trends
  4. Load previous tip feedback
  5. Build prompt with anonymized data
  6. Call Claude API
  7. Parse JSON response
  8. Store in `clapcheeks_coaching_sessions`

### Step 4: Build server actions
- `getLatestCoaching` -- Check for current week's session, return tips
- `generateCoaching` -- Rate limit check, call generate function
- `submitTipFeedback` -- Upsert feedback

### Step 5: Build frontend components
- `coaching-card.tsx` with tip list
- `coaching-tip.tsx` with feedback buttons
- Loading skeleton

### Step 6: Integrate into dashboard
- Add coaching card to dashboard layout (below stats, above charts or in sidebar)
- Show empty state if no coaching generated yet

### Step 7: Set up Vercel Cron
- Add cron config to `vercel.json`
- Build `/api/coaching/generate` route with auth (cron secret)
- Iterate over active users, generate coaching for each

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Claude API costs | Could be expensive at scale | Weekly generation only, cache aggressively, rate-limit manual refreshes to 1/day |
| Claude returns invalid JSON | Parsing fails | Wrap in try/catch, use Claude's JSON mode, fallback to previous week's tips |
| Insufficient data for new users | Generic/useless tips | Require minimum 7 days of data before generating coaching. Show onboarding tips instead. |
| Privacy concerns | Users worried about data | Clearly show "AI Coach analyzes your stats, never your messages" disclaimer |
| Vercel Cron limits | Free tier has limits | Batch process users, use queue if needed. For MVP, process sequentially. |
| Stale coaching | Tips become irrelevant | Week-based expiry, show generation date, allow manual refresh |
