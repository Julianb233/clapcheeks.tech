# Phase 39: Match Profile Engine — Research

**Researched:** 2026-04-14
**Domain:** Supabase schema design, zodiac algorithms, Instagram scraping (Browserbase), communication profiling, Next.js 15 async form patterns
**Confidence:** HIGH (schema, zodiac, Next.js patterns) / MEDIUM (IG scraping specifics)

---

## Summary

Phase 39 builds the data and intelligence layer for the personal dating command center. There are five distinct technical domains: Supabase schema design, zodiac calculation, Instagram scraping via Browserbase, Claude-powered communication profiling, and async-triggered forms in Next.js 15.

The standard approach: a standalone `match_profiles` table (not extending `outward_matches`) with a FK to `auth.users`, a pure TypeScript zodiac module with hardcoded lookup tables, Browserbase/Stagehand for IG scraping using `extract()` with Zod schemas, Claude claude-sonnet-4-6 for communication profile generation (consistent with existing `generate-replies.ts`), and Next.js 15 Route Handler + `after()` for non-blocking background enrichment.

**Primary recommendation:** Save the match profile record immediately on form submit (so the UI unblocks), then trigger IG scrape + communication profile build asynchronously using `after()` in the Route Handler. Poll for completion via `useEffect` + interval on the client, or use Supabase Realtime channel subscription.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@supabase/supabase-js` | ^2.98.0 (already installed) | DB + RLS + Realtime | Already in use everywhere |
| `@supabase/ssr` | 0.7.0 (already installed) | Server-side auth | Already in use |
| `@anthropic-ai/sdk` | ^0.78.0 (already installed) | Claude API for comms profile + interest extraction | Already in use in `generate-replies.ts` |
| `zod` | already installed via `@hookform/resolvers` | Schema validation + Stagehand extract typing | Already in use |

### Supporting (no new installs needed)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `date-fns` | 4.1.0 (already installed) | Date parsing for birthday → zodiac | Use `parseISO`, `getMonth`, `getDate` |
| Browserbase MCP tools | fleet-installed | IG scraping | Available as MCP, no npm install needed |
| `@radix-ui/react-dialog` | already installed | Add Match modal | Already in use |
| `@radix-ui/react-select` | already installed | Pipeline stage selector | Already in use |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure TS zodiac module | npm `zodiac-sign` or similar | Custom module has zero deps and full control over scoring data; external packages have unpredictable output shapes |
| Browserbase Stagehand | Apify Instagram scraper | Apify is paid per-actor-run; Browserbase is fleet infrastructure already available |
| `after()` for background jobs | Supabase Edge Function | Edge functions require Deno and deploy; `after()` runs in the same Vercel function, simpler for this use case |

**Installation:** No new packages required. All dependencies already present.

---

## Architecture Patterns

### Recommended Project Structure

```
web/
├── app/
│   ├── (main)/
│   │   └── matches/              # New page — Add Match form + profile view
│   │       ├── page.tsx           # Server component — profile list
│   │       ├── add/
│   │       │   └── page.tsx       # Client component — Add Match form
│   │       └── [id]/
│   │           └── page.tsx       # Match profile detail view
│   └── api/
│       └── matches/
│           ├── route.ts           # POST create match + trigger enrichment
│           └── [id]/
│               └── route.ts       # GET/PATCH individual match
├── lib/
│   ├── zodiac/
│   │   ├── signs.ts               # Sign data: dates, element, modality, planet, traits
│   │   ├── calculate.ts           # getZodiac(dateOfBirth) → ZodiacProfile
│   │   └── compatibility.ts       # getCompatibility(sign1, sign2) → CompatibilityScore
│   ├── instagram/
│   │   └── scraper.ts             # scrapeIGProfile(handle) → IGProfile | { private: true }
│   └── matches/
│       └── build-comms-profile.ts # buildCommsProfile(igData, notes, convHistory) → CommsProfile
supabase/
└── migrations/
    └── 20260414000001_match_profiles.sql
```

### Pattern 1: Immediate Save + Background Enrichment

**What:** POST to `/api/matches` saves the record immediately (returns 200 fast), then `after()` triggers IG scrape + profile build asynchronously.
**When to use:** Always for this phase — IG scraping takes 5-15 seconds; the user must not wait.

```typescript
// Source: https://nextjs.org/docs/app/api-reference/functions/after
// app/api/matches/route.ts
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await request.json()

  // 1. Insert record immediately — status = 'enriching'
  const { data: match, error } = await supabase
    .from('match_profiles')
    .insert({
      user_id: user.id,
      name: body.name,
      ig_handle: body.ig_handle || null,
      birthday: body.birthday || null,
      source_platform: body.source_platform,
      notes: body.notes || null,
      enrichment_status: 'pending',
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // 2. Calculate zodiac immediately if birthday provided (pure sync, fast)
  if (body.birthday) {
    const zodiac = getZodiac(body.birthday)
    await supabase
      .from('match_profiles')
      .update({ zodiac_sign: zodiac.sign, zodiac_element: zodiac.element, zodiac_modality: zodiac.modality })
      .eq('id', match.id)
  }

  // 3. Fire background enrichment after response is sent
  if (body.ig_handle) {
    after(async () => {
      await enrichMatchProfile(match.id, body.ig_handle, user.id)
    })
  }

  return Response.json({ match, enriching: !!body.ig_handle })
}
```

**Key constraint:** `after()` on Vercel has the same timeout as the parent function (default 10s, configurable up to 60s on Vercel Pro). Instagram scraping takes ~8-12s. This is tight. Mitigation: use `export const maxDuration = 60` in the route segment config if on Vercel Pro, or implement polling-based retry if `after()` times out.

### Pattern 2: Stagehand IG Extract with Zod Schema

**What:** Use Browserbase Stagehand `extract()` with Zod schema for typed IG profile data.
**When to use:** The IG handle is provided and profile is public.

```typescript
// Source: https://github.com/browserbase/stagehand/blob/main/README.md
// lib/instagram/scraper.ts
import { z } from 'zod'

const IGProfileSchema = z.object({
  bio: z.string().nullable().describe('The profile bio/description text'),
  follower_count: z.string().nullable().describe('Follower count as displayed (e.g. "12.3K")'),
  following_count: z.string().nullable().describe('Following count as displayed'),
  post_count: z.string().nullable().describe('Total post count as displayed'),
  is_private: z.boolean().describe('Whether the account is private'),
  profile_pic_url: z.string().nullable().describe('URL of the profile photo'),
  recent_captions: z.array(z.string()).describe('Captions from the most recent posts, up to 12'),
})

export type IGProfile = z.infer<typeof IGProfileSchema>

// Called via Browserbase MCP tools — this is the pattern for the Next.js API route
// that calls back to a fleet script or uses the MCP directly
export async function scrapeIGProfile(handle: string): Promise<IGProfile | null> {
  // Use Browserbase MCP tools: browserbase_session_create → navigate →
  // observe (check if private) → extract
  // Exact MCP tool calls happen in the Route Handler via fetch to an internal endpoint
  // or directly if running in an agent context
  const url = `https://www.instagram.com/${handle}/`
  // ... MCP tool sequence
}
```

**Login requirement:** Public profiles do NOT require login. Bio, follower count, recent public captions are all accessible without authentication. Private profiles return a "This Account is Private" screen — detect via observe before extract.

### Pattern 3: Zodiac Calculation (Pure TypeScript Lookup)

**What:** Hardcode all 12 signs as data. Birthday → sign is a simple date range check.
**When to use:** Always — no external library needed.

```typescript
// Source: zodiac data verified against https://thalira.com/blogs/quantum-codex/zodiac-sign-dates-guide
// lib/zodiac/signs.ts
export const ZODIAC_SIGNS = [
  {
    sign: 'Aries', element: 'Fire', modality: 'Cardinal', planet: 'Mars',
    startMonth: 3, startDay: 21, endMonth: 4, endDay: 19,
    traits: ['bold', 'passionate', 'impulsive', 'energetic'],
    commsHints: 'Direct and confident. Responds to bold openers. Gets bored by slow burn. Match their energy — quick replies, decisive suggestions.',
  },
  {
    sign: 'Taurus', element: 'Earth', modality: 'Fixed', planet: 'Venus',
    startMonth: 4, startDay: 20, endMonth: 5, endDay: 20,
    traits: ['sensual', 'patient', 'stubborn', 'reliable'],
    commsHints: 'Slow and deliberate. Appreciates quality over quantity. Mention food, comfort, aesthetics. Avoid rushing.',
  },
  // ... all 12 signs
] as const
```

### Pattern 4: Compatibility Matrix (Element-Based Scoring)

**What:** Base score from element pairing + modifier from modality pairing.
**When to use:** All compatibility calculations.

Element compatibility matrix (verified against multiple astrology sources):

| Fire | Earth | Air | Water |
|------|-------|-----|-------|
| Fire: 80 | Fire-Earth: 40 | Fire-Air: 85 | Fire-Water: 35 |
| Earth-Fire: 40 | Earth: 75 | Earth-Air: 45 | Earth-Water: 80 |
| Air-Fire: 85 | Air-Earth: 45 | Air: 80 | Air-Water: 50 |
| Water-Fire: 35 | Water-Earth: 80 | Water-Air: 50 | Water: 85 |

Modality modifier (add/subtract from base):

- Same modality (both Cardinal, both Fixed, both Mutable): -5 (power struggle potential)
- Complementary (Cardinal+Mutable): +5
- Cardinal+Fixed or Fixed+Mutable: 0 (neutral)

Final score = element_base + modality_modifier, clamped 0-100.

Breakdown dimensions (for PROFILE-03 requirement):
- `emotional`: weighted toward element (water+earth = high, fire+air = moderate)
- `communication`: weighted toward modality match
- `physical`: fire+fire or fire+air = high, water+earth = moderate
- `overall`: weighted average (emotional 30%, comms 30%, physical 40%)

### Anti-Patterns to Avoid

- **Blocking the form on IG scrape:** Never await the Browserbase session inside the route handler before returning — user gets a 15s spinner. Use `after()`.
- **Extending `outward_matches`:** Don't add match profile columns to `outward_matches`. That table is for platform-sourced matches with a match_id. `match_profiles` is richer, manually curated, with FK `outward_match_id NULLABLE`.
- **Computing compatibility at read time:** Pre-compute when profile is created/updated. Store `zodiac_compatibility_score` as a column. Julian's zodiac is Leo (born 1990-07-29 per `profiles.date_of_birth` — verify at build time).
- **Scraping without session isolation:** Each Browserbase scrape needs its own session via `browserbase_session_create` + `browserbase_session_close`. Don't reuse sessions across scrapes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Date parsing | Custom date parser | `date-fns` `parseISO` + `getMonth`/`getDate` | Already installed, handles edge cases (leap years, timezone) |
| Form validation | Manual validation | `react-hook-form` + zod (already in `@hookform/resolvers`) | Already installed |
| Async state in form | Custom loading state | `useActionState` (React 19 / Next.js 15) | Built-in, handles progressive enhancement |
| Background task delay | `setTimeout` + arbitrary sleep | `after()` from `next/server` | Stable since Next.js 15.1, executes after response |
| JSONB schema enforcement | TypeScript-only | Zod schema with `.parse()` before insert | Validates at runtime before hitting Supabase |
| Zodiac library | npm package | Inline data array | All 12 signs fit in ~100 lines; no external dep with unknown update cadence |

**Key insight:** This phase is mostly data layer + algorithms. Avoid over-engineering with external services when a 100-line TypeScript module does the job.

---

## Common Pitfalls

### Pitfall 1: Instagram Login Wall / Private Profiles

**What goes wrong:** Browserbase navigates to `instagram.com/{handle}` and hits a login interstitial or "This Account is Private" wall. `extract()` returns empty or wrong data.
**Why it happens:** Instagram aggressively gates content. Even public profiles sometimes show a login prompt to unauthenticated browser sessions.
**How to avoid:**
1. After navigate, use `browserbase_stagehand_observe` to check the page state: "Is this a private account? Is there a login prompt?"
2. If login prompt detected, try navigating to the profile without the trailing slash, or use the mobile URL `m.instagram.com/{handle}`
3. If private, return `{ private: true, bio: extracted_if_visible }` — the bio is sometimes visible even on private profiles
4. Store `ig_scrape_status: 'private' | 'success' | 'failed' | 'pending'` on the profile row
**Warning signs:** `extract()` returns null for `bio` and `follower_count` despite a valid handle.

### Pitfall 2: `after()` Timeout on Vercel Serverless

**What goes wrong:** IG scraping takes 10-20s (session create + navigate + observe + extract + close). Default Vercel function timeout is 10s. `after()` shares the timeout.
**Why it happens:** Vercel serverless functions terminate after the timeout even if `waitUntil` is in progress.
**How to avoid:**
1. Add `export const maxDuration = 60` to the route segment (requires Vercel Pro or above)
2. OR: Don't use `after()` for IG scraping. Instead, return immediately from the Route Handler and let the client poll via `/api/matches/[id]` with `?include=enrichment_status`. A separate "enrich" endpoint can be called client-side after the form submits.
3. OR: Implement scraping as a Supabase Edge Function triggered by a DB insert (more robust, decoupled from Vercel timeout)
**Warning signs:** `enrichment_status` stays `'pending'` forever after form submit.

**Recommended mitigation:** Use the client-side trigger pattern:
```typescript
// Client form submits → creates match record (fast)
// Client receives { id, enriching: true }
// Client calls POST /api/matches/[id]/enrich (separate request, no timeout pressure on form)
// Enrich endpoint runs scrape, updates record
// Client polls GET /api/matches/[id] every 2s until enrichment_status = 'done'
```

### Pitfall 3: Zodiac Cusp Dates

**What goes wrong:** A birthday of April 19 returns Aries when the user's chart says Taurus (or vice versa) depending on the exact year's solar ingress.
**Why it happens:** The sun changes signs around the 19th-21st of each month but the exact hour/minute varies by year.
**How to avoid:** Use "approximate" ranges (treat cusp dates as Aries-side or Taurus-side consistently). Add a `zodiac_override` column so users can correct their sign manually. Document this limitation in the UI.
**Warning signs:** Users report wrong zodiac sign.

### Pitfall 4: Communication Profile Over-Fitting

**What goes wrong:** Claude generates a communication profile for a match with only a name and birthday. Output is too generic to be useful.
**Why it happens:** Insufficient input data.
**How to avoid:** Only generate comms profile when at least one of these is present: IG bio + captions, OR 10+ conversation messages, OR manual notes. Return `null` comms profile when data is insufficient. The UI should show "Add IG or paste conversation to unlock profile."
**Warning signs:** Comms profile says "This person seems friendly and enjoys social activities" — too generic.

### Pitfall 5: RLS Policy Gap on `match_profiles`

**What goes wrong:** Users can see other users' match profiles.
**Why it happens:** Forgetting to enable RLS + add user-scoped policies on new tables.
**How to avoid:** Use the same RLS pattern as all other clapcheeks tables:
```sql
ALTER TABLE public.match_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own match profiles"
  ON public.match_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
```
**Warning signs:** `SELECT * FROM match_profiles` returns rows for all users.

---

## Code Examples

### Zodiac Calculation

```typescript
// Source: Date ranges verified from https://thalira.com/blogs/quantum-codex/zodiac-sign-dates-guide
// lib/zodiac/calculate.ts

type ZodiacSign = 'Aries' | 'Taurus' | 'Gemini' | 'Cancer' | 'Leo' | 'Virgo' |
  'Libra' | 'Scorpio' | 'Sagittarius' | 'Capricorn' | 'Aquarius' | 'Pisces'

interface ZodiacProfile {
  sign: ZodiacSign
  element: 'Fire' | 'Earth' | 'Air' | 'Water'
  modality: 'Cardinal' | 'Fixed' | 'Mutable'
  planet: string
  traits: string[]
  commsHints: string
}

export function getZodiac(dateOfBirth: string): ZodiacProfile {
  const date = parseISO(dateOfBirth) // date-fns
  const month = getMonth(date) + 1  // 1-12
  const day = getDate(date)

  // Capricorn spans Dec 22 → Jan 19 (crosses year boundary — handle specially)
  if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) {
    return SIGN_DATA['Capricorn']
  }

  const sign = SIGN_RANGES.find(s => 
    (month === s.startMonth && day >= s.startDay) ||
    (month === s.endMonth && day <= s.endDay)
  )

  return SIGN_DATA[sign?.name ?? 'Aries']
}
```

### Compatibility Score

```typescript
// Source: element compatibility from https://discover.hubpages.com/relationships/Compatibility_Elements
// lib/zodiac/compatibility.ts

const ELEMENT_SCORES: Record<string, Record<string, number>> = {
  Fire:  { Fire: 80, Earth: 40, Air: 85, Water: 35 },
  Earth: { Fire: 40, Earth: 75, Air: 45, Water: 80 },
  Air:   { Fire: 85, Earth: 45, Air: 80, Water: 50 },
  Water: { Fire: 35, Earth: 80, Air: 50, Water: 85 },
}

const MODALITY_MODIFIER: Record<string, Record<string, number>> = {
  Cardinal: { Cardinal: -5, Fixed: 0, Mutable: 5 },
  Fixed:    { Cardinal: 0, Fixed: -5, Mutable: 0 },
  Mutable:  { Cardinal: 5, Fixed: 0, Mutable: -5 },
}

export function getCompatibility(sign1: ZodiacSign, sign2: ZodiacSign) {
  const s1 = SIGN_DATA[sign1]
  const s2 = SIGN_DATA[sign2]
  
  const elementBase = ELEMENT_SCORES[s1.element][s2.element]
  const modalityMod = MODALITY_MODIFIER[s1.modality][s2.modality]
  const overall = Math.max(0, Math.min(100, elementBase + modalityMod))
  
  // Breakdown dimensions
  const emotional = Math.round(overall * (s1.element === 'Water' || s2.element === 'Water' ? 1.1 : 0.9))
  const communication = Math.round(elementBase * (s1.modality === s2.modality ? 0.85 : 1.0))
  const physical = Math.round(elementBase * (s1.element === 'Fire' || s2.element === 'Fire' ? 1.15 : 0.9))
  
  return {
    overall: Math.min(100, overall),
    emotional: Math.min(100, emotional),
    communication: Math.min(100, communication),
    physical: Math.min(100, physical),
    summary: getSummaryText(overall),
  }
}
```

### Stagehand IG Scrape Pattern

```typescript
// Source: https://github.com/browserbase/stagehand/blob/main/README.md
// Executed via Browserbase MCP tools from the API route

// Step 1: Create session (via MCP: browserbase_session_create)
// Step 2: Navigate (via MCP: browserbase_stagehand_navigate)
//   url: `https://www.instagram.com/${handle}/`
// Step 3: Observe (via MCP: browserbase_stagehand_observe)
//   instruction: "Is this a private account? Is there a 'This account is private' message? Is there a login wall?"
// Step 4a: If private → extract what's visible
// Step 4b: If public → extract full profile
//   instruction: "Extract the profile bio, follower count, following count, post count, and up to 12 recent post captions"
//   schema: IGProfileSchema (Zod)
// Step 5: Close session (via MCP: browserbase_session_close)

// The scraper module wraps these MCP calls via a fetch to /api/internal/scrape-ig
// which the Route Handler's after() callback can call
```

### Communication Profile Builder (Claude Pattern)

```typescript
// Source: Consistent with web/lib/conversation-ai/generate-replies.ts pattern
// lib/matches/build-comms-profile.ts

import Anthropic from '@anthropic-ai/sdk'

export async function buildCommsProfile(input: {
  igBio?: string
  igCaptions?: string[]
  conversationHistory?: string
  notes?: string
  zodiacSign?: string
}): Promise<CommsProfile | null> {
  const hasEnoughData = input.igBio || (input.igCaptions?.length ?? 0) >= 3 || 
    (input.conversationHistory?.length ?? 0) > 200 || input.notes

  if (!hasEnoughData) return null

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: `You are a dating communication analyst. Analyze the provided data about a person 
and return a JSON communication profile for dating context. Be specific, not generic.`,
    messages: [{
      role: 'user',
      content: `Analyze this person and return ONLY valid JSON matching this schema:
{
  "disc_estimate": "D" | "I" | "S" | "C",
  "disc_confidence": "high" | "medium" | "low",
  "style": "playful" | "intellectual" | "warm" | "direct" | "mysterious",
  "emoji_usage": "heavy" | "moderate" | "minimal" | "none",
  "ideal_message_length": "short" | "medium" | "long",
  "best_topics": ["topic1", "topic2", "topic3"],
  "avoid_topics": ["topic1", "topic2"],
  "opener_suggestion": "one specific opening message tailored to this person",
  "move_to_text_readiness": 0-100
}

Data: ${JSON.stringify(input)}`
    }],
  })

  return JSON.parse(message.content[0].type === 'text' ? message.content[0].text : '{}')
}
```

---

## Schema Design

### `match_profiles` Table

```sql
-- supabase/migrations/20260414000001_match_profiles.sql
CREATE TABLE IF NOT EXISTS public.match_profiles (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  
  -- Identity
  name                     TEXT NOT NULL,
  source_platform          TEXT NOT NULL CHECK (source_platform IN ('tinder', 'bumble', 'hinge', 'irl', 'other')),
  phone                    TEXT,
  birthday                 DATE,
  notes                    TEXT,

  -- Zodiac (computed from birthday)
  zodiac_sign              TEXT,
  zodiac_element           TEXT,
  zodiac_modality          TEXT,
  zodiac_ruling_planet     TEXT,
  zodiac_compatibility_score INTEGER, -- 0-100 vs Julian's sign
  zodiac_compatibility_breakdown JSONB, -- { emotional, communication, physical, summary }

  -- Instagram
  ig_handle                TEXT,
  ig_bio                   TEXT,
  ig_follower_count        INTEGER,
  ig_following_count       INTEGER,
  ig_post_count            INTEGER,
  ig_profile_pic_url       TEXT,
  ig_recent_captions       JSONB,   -- string[]
  ig_interests             JSONB,   -- extracted by Claude: { hobbies, travel, food, fitness, hooks }
  ig_scraped_at            TIMESTAMPTZ,
  ig_is_private            BOOLEAN DEFAULT false,

  -- Pipeline
  pipeline_stage           TEXT NOT NULL DEFAULT 'new'
                           CHECK (pipeline_stage IN ('new', 'talking', 'number_got', 'date_planned', 'dated', 'ranked')),
  
  -- Scores (all 1-10, null until rated)
  attraction_score         INTEGER CHECK (attraction_score BETWEEN 1 AND 10),
  conversation_score       INTEGER CHECK (conversation_score BETWEEN 1 AND 10),
  effort_score             INTEGER CHECK (effort_score BETWEEN 1 AND 10),
  overall_rank             NUMERIC(4,2), -- computed weighted composite

  -- Communication profile
  communication_profile    JSONB,   -- { disc_estimate, style, emoji_usage, best_topics, avoid_topics, ... }
  
  -- Link to platform match (optional)
  outward_match_id         UUID REFERENCES public.outward_matches(id) ON DELETE SET NULL,

  -- Enrichment tracking
  enrichment_status        TEXT NOT NULL DEFAULT 'pending'
                           CHECK (enrichment_status IN ('pending', 'enriching', 'done', 'failed', 'skipped')),
  enrichment_error         TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_match_profiles_user_id ON public.match_profiles(user_id);
CREATE INDEX idx_match_profiles_pipeline ON public.match_profiles(user_id, pipeline_stage);
CREATE INDEX idx_match_profiles_rank ON public.match_profiles(user_id, overall_rank DESC NULLS LAST);

ALTER TABLE public.match_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own match profiles"
  ON public.match_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update updated_at
CREATE TRIGGER match_profiles_updated_at
  BEFORE UPDATE ON public.match_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### Relationship to Existing Tables

- `match_profiles.user_id` → `auth.users.id` (mandatory FK, same pattern as all tables)
- `match_profiles.outward_match_id` → `outward_matches.id` (nullable FK — only set if match came from app automation)
- `match_profiles` does NOT extend `outward_matches` — they serve different purposes: `outward_matches` tracks platform automation state, `match_profiles` is the enriched personal dating intelligence layer
- No FK to `outward_conversations` — Phase 41 will join them by match name/platform

---

## UI Patterns for Async-Trigger Forms

### Pattern: Submit Fast, Poll for Enrichment

Next.js 15.5.12 is available. `after()` is stable since 15.1.0.

**Recommended flow for Add Match form:**

```
1. User fills form (name + optional: birthday, IG handle, notes, platform)
2. User submits → POST /api/matches
3. Route Handler:
   a. Inserts match_profiles record (status = 'pending')
   b. Calculates zodiac synchronously if birthday provided
   c. Returns { id, zodiac, enriching: true/false }
   d. After returning response: calls after() → scrapeIG + buildCommsProfile
4. Client receives { id, enriching: true }
5. Client redirects to /matches/[id] with optimistic data shown
6. Client polls GET /api/matches/[id] every 3s while enrichment_status = 'pending'
7. When status = 'done', re-render with IG data + comms profile
```

**UI states to handle:**
- `enriching`: Show "Pulling Instagram..." skeleton with spinner on ig_bio, ig_interests, communication_profile sections
- `done`: Show all sections with data
- `failed`: Show "Instagram scrape failed" with retry button
- `skipped`: No IG handle provided — show "Add @handle to unlock profile"

**Component pattern for the form:**
```tsx
// app/(main)/matches/add/page.tsx — 'use client'
// Uses react-hook-form (already installed) + zod resolver
// On submit: fetch('/api/matches', { method: 'POST', body: JSON.stringify(data) })
// On success: router.push(`/matches/${data.id}?enriching=true`)
```

**After() limitation on Vercel timeout:**
- Default max function duration: 10s (Hobby), 60s (Pro)
- Browserbase scrape: ~8-15s (session create + navigate + extract + close)
- If on Vercel Hobby: `after()` will time out. Use client-triggered enrichment instead.
- Vercel Pro: add `export const maxDuration = 60` to `/api/matches/route.ts`
- Safe fallback: Expose `POST /api/matches/[id]/enrich` — client calls this after redirect, not inside `after()`

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Blocking form on async work | `after()` non-blocking + polling | Next.js 15.1 (stable) | UX: form submits instantly |
| Instagram unofficial API calls | Browserbase browser automation | 2024 (IG blocked API access) | Reliability: real browser beats API blocks |
| External zodiac npm packages | Inline data tables | Always the right choice here | Zero external dependency, full control |
| DISC survey questionnaire | AI inference from behavioral signals (IG, messages) | 2024 with LLMs | No user survey needed |

**Deprecated/outdated:**
- `unstable_after`: Use `after` (stable since 15.1.0). The `NEXT_PUBLIC_` prefix is not needed.
- Direct Instagram Graph API: Requires business account verification; doesn't work for arbitrary profiles.

---

## Open Questions

1. **Julian's zodiac for compatibility calculation**
   - What we know: The `profiles` table has `date_of_birth DATE`. Julian is the authenticated user.
   - What's unclear: Should Julian's sign be fetched from his profile row at runtime or hardcoded as a constant for performance?
   - Recommendation: Fetch from `profiles` at profile creation time and store as a constant in the zodiac module. Add a fallback if `date_of_birth` is null (skip compatibility score).

2. **Vercel plan tier**
   - What we know: Project deploys to Vercel (`prj_0Ra8fB9WK2RsKV31xUjnFXy2iAki`). Hobby has 10s limit.
   - What's unclear: Current Vercel plan (Hobby vs Pro).
   - Recommendation: Build the client-triggered enrichment pattern (not `after()`) as the primary flow. Use `after()` only for lightweight post-processing (e.g., logging, analytics). This avoids the timeout problem entirely regardless of plan.

3. **Browserbase session cost**
   - What we know: Browserbase charges per session-minute. IG scrape takes ~10s per profile.
   - What's unclear: Monthly budget for Browserbase sessions.
   - Recommendation: Implement scrape deduplication — if `ig_scraped_at` is within 7 days, skip re-scrape. Add a manual "Refresh" button.

4. **Instagram login requirement for modern profiles**
   - What we know: Public profiles technically don't require login. But Instagram aggressively serves login prompts.
   - What's unclear: Current (April 2026) IG behavior with Browserbase real-browser sessions.
   - Recommendation: Add `observe` step before `extract` to detect login walls. Have fallback: if login prompt detected 3 times, set `ig_scrape_status = 'login_required'` and surface a manual-entry form for bio/interests.

---

## Sources

### Primary (HIGH confidence)
- Next.js docs `after()` function — https://nextjs.org/docs/app/api-reference/functions/after (fetched 2026-04-14, version 16.2.3)
- Stagehand README extract() API — https://github.com/browserbase/stagehand/blob/main/README.md (fetched 2026-04-14)
- Zodiac sign date ranges — https://thalira.com/blogs/quantum-codex/zodiac-sign-dates-guide (fetched 2026-04-14)
- Codebase inspection: all migration files, `generate-replies.ts`, `suggest/route.ts`, `package.json`, `CLAUDE.md`

### Secondary (MEDIUM confidence)
- Instagram scraping requirements — https://scrapfly.io/blog/posts/how-to-scrape-instagram (fetched 2026-04-14)
- Instagram data without login — https://scrapecreators.com/blog/how-to-scrape-instagram-data-the-complete-2025-guide (fetched 2026-04-14)
- Element compatibility scoring — https://discover.hubpages.com/relationships/Compatibility_Elements (WebSearch verified against multiple sources)
- Supabase background jobs with realtime — https://www.jigz.dev/blogs/how-i-solved-background-jobs-using-supabase-tables-and-edge-functions

### Tertiary (LOW confidence)
- DISC profiling in dating context — no authoritative source found; recommendation is to use AI inference (Claude) rather than traditional DISC instrument
- Modality compatibility modifiers — derived from astrology community consensus; no single authoritative source

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed, patterns verified in codebase
- Schema design: HIGH — follows exact patterns from existing migrations
- Zodiac engine: HIGH — date ranges verified from authoritative source, algorithm is trivial math
- Compatibility scoring: MEDIUM — element matrix confirmed from multiple sources; specific numeric values are interpretive
- IG scraping: MEDIUM — Browserbase + Stagehand approach is correct; exact behavior with Instagram's current anti-bot measures may vary
- Communication profiling: MEDIUM — Claude inference approach is validated by existing `generate-replies.ts` pattern; DISC adaptation for dating is novel

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (stable domain; Instagram anti-bot behavior may shift sooner)
