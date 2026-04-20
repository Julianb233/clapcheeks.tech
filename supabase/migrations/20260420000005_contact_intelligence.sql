-- Migration: Contact Intelligence System
-- Adds 8 tables for deep per-contact AI analysis and response management
-- Depends on: profiles table, auth.users

BEGIN;

-- ============================================================
-- 1. clapcheeks_contact_profiles — core contact record
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_contact_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Identity
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  platform_match_id TEXT,                -- links to clapcheeks_matches.match_id
  profile_url TEXT,
  avatar_url TEXT,

  -- Timeline
  first_message_date TIMESTAMPTZ,
  last_message_date TIMESTAMPTZ,
  total_messages_sent INT DEFAULT 0,
  total_messages_received INT DEFAULT 0,

  -- Stage & Status
  current_stage TEXT NOT NULL DEFAULT 'opener'
    CHECK (current_stage IN (
      'opener', 'rapport', 'personal', 'transition', 'date_ask', 'dating'
    )),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'active', 'ghosted', 'dated', 'archived', 'unmatched'
    )),

  -- Profile completeness (0.0 to 1.0)
  profile_completeness FLOAT DEFAULT 0.0,

  -- Personality estimates (populated progressively by AI)
  estimated_attachment_style TEXT
    CHECK (estimated_attachment_style IN (
      'secure', 'anxious', 'avoidant', 'disorganized', NULL
    )),
  estimated_love_language TEXT
    CHECK (estimated_love_language IN (
      'words_of_affirmation', 'quality_time', 'acts_of_service',
      'gifts', 'physical_touch', NULL
    )),

  -- Engagement signals
  initiation_ratio FLOAT,              -- 0.0 (never initiates) to 1.0 (always initiates)
  avg_engagement_score FLOAT,          -- rolling average engagement
  sentiment_trend JSONB DEFAULT '[]',  -- array of {date, score} for trend charting

  -- Notes & flags
  user_notes TEXT,                     -- free-form notes from the user
  red_flags JSONB DEFAULT '[]',        -- array of detected red flag strings
  boundaries_expressed JSONB DEFAULT '[]', -- array of boundary strings

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- A user can only have one profile per platform+match combo
  UNIQUE(user_id, platform, platform_match_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contact_profiles_user_id
  ON public.clapcheeks_contact_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_profiles_user_status
  ON public.clapcheeks_contact_profiles(user_id, status);
CREATE INDEX IF NOT EXISTS idx_contact_profiles_user_stage
  ON public.clapcheeks_contact_profiles(user_id, current_stage);
CREATE INDEX IF NOT EXISTS idx_contact_profiles_user_platform
  ON public.clapcheeks_contact_profiles(user_id, platform);
CREATE INDEX IF NOT EXISTS idx_contact_profiles_last_message
  ON public.clapcheeks_contact_profiles(user_id, last_message_date DESC);

-- Auto-update updated_at
CREATE TRIGGER clapcheeks_contact_profiles_updated_at
  BEFORE UPDATE ON public.clapcheeks_contact_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.clapcheeks_contact_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_profiles_select_own"
  ON public.clapcheeks_contact_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "contact_profiles_insert_own"
  ON public.clapcheeks_contact_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "contact_profiles_update_own"
  ON public.clapcheeks_contact_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "contact_profiles_delete_own"
  ON public.clapcheeks_contact_profiles FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 2. clapcheeks_contact_interests — extracted interests per contact
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_contact_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Interest data
  topic TEXT NOT NULL,                   -- e.g. 'surfing', 'Italian cooking', 'Tame Impala'
  category TEXT,                         -- e.g. 'fitness', 'food', 'music'
  intensity_score FLOAT DEFAULT 0.5     -- 0.0 (passing mention) to 1.0 (passionate)
    CHECK (intensity_score >= 0.0 AND intensity_score <= 1.0),
  mention_count INT DEFAULT 1,
  first_detected TIMESTAMPTZ DEFAULT NOW(),
  last_mentioned TIMESTAMPTZ DEFAULT NOW(),
  source_message_snippet TEXT,           -- the message that surfaced this interest (truncated)

  -- Engagement correlation
  triggers_longer_replies BOOLEAN,       -- does this topic make them write more?
  triggers_faster_replies BOOLEAN,       -- does this topic make them reply faster?

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contact_interests_contact_id
  ON public.clapcheeks_contact_interests(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_interests_user_id
  ON public.clapcheeks_contact_interests(user_id);
CREATE INDEX IF NOT EXISTS idx_contact_interests_intensity
  ON public.clapcheeks_contact_interests(contact_id, intensity_score DESC);
CREATE INDEX IF NOT EXISTS idx_contact_interests_category
  ON public.clapcheeks_contact_interests(contact_id, category);

CREATE TRIGGER clapcheeks_contact_interests_updated_at
  BEFORE UPDATE ON public.clapcheeks_contact_interests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clapcheeks_contact_interests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_interests_select_own"
  ON public.clapcheeks_contact_interests FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "contact_interests_insert_own"
  ON public.clapcheeks_contact_interests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "contact_interests_update_own"
  ON public.clapcheeks_contact_interests FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "contact_interests_delete_own"
  ON public.clapcheeks_contact_interests FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 3. clapcheeks_contact_style_profiles — communication analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_contact_style_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Response patterns
  avg_response_time_seconds FLOAT,       -- their average response time to us
  median_response_time_seconds FLOAT,
  response_time_variance FLOAT,          -- low variance = predictable responder

  -- Message style
  avg_message_length FLOAT,              -- average character count
  median_message_length FLOAT,
  messages_per_turn FLOAT,               -- do they send 1 msg or 3-4 rapid fire?

  -- Emoji & tone
  emoji_frequency FLOAT DEFAULT 0.0,     -- emojis per message (0.0 to ~5.0)
  top_emojis TEXT[],                      -- their most-used emojis, ordered
  humor_style TEXT                        -- dry, playful, sarcastic, absurd, none
    CHECK (humor_style IN ('dry', 'playful', 'sarcastic', 'absurd', 'none', NULL)),

  -- Formality & energy
  formality_level FLOAT DEFAULT 0.5      -- 0.0 = very casual, 1.0 = very formal
    CHECK (formality_level >= 0.0 AND formality_level <= 1.0),
  energy_level FLOAT DEFAULT 0.5         -- 0.0 = low energy/chill, 1.0 = high energy/excitable
    CHECK (energy_level >= 0.0 AND energy_level <= 1.0),

  -- Communication quirks
  uses_abbreviations BOOLEAN DEFAULT false,  -- "u" vs "you", "gonna" vs "going to"
  capitalization_style TEXT                   -- 'normal', 'all_lower', 'all_caps', 'mixed'
    CHECK (capitalization_style IN ('normal', 'all_lower', 'all_caps', 'mixed', NULL)),
  punctuation_style TEXT                     -- 'full', 'minimal', 'none', 'excessive'
    CHECK (punctuation_style IN ('full', 'minimal', 'none', 'excessive', NULL)),
  question_frequency FLOAT,                  -- questions per message (0.0 to ~2.0)

  -- Love language signals (0.0 to 1.0 confidence for each)
  love_lang_words_of_affirmation FLOAT DEFAULT 0.0,
  love_lang_quality_time FLOAT DEFAULT 0.0,
  love_lang_acts_of_service FLOAT DEFAULT 0.0,
  love_lang_gifts FLOAT DEFAULT 0.0,
  love_lang_physical_touch FLOAT DEFAULT 0.0,

  -- Metadata
  messages_analyzed INT DEFAULT 0,        -- how many messages this profile is based on
  confidence_score FLOAT DEFAULT 0.0      -- overall confidence in the style profile
    CHECK (confidence_score >= 0.0 AND confidence_score <= 1.0),
  last_recalculated_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_contact_style_contact_id
  ON public.clapcheeks_contact_style_profiles(contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_style_user_id
  ON public.clapcheeks_contact_style_profiles(user_id);

CREATE TRIGGER clapcheeks_contact_style_profiles_updated_at
  BEFORE UPDATE ON public.clapcheeks_contact_style_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clapcheeks_contact_style_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contact_style_select_own"
  ON public.clapcheeks_contact_style_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "contact_style_insert_own"
  ON public.clapcheeks_contact_style_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "contact_style_update_own"
  ON public.clapcheeks_contact_style_profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "contact_style_delete_own"
  ON public.clapcheeks_contact_style_profiles FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 4. clapcheeks_contact_memory_bank — things she mentioned to call back
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_contact_memory_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Memory classification
  memory_type TEXT NOT NULL
    CHECK (memory_type IN (
      'person', 'place', 'event', 'preference', 'goal',
      'pet', 'story', 'inside_joke', 'boundary', 'life_event'
    )),

  -- Content
  content TEXT NOT NULL,                  -- "Her sister's wedding is June 15th"
  context TEXT,                           -- "She mentioned it when talking about travel plans"
  source_message_snippet TEXT,            -- truncated original message

  -- Timing
  mentioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,                -- some memories expire (upcoming events that passed)

  -- Usage tracking
  times_referenced INT DEFAULT 0,        -- how many times we've called this back
  last_referenced TIMESTAMPTZ,           -- when we last used this in a message
  next_callback_eligible_at TIMESTAMPTZ, -- don't reference same memory too soon

  -- Scoring
  relevance_score FLOAT DEFAULT 1.0      -- decays over time, boosted by AI
    CHECK (relevance_score >= 0.0 AND relevance_score <= 1.0),
  emotional_weight FLOAT DEFAULT 0.5     -- how emotionally significant (0=trivial, 1=deep)
    CHECK (emotional_weight >= 0.0 AND emotional_weight <= 1.0),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memory_bank_contact_id
  ON public.clapcheeks_contact_memory_bank(contact_id);
CREATE INDEX IF NOT EXISTS idx_memory_bank_user_id
  ON public.clapcheeks_contact_memory_bank(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_bank_type
  ON public.clapcheeks_contact_memory_bank(contact_id, memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_bank_relevance
  ON public.clapcheeks_contact_memory_bank(contact_id, relevance_score DESC);
CREATE INDEX IF NOT EXISTS idx_memory_bank_expires
  ON public.clapcheeks_contact_memory_bank(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE TRIGGER clapcheeks_contact_memory_bank_updated_at
  BEFORE UPDATE ON public.clapcheeks_contact_memory_bank
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clapcheeks_contact_memory_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memory_bank_select_own"
  ON public.clapcheeks_contact_memory_bank FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "memory_bank_insert_own"
  ON public.clapcheeks_contact_memory_bank FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "memory_bank_update_own"
  ON public.clapcheeks_contact_memory_bank FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "memory_bank_delete_own"
  ON public.clapcheeks_contact_memory_bank FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 5. clapcheeks_conversation_intelligence — per-message analysis
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_conversation_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Message identification
  message_id TEXT,                        -- external message ID from the platform if available
  message_index INT,                      -- position in conversation (1, 2, 3...)
  sender TEXT NOT NULL                    -- 'user' or 'contact'
    CHECK (sender IN ('user', 'contact')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Sentiment & emotion
  sentiment FLOAT                         -- -1.0 (very negative) to 1.0 (very positive)
    CHECK (sentiment >= -1.0 AND sentiment <= 1.0),
  detected_emotion TEXT                   -- happy, excited, sad, angry, anxious, flirty, neutral
    CHECK (detected_emotion IN (
      'happy', 'excited', 'sad', 'angry', 'anxious',
      'flirty', 'neutral', 'playful', 'vulnerable', NULL
    )),
  emotion_confidence FLOAT
    CHECK (emotion_confidence >= 0.0 AND emotion_confidence <= 1.0),

  -- Engagement
  engagement_score FLOAT                  -- 0.0 (low effort) to 1.0 (highly engaged)
    CHECK (engagement_score >= 0.0 AND engagement_score <= 1.0),
  message_length INT,                     -- character count
  question_count INT DEFAULT 0,           -- questions asked in this message

  -- Content analysis
  topics_mentioned TEXT[],                -- array of topic/interest tags
  entities_detected JSONB DEFAULT '[]',   -- [{type: "person", value: "Sarah"}, ...]
  callback_opportunities JSONB DEFAULT '[]', -- memories that could be created from this message

  -- Timing
  response_time_seconds INT,              -- seconds since previous message from other party

  -- AI metadata
  analyzed_by TEXT,                       -- model that analyzed (e.g. 'claude-sonnet-4-6')
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes (this table will be large, so targeted indexes are critical)
CREATE INDEX IF NOT EXISTS idx_conv_intel_contact_id
  ON public.clapcheeks_conversation_intelligence(contact_id);
CREATE INDEX IF NOT EXISTS idx_conv_intel_user_id
  ON public.clapcheeks_conversation_intelligence(user_id);
CREATE INDEX IF NOT EXISTS idx_conv_intel_contact_sent
  ON public.clapcheeks_conversation_intelligence(contact_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_intel_sender
  ON public.clapcheeks_conversation_intelligence(contact_id, sender);
CREATE INDEX IF NOT EXISTS idx_conv_intel_sentiment
  ON public.clapcheeks_conversation_intelligence(contact_id, sentiment)
  WHERE sentiment IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_intel_engagement
  ON public.clapcheeks_conversation_intelligence(contact_id, engagement_score DESC)
  WHERE engagement_score IS NOT NULL;

ALTER TABLE public.clapcheeks_conversation_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conv_intel_select_own"
  ON public.clapcheeks_conversation_intelligence FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "conv_intel_insert_own"
  ON public.clapcheeks_conversation_intelligence FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "conv_intel_update_own"
  ON public.clapcheeks_conversation_intelligence FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "conv_intel_delete_own"
  ON public.clapcheeks_conversation_intelligence FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 6. clapcheeks_contact_response_rules — user-configurable per-contact
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_contact_response_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Mode
  mode TEXT NOT NULL DEFAULT 'suggest'
    CHECK (mode IN ('auto', 'suggest', 'schedule')),
    -- auto: AI sends automatically after approval window
    -- suggest: AI drafts, user must approve
    -- schedule: AI drafts and schedules for optimal time, user approves

  -- Response timing
  min_response_delay_seconds INT DEFAULT 120,    -- never reply faster than this (2 min default)
  max_response_delay_seconds INT DEFAULT 7200,   -- never wait longer than this (2 hr default)

  -- Quiet hours (don't send during these times, in user's timezone)
  quiet_hours_start TIME,                        -- e.g. '23:00'
  quiet_hours_end TIME,                          -- e.g. '07:00'
  timezone TEXT DEFAULT 'America/Los_Angeles',

  -- Cadence rules
  cadence_rule TEXT                               -- freeform rule, interpreted by AI
    CHECK (cadence_rule IN (
      'match_their_pace',       -- mirror their response timing
      'slightly_slower',        -- respond 1.1-1.3x their pace
      'slightly_faster',        -- respond 0.8-0.9x their pace
      'custom',                 -- use min/max delay settings
      NULL
    )),

  -- Tone
  tone_override TEXT,                            -- if set, overrides AI tone detection
    -- Examples: 'playful', 'flirty', 'chill', 'witty', 'deep'

  -- Daily limits
  max_messages_per_day INT,                      -- cap on AI-sent messages per day
  max_initiations_per_week INT DEFAULT 3,        -- don't start too many convos

  -- Feature flags
  auto_extract_memories BOOLEAN DEFAULT true,    -- automatically extract memories from messages
  auto_analyze_sentiment BOOLEAN DEFAULT true,   -- automatically analyze each message
  suggest_callbacks BOOLEAN DEFAULT true,        -- suggest memory callbacks in replies

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_response_rules_contact_id
  ON public.clapcheeks_contact_response_rules(contact_id);
CREATE INDEX IF NOT EXISTS idx_response_rules_user_id
  ON public.clapcheeks_contact_response_rules(user_id);
CREATE INDEX IF NOT EXISTS idx_response_rules_mode
  ON public.clapcheeks_contact_response_rules(user_id, mode);

CREATE TRIGGER clapcheeks_contact_response_rules_updated_at
  BEFORE UPDATE ON public.clapcheeks_contact_response_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clapcheeks_contact_response_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "response_rules_select_own"
  ON public.clapcheeks_contact_response_rules FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "response_rules_insert_own"
  ON public.clapcheeks_contact_response_rules FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "response_rules_update_own"
  ON public.clapcheeks_contact_response_rules FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "response_rules_delete_own"
  ON public.clapcheeks_contact_response_rules FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 7. clapcheeks_scheduled_messages — extends queued_replies with scheduling
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_scheduled_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Message content
  message_text TEXT NOT NULL,
  platform TEXT NOT NULL,
  match_name TEXT,                        -- denormalized for quick display

  -- Scheduling
  send_at TIMESTAMPTZ NOT NULL,           -- when to send
  schedule_reason TEXT,                   -- why this time was chosen
    -- Examples: "Matches her typical active window (7-9pm)",
    --           "3 hours after her last message (matching her pace)"

  -- AI metadata
  ai_confidence_score FLOAT               -- how confident the AI is in this message
    CHECK (ai_confidence_score >= 0.0 AND ai_confidence_score <= 1.0),
  ai_model_used TEXT,                     -- model that generated this
  original_suggestion_id UUID,            -- FK to clapcheeks_reply_suggestions if applicable
  generation_context JSONB,               -- snapshot of what AI knew when generating

  -- Approval flow
  status TEXT NOT NULL DEFAULT 'pending_approval'
    CHECK (status IN (
      'pending_approval',   -- awaiting user review
      'approved',           -- user approved, waiting to send
      'sent',               -- successfully sent
      'cancelled',          -- user cancelled
      'expired',            -- send_at passed without approval
      'failed'              -- send attempted but failed
    )),
  approved_by_user BOOLEAN DEFAULT false,
  approved_at TIMESTAMPTZ,
  sent_at_actual TIMESTAMPTZ,             -- when it was actually sent (may differ from send_at)
  failure_reason TEXT,

  -- Links to existing queued_replies for backward compatibility
  queued_reply_id UUID,                   -- FK to clapcheeks_queued_replies if migrated from there

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_contact_id
  ON public.clapcheeks_scheduled_messages(contact_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_user_id
  ON public.clapcheeks_scheduled_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_send_at
  ON public.clapcheeks_scheduled_messages(send_at)
  WHERE status IN ('approved');
CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_status
  ON public.clapcheeks_scheduled_messages(user_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_msgs_pending
  ON public.clapcheeks_scheduled_messages(user_id, send_at)
  WHERE status = 'pending_approval';

CREATE TRIGGER clapcheeks_scheduled_messages_updated_at
  BEFORE UPDATE ON public.clapcheeks_scheduled_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clapcheeks_scheduled_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "scheduled_msgs_select_own"
  ON public.clapcheeks_scheduled_messages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "scheduled_msgs_insert_own"
  ON public.clapcheeks_scheduled_messages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "scheduled_msgs_update_own"
  ON public.clapcheeks_scheduled_messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "scheduled_msgs_delete_own"
  ON public.clapcheeks_scheduled_messages FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- 8. clapcheeks_contact_availability — when each contact is active
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_contact_availability (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID REFERENCES public.clapcheeks_contact_profiles(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Window definition
  day_of_week INT NOT NULL               -- 0=Sunday, 1=Monday, ..., 6=Saturday
    CHECK (day_of_week >= 0 AND day_of_week <= 6),
  active_start TIME NOT NULL,            -- e.g. '19:00' (7 PM)
  active_end TIME NOT NULL,              -- e.g. '23:00' (11 PM)

  -- Response speed during this window
  avg_response_speed_seconds FLOAT,      -- how fast they typically respond during this window
  message_count_in_window INT DEFAULT 0, -- data points backing this window

  -- Confidence
  confidence FLOAT DEFAULT 0.5           -- 0.0 (guessing) to 1.0 (highly confident)
    CHECK (confidence >= 0.0 AND confidence <= 1.0),
  sample_size INT DEFAULT 0,             -- number of messages used to derive this window

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- One entry per contact per day of week (can be expanded to multiple windows later)
  UNIQUE(contact_id, day_of_week)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_availability_contact_id
  ON public.clapcheeks_contact_availability(contact_id);
CREATE INDEX IF NOT EXISTS idx_availability_user_id
  ON public.clapcheeks_contact_availability(user_id);
CREATE INDEX IF NOT EXISTS idx_availability_day
  ON public.clapcheeks_contact_availability(contact_id, day_of_week);

CREATE TRIGGER clapcheeks_contact_availability_updated_at
  BEFORE UPDATE ON public.clapcheeks_contact_availability
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clapcheeks_contact_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "availability_select_own"
  ON public.clapcheeks_contact_availability FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "availability_insert_own"
  ON public.clapcheeks_contact_availability FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "availability_update_own"
  ON public.clapcheeks_contact_availability FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "availability_delete_own"
  ON public.clapcheeks_contact_availability FOR DELETE
  USING (auth.uid() = user_id);


-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Function: Get full contact context for AI (used when generating replies)
CREATE OR REPLACE FUNCTION get_contact_context(p_contact_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'profile', row_to_json(cp),
    'style', row_to_json(cs),
    'interests', (
      SELECT COALESCE(jsonb_agg(row_to_json(ci) ORDER BY ci.intensity_score DESC), '[]'::jsonb)
      FROM clapcheeks_contact_interests ci WHERE ci.contact_id = p_contact_id
    ),
    'memories', (
      SELECT COALESCE(jsonb_agg(row_to_json(cm) ORDER BY cm.relevance_score DESC), '[]'::jsonb)
      FROM clapcheeks_contact_memory_bank cm
      WHERE cm.contact_id = p_contact_id
        AND (cm.expires_at IS NULL OR cm.expires_at > NOW())
    ),
    'availability', (
      SELECT COALESCE(jsonb_agg(row_to_json(ca) ORDER BY ca.day_of_week), '[]'::jsonb)
      FROM clapcheeks_contact_availability ca WHERE ca.contact_id = p_contact_id
    ),
    'response_rules', row_to_json(rr),
    'recent_sentiment', (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object('sentiment', ci2.sentiment, 'emotion', ci2.detected_emotion, 'sent_at', ci2.sent_at)
        ORDER BY ci2.sent_at DESC
      ), '[]'::jsonb)
      FROM (
        SELECT sentiment, detected_emotion, sent_at
        FROM clapcheeks_conversation_intelligence
        WHERE contact_id = p_contact_id AND sentiment IS NOT NULL
        ORDER BY sent_at DESC LIMIT 20
      ) ci2
    )
  ) INTO result
  FROM clapcheeks_contact_profiles cp
  LEFT JOIN clapcheeks_contact_style_profiles cs ON cs.contact_id = cp.id
  LEFT JOIN clapcheeks_contact_response_rules rr ON rr.contact_id = cp.id
  WHERE cp.id = p_contact_id;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Decay memory relevance scores (run periodically via cron)
CREATE OR REPLACE FUNCTION decay_memory_relevance()
RETURNS void AS $$
BEGIN
  -- Reduce relevance by 5% for memories not referenced in 14+ days
  UPDATE clapcheeks_contact_memory_bank
  SET relevance_score = GREATEST(0.1, relevance_score * 0.95)
  WHERE last_referenced IS NULL AND mentioned_at < NOW() - INTERVAL '14 days'
     OR last_referenced < NOW() - INTERVAL '14 days';

  -- Mark expired memories
  UPDATE clapcheeks_contact_memory_bank
  SET relevance_score = 0.0
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update contact profile completeness score
CREATE OR REPLACE FUNCTION update_contact_completeness(p_contact_id UUID)
RETURNS FLOAT AS $$
DECLARE
  score FLOAT := 0.0;
  has_style BOOLEAN;
  interest_count INT;
  memory_count INT;
  has_availability BOOLEAN;
  has_rules BOOLEAN;
  intel_count INT;
BEGIN
  -- Basic info: name + platform = always present = 0.05
  score := score + 0.05;

  -- Style profile exists and has data (0.15)
  SELECT EXISTS(
    SELECT 1 FROM clapcheeks_contact_style_profiles
    WHERE contact_id = p_contact_id AND messages_analyzed >= 5
  ) INTO has_style;
  IF has_style THEN score := score + 0.15; END IF;

  -- 3+ interests identified (0.15)
  SELECT COUNT(*) FROM clapcheeks_contact_interests
  WHERE contact_id = p_contact_id INTO interest_count;
  IF interest_count >= 3 THEN score := score + 0.15;
  ELSIF interest_count >= 1 THEN score := score + 0.07;
  END IF;

  -- 5+ memories stored (0.15)
  SELECT COUNT(*) FROM clapcheeks_contact_memory_bank
  WHERE contact_id = p_contact_id INTO memory_count;
  IF memory_count >= 5 THEN score := score + 0.15;
  ELSIF memory_count >= 2 THEN score := score + 0.07;
  END IF;

  -- Availability windows detected (0.10)
  SELECT EXISTS(
    SELECT 1 FROM clapcheeks_contact_availability
    WHERE contact_id = p_contact_id AND sample_size >= 3
  ) INTO has_availability;
  IF has_availability THEN score := score + 0.10; END IF;

  -- Response rules configured (0.05)
  SELECT EXISTS(
    SELECT 1 FROM clapcheeks_contact_response_rules
    WHERE contact_id = p_contact_id
  ) INTO has_rules;
  IF has_rules THEN score := score + 0.05; END IF;

  -- Conversation intelligence: 10+ analyzed messages (0.15)
  SELECT COUNT(*) FROM clapcheeks_conversation_intelligence
  WHERE contact_id = p_contact_id INTO intel_count;
  IF intel_count >= 10 THEN score := score + 0.15;
  ELSIF intel_count >= 5 THEN score := score + 0.07;
  END IF;

  -- Personality estimates present (0.10)
  IF EXISTS(
    SELECT 1 FROM clapcheeks_contact_profiles
    WHERE id = p_contact_id AND estimated_attachment_style IS NOT NULL
  ) THEN score := score + 0.05; END IF;
  IF EXISTS(
    SELECT 1 FROM clapcheeks_contact_profiles
    WHERE id = p_contact_id AND estimated_love_language IS NOT NULL
  ) THEN score := score + 0.05; END IF;

  -- Love language signals (0.10)
  IF EXISTS(
    SELECT 1 FROM clapcheeks_contact_style_profiles
    WHERE contact_id = p_contact_id
    AND (love_lang_words_of_affirmation > 0.3
      OR love_lang_quality_time > 0.3
      OR love_lang_acts_of_service > 0.3
      OR love_lang_gifts > 0.3
      OR love_lang_physical_touch > 0.3)
  ) THEN score := score + 0.10; END IF;

  -- Update the profile
  UPDATE clapcheeks_contact_profiles
  SET profile_completeness = score
  WHERE id = p_contact_id;

  RETURN score;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


COMMIT;
