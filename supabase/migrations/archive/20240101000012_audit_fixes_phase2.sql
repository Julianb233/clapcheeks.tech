-- Migration 012: Database Audit Fixes Phase 2
-- Addresses issues found during cross-referencing app code with schema

-- ============================================================
-- 1. Add missing increment_referral_credits RPC function
--    Called by web/app/api/referral/convert/route.ts
-- ============================================================
CREATE OR REPLACE FUNCTION increment_referral_credits(
  p_user_id UUID
) RETURNS void AS $$
BEGIN
  UPDATE profiles
  SET referral_credits = COALESCE(referral_credits, 0) + 1,
      free_months_earned = COALESCE(free_months_earned, 0) + 1
  WHERE id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Ensure referral columns exist on profiles
--    (both migration 006 and script 010 add overlapping columns)
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_credits INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS free_months_earned INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ref_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referral_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;

-- ============================================================
-- 3. Ensure clapcheeks_referrals has both column names
--    Migration 006 uses referred_id, script 010 uses referee_id
--    App code references BOTH: convert/route.ts uses referee_id,
--    referrals/page.tsx and api/routes/referral.js use referred_id
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_name = 'clapcheeks_referrals' AND table_schema = 'public')
  THEN
    -- Ensure referred_id column exists (from migration 006)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'referred_id')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN referred_id UUID REFERENCES auth.users(id) ON DELETE SET NULL';
    END IF;

    -- Ensure referee_id column exists (from script 010, used by convert/route.ts)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'referee_id')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN referee_id UUID REFERENCES auth.users(id) ON DELETE SET NULL';
    END IF;

    -- Ensure referral_code column exists (from migration 006)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'referral_code')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN referral_code TEXT UNIQUE';
    END IF;

    -- Ensure ref_code column exists (from script 010)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'ref_code')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN ref_code TEXT UNIQUE';
    END IF;

    -- Ensure credited_at column exists (used by convert/route.ts)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'credited_at')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN credited_at TIMESTAMPTZ';
    END IF;

    -- Ensure converted_at column exists (from migration 006)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'converted_at')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN converted_at TIMESTAMPTZ';
    END IF;

    -- Ensure rewarded_at column exists (from migration 006)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_name = 'clapcheeks_referrals' AND column_name = 'rewarded_at')
    THEN
      EXECUTE 'ALTER TABLE public.clapcheeks_referrals ADD COLUMN rewarded_at TIMESTAMPTZ';
    END IF;
  END IF;
END $$;

-- ============================================================
-- 4. Ensure all profile columns queried by app code exist
-- ============================================================
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'base';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profile_completed BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS selected_mode TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS selected_platforms TEXT[];
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rizz_score INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_matches INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS dates_booked INTEGER DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS total_spend NUMERIC(10,2) DEFAULT 0;

-- ============================================================
-- 5. Create tables from web/scripts/ that may not exist yet
--    These are referenced by app code but only defined in scripts
-- ============================================================

-- clapcheeks_conversation_stats (from 005_analytics_extended.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_conversation_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  platform TEXT NOT NULL,
  messages_sent INT DEFAULT 0,
  messages_received INT DEFAULT 0,
  conversations_started INT DEFAULT 0,
  conversations_replied INT DEFAULT 0,
  conversations_ghosted INT DEFAULT 0,
  avg_response_time_mins INT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, date, platform)
);
CREATE INDEX IF NOT EXISTS idx_conversation_stats_user_date
  ON clapcheeks_conversation_stats(user_id, date);
ALTER TABLE clapcheeks_conversation_stats ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_conversation_stats' AND policyname = 'conversation_stats_select_own') THEN
    CREATE POLICY "conversation_stats_select_own" ON public.clapcheeks_conversation_stats FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "conversation_stats_insert_own" ON public.clapcheeks_conversation_stats FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "conversation_stats_update_own" ON public.clapcheeks_conversation_stats FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_spending (from 005_analytics_extended.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_spending (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  date DATE NOT NULL,
  platform TEXT,
  category TEXT NOT NULL CHECK (category IN ('drinks', 'dinner', 'activities', 'subscriptions', 'boost', 'gift', 'other')),
  amount NUMERIC(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_spending_user_date ON clapcheeks_spending(user_id, date);
ALTER TABLE clapcheeks_spending ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_spending' AND policyname = 'spending_select_own') THEN
    CREATE POLICY "spending_select_own" ON public.clapcheeks_spending FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "spending_insert_own" ON public.clapcheeks_spending FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "spending_update_own" ON public.clapcheeks_spending FOR UPDATE USING (auth.uid() = user_id);
    CREATE POLICY "spending_delete_own" ON public.clapcheeks_spending FOR DELETE USING (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_coaching_sessions (from 006_coaching.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_coaching_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  generated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  week_start DATE NOT NULL,
  tips JSONB NOT NULL,
  stats_snapshot JSONB,
  feedback_score INT,
  model_used TEXT DEFAULT 'claude-sonnet-4-6',
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, week_start)
);
ALTER TABLE clapcheeks_coaching_sessions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_coaching_sessions' AND policyname = 'Users can view own coaching sessions') THEN
    CREATE POLICY "Users can view own coaching sessions" ON clapcheeks_coaching_sessions FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own coaching sessions" ON clapcheeks_coaching_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_tip_feedback (from 006_coaching.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_tip_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  coaching_session_id UUID REFERENCES clapcheeks_coaching_sessions(id) ON DELETE CASCADE NOT NULL,
  tip_index INT NOT NULL,
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, coaching_session_id, tip_index)
);
ALTER TABLE clapcheeks_tip_feedback ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_tip_feedback' AND policyname = 'Users can view own tip feedback') THEN
    CREATE POLICY "Users can view own tip feedback" ON clapcheeks_tip_feedback FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own tip feedback" ON clapcheeks_tip_feedback FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "Users can update own tip feedback" ON clapcheeks_tip_feedback FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_voice_profiles (from 007_conversation_ai.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_voice_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  style_summary TEXT,
  sample_phrases JSONB DEFAULT '[]'::JSONB,
  tone TEXT DEFAULT 'casual' CHECK (tone IN ('casual', 'formal', 'playful')),
  profile_data JSONB DEFAULT '{}'::JSONB,
  messages_analyzed INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE clapcheeks_voice_profiles ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_voice_profiles' AND policyname = 'Users can view own voice profile') THEN
    CREATE POLICY "Users can view own voice profile" ON clapcheeks_voice_profiles FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own voice profile" ON clapcheeks_voice_profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
    CREATE POLICY "Users can update own voice profile" ON clapcheeks_voice_profiles FOR UPDATE USING (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_reply_suggestions (from 007_conversation_ai.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_reply_suggestions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  conversation_context TEXT NOT NULL,
  suggestions JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE clapcheeks_reply_suggestions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_reply_suggestions' AND policyname = 'Users can view own reply suggestions') THEN
    CREATE POLICY "Users can view own reply suggestions" ON clapcheeks_reply_suggestions FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own reply suggestions" ON clapcheeks_reply_suggestions FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_usage_daily (from 008_usage_limits.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  swipes_used INTEGER DEFAULT 0,
  coaching_calls_used INTEGER DEFAULT 0,
  ai_replies_used INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_usage_daily_lookup ON clapcheeks_usage_daily(user_id, date);
ALTER TABLE clapcheeks_usage_daily ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_usage_daily' AND policyname = 'Users can view own usage') THEN
    CREATE POLICY "Users can view own usage" ON clapcheeks_usage_daily FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_weekly_reports (from 009_reports.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_weekly_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}',
  pdf_url TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_user ON clapcheeks_weekly_reports(user_id, week_start DESC);
ALTER TABLE clapcheeks_weekly_reports ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_weekly_reports' AND policyname = 'Users can view own reports') THEN
    CREATE POLICY "Users can view own reports" ON clapcheeks_weekly_reports FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_report_preferences (from 009_reports.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_report_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email_enabled BOOLEAN DEFAULT TRUE,
  send_day TEXT DEFAULT 'sunday' CHECK (send_day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  send_hour INTEGER DEFAULT 8 CHECK (send_hour >= 0 AND send_hour <= 23),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);
ALTER TABLE clapcheeks_report_preferences ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_report_preferences' AND policyname = 'Users can view own preferences') THEN
    CREATE POLICY "Users can view own preferences" ON clapcheeks_report_preferences FOR SELECT USING (auth.uid() = user_id);
    CREATE POLICY "Users can update own preferences" ON clapcheeks_report_preferences FOR UPDATE USING (auth.uid() = user_id);
    CREATE POLICY "Users can insert own preferences" ON clapcheeks_report_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- clapcheeks_affiliate_applications (from 011_affiliates.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_affiliate_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  platform TEXT NOT NULL,
  audience_size TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- clapcheeks_queued_replies (from 012_queued_replies.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_queued_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_name TEXT,
  platform TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE clapcheeks_queued_replies ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_queued_replies' AND policyname = 'Users can view their own queued replies') THEN
    CREATE POLICY "Users can view their own queued replies" ON clapcheeks_queued_replies FOR SELECT USING (user_id = auth.uid());
    CREATE POLICY "Users can insert their own queued replies" ON clapcheeks_queued_replies FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_clapcheeks_queued_replies_user_id ON public.clapcheeks_queued_replies(user_id);

-- clapcheeks_device_codes (from 013_device_codes.sql)
CREATE TABLE IF NOT EXISTS public.clapcheeks_device_codes (
  code TEXT PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_device_codes_expires ON clapcheeks_device_codes(expires_at);

-- stripe_events (from 005_stripe_events.sql)
CREATE TABLE IF NOT EXISTS public.stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at ON stripe_events(processed_at);
