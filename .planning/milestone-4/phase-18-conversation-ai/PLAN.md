# Phase 18: Conversation AI

## Overview

Build an AI reply suggestion system that helps users craft responses in dating app conversations. Users view their conversations in the dashboard and get AI-generated reply suggestions they can copy/paste. Includes a Voice Calibration feature that analyzes the user's iMessage history to build a personal style profile so suggestions match their natural voice. Uses Claude claude-sonnet-4-6 for generation.

## Key Technical Decisions

**Dashboard-based UX (copy/paste)** -- Suggestions surface in the web dashboard, not injected into dating apps. User copies the suggestion and pastes into their dating app. This is simpler, more reliable, and avoids browser automation complexity for messaging.

**Voice Calibration from iMessage** -- The local agent (Phase 7) already reads iMessage. It extracts a "voice profile" -- vocabulary patterns, sentence length, emoji usage, humor style, formality level -- and syncs it to Supabase. Claude uses this profile to generate replies that sound like the user.

**Style profiles stored in Supabase** -- Cloud storage (not local-only) so the dashboard can access the profile for generation. Profile contains aggregate style traits, not raw messages. Privacy-safe.

**Conversation context from outward_conversations** -- The existing `outward_conversations` table stores messages as JSONB. The AI reads the last N messages as context for reply generation.

**Claude claude-sonnet-4-6 for generation** -- Same model as coaching. Good at maintaining voice consistency and understanding conversational context.

## DB Schema Changes

### New table: `clapcheeks_voice_profiles`
```sql
create table if not exists public.clapcheeks_voice_profiles (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  profile_data jsonb not null,
  -- profile_data structure:
  -- {
  --   "avg_message_length": 42,
  --   "emoji_frequency": "moderate",  -- none/rare/moderate/heavy
  --   "common_emojis": ["haha", "lol"],
  --   "formality": "casual",          -- formal/neutral/casual/very_casual
  --   "humor_style": "dry",           -- dry/playful/sarcastic/none
  --   "vocabulary_level": "conversational",
  --   "greeting_patterns": ["hey", "yo"],
  --   "sign_off_patterns": ["later", "ttyl"],
  --   "sample_phrases": ["that's wild", "no way"],
  --   "punctuation_style": "minimal", -- formal/standard/minimal/none
  --   "capitalization": "lowercase",  -- proper/mixed/lowercase
  --   "response_length_preference": "short" -- short/medium/long
  -- }
  messages_analyzed int default 0,
  calibrated_at timestamptz default now(),
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table clapcheeks_voice_profiles enable row level security;
-- RLS: users see/update own profile only
```

### New table: `clapcheeks_reply_suggestions`
```sql
create table if not exists public.clapcheeks_reply_suggestions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  conversation_id uuid references outward_conversations(id) on delete cascade not null,
  suggestions jsonb not null,
  -- suggestions structure: [
  --   { "text": "reply text", "tone": "playful", "confidence": 0.85 },
  --   { "text": "reply text", "tone": "direct", "confidence": 0.72 },
  --   { "text": "reply text", "tone": "flirty", "confidence": 0.68 }
  -- ]
  context_messages_count int,        -- how many messages were in context
  was_used boolean default false,    -- did user copy one?
  used_suggestion_index int,         -- which one they picked
  model_used text default 'claude-sonnet-4-6',
  created_at timestamptz default now() not null
);

alter table clapcheeks_reply_suggestions enable row level security;
```

## API Endpoints

### Server Actions
- `getConversations(userId, platform?)` -- List active conversations with last message preview
- `getConversationDetail(userId, conversationId)` -- Full message history
- `generateReplies(userId, conversationId)` -- Generate 3 reply suggestions
- `markReplyUsed(suggestionId, index)` -- Track which suggestion was copied
- `getVoiceProfile(userId)` -- Return current voice profile
- `recalibrateVoice(userId)` -- Trigger re-calibration (signals local agent)

### API Routes
- `POST /api/voice-profile` -- Local agent uploads voice profile data
- `POST /api/conversations/sync` -- Local agent syncs conversation updates

## Claude Prompt Engineering

### System prompt for reply generation
```
You are a dating conversation assistant for Clap Cheeks.
Generate reply suggestions that match the user's natural voice.

User's voice profile:
{voice_profile_json}

Rules:
- Match the user's texting style exactly (length, emoji, capitalization, formality)
- Generate 3 replies with different tones: playful, direct, flirty
- Keep replies natural -- they should sound like the user, not an AI
- Consider conversation context and momentum
- If the other person asked a question, answer it
- Never be creepy, desperate, or aggressive
- Keep it concise -- dating app messages should be short

Output format: JSON array of 3 suggestions.
```

### User prompt template
```
Conversation on {platform} with {match_name}:
{last_10_messages_formatted}

Their last message: "{last_message}"

Generate 3 reply options.
Return JSON: [{ "text": "reply", "tone": "playful|direct|flirty", "confidence": 0.0-1.0 }]
```

## Frontend Components

### New routes and components
```
web/app/(main)/dashboard/
  conversations/
    page.tsx                      -- Conversation list view
    [id]/
      page.tsx                    -- Single conversation with reply suggestions
  components/
    conversation-list.tsx         -- List of active conversations
    conversation-thread.tsx       -- Message thread display
    reply-suggestions.tsx         -- AI suggestion cards with copy button
    voice-profile-card.tsx        -- Voice calibration status and settings
    tone-badge.tsx               -- Playful/Direct/Flirty badge
```

### Component details

**`conversation-list.tsx`** (client)
- List of active conversations grouped by platform
- Shows: platform icon, match name, last message preview, timestamp
- Badge for unread / needs reply
- Click navigates to conversation detail

**`conversation-thread.tsx`** (client)
- iMessage-style bubble layout (user messages right, theirs left)
- Dark theme bubbles (brand color for user, gray for match)
- Auto-scroll to bottom
- Timestamp headers for day breaks

**`reply-suggestions.tsx`** (client)
- 3 suggestion cards below the conversation thread
- Each card: tone badge, reply text, copy button, confidence indicator
- Copy button: copies text to clipboard, shows "Copied!" feedback, records usage
- "Regenerate" button to get new suggestions
- Loading skeleton while generating

**`voice-profile-card.tsx`** (client)
- Shows calibration status: "Calibrated from 847 messages" or "Not calibrated"
- Style traits preview: "Casual, short messages, rare emojis, dry humor"
- "Recalibrate" button
- Placed in dashboard settings or sidebar

## Implementation Steps

### Step 1: Create DB migration
- `clapcheeks_voice_profiles` table
- `clapcheeks_reply_suggestions` table
- RLS policies

### Step 2: Build voice profile API
- `POST /api/voice-profile` endpoint for local agent to upload
- Validate profile_data structure
- Upsert into `clapcheeks_voice_profiles`

### Step 3: Build reply generation logic
- `lib/conversation-ai/generate-replies.ts`:
  1. Load conversation from `outward_conversations`
  2. Load voice profile from `clapcheeks_voice_profiles`
  3. Build prompt with last 10 messages + voice profile
  4. Call Claude API
  5. Parse JSON response
  6. Store in `clapcheeks_reply_suggestions`
  7. Return suggestions

### Step 4: Build conversation list page
- Server component fetching from `outward_conversations`
- Group by platform, sort by most recent
- Link to detail page

### Step 5: Build conversation detail page
- Server component: fetch conversation messages
- Client component: thread display + reply suggestions
- Generate button triggers suggestion generation

### Step 6: Build reply suggestion components
- Suggestion cards with copy-to-clipboard
- Track usage (which suggestion copied)
- Regenerate functionality

### Step 7: Build voice profile card
- Display calibration status in dashboard
- Recalibrate button (sets flag for local agent)

### Step 8: Integrate into dashboard navigation
- Add "Conversations" tab/link to dashboard nav
- Show conversation count badge

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Voice profile not calibrated | Generic-sounding suggestions | Default to "casual, friendly" baseline. Show prominent calibration CTA. |
| Conversation data stale | Suggestions based on old context | Show "last synced" timestamp, require recent sync for suggestions |
| Claude API latency | Slow suggestion generation | Show loading skeleton, cache recent suggestions, consider streaming |
| Privacy: storing conversations | User concern about cloud storage | Conversations already in Supabase (outward_conversations). Voice profile is aggregate traits, not raw messages. |
| Users sound too similar | AI homogenizes voice | Voice profile is per-user, explicitly varies style. Test with diverse profiles. |
| Inappropriate suggestions | Brand risk | Claude system prompt has strict guardrails. Log suggestions for review. Never generate sexual/aggressive content. |
| Copy/paste friction | Low adoption | Make copy button prominent, show toast confirmation, track usage to optimize UX |
