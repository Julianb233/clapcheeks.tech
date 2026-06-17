-- Migration 011: Database Audit Fixes
-- Fixes issues found during comprehensive schema audit

-- ============================================================
-- 1. Add missing ON DELETE CASCADE to foreign keys
-- ============================================================

-- clapcheeks_referrals.referrer_id
ALTER TABLE public.clapcheeks_referrals
  DROP CONSTRAINT IF EXISTS clapcheeks_referrals_referrer_id_fkey;
ALTER TABLE public.clapcheeks_referrals
  ADD CONSTRAINT clapcheeks_referrals_referrer_id_fkey
  FOREIGN KEY (referrer_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- clapcheeks_referrals.referred_id
ALTER TABLE public.clapcheeks_referrals
  DROP CONSTRAINT IF EXISTS clapcheeks_referrals_referred_id_fkey;
ALTER TABLE public.clapcheeks_referrals
  ADD CONSTRAINT clapcheeks_referrals_referred_id_fkey
  FOREIGN KEY (referred_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- clapcheeks_opener_log.user_id
ALTER TABLE public.clapcheeks_opener_log
  DROP CONSTRAINT IF EXISTS clapcheeks_opener_log_user_id_fkey;
ALTER TABLE public.clapcheeks_opener_log
  ADD CONSTRAINT clapcheeks_opener_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- clapcheeks_conversation_events.user_id
ALTER TABLE public.clapcheeks_conversation_events
  DROP CONSTRAINT IF EXISTS clapcheeks_conversation_events_user_id_fkey;
ALTER TABLE public.clapcheeks_conversation_events
  ADD CONSTRAINT clapcheeks_conversation_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- clapcheeks_agent_events.user_id
ALTER TABLE public.clapcheeks_agent_events
  DROP CONSTRAINT IF EXISTS clapcheeks_agent_events_user_id_fkey;
ALTER TABLE public.clapcheeks_agent_events
  ADD CONSTRAINT clapcheeks_agent_events_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- clapcheeks_push_tokens.user_id
ALTER TABLE public.clapcheeks_push_tokens
  DROP CONSTRAINT IF EXISTS clapcheeks_push_tokens_user_id_fkey;
ALTER TABLE public.clapcheeks_push_tokens
  ADD CONSTRAINT clapcheeks_push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- clapcheeks_photo_scores.user_id
ALTER TABLE public.clapcheeks_photo_scores
  DROP CONSTRAINT IF EXISTS clapcheeks_photo_scores_user_id_fkey;
ALTER TABLE public.clapcheeks_photo_scores
  ADD CONSTRAINT clapcheeks_photo_scores_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- clapcheeks_queued_replies.user_id (if table exists from scripts)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clapcheeks_queued_replies' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE public.clapcheeks_queued_replies DROP CONSTRAINT IF EXISTS clapcheeks_queued_replies_user_id_fkey';
    EXECUTE 'ALTER TABLE public.clapcheeks_queued_replies ADD CONSTRAINT clapcheeks_queued_replies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  END IF;
END $$;

-- clapcheeks_device_codes.user_id (if table exists from scripts)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clapcheeks_device_codes' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE public.clapcheeks_device_codes DROP CONSTRAINT IF EXISTS clapcheeks_device_codes_user_id_fkey';
    EXECUTE 'ALTER TABLE public.clapcheeks_device_codes ADD CONSTRAINT clapcheeks_device_codes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE';
  END IF;
END $$;

-- ============================================================
-- 2. Add missing indexes on foreign keys and common query columns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_clapcheeks_sessions_user_id
  ON public.clapcheeks_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_user_id
  ON public.clapcheeks_matches(user_id);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_conversations_user_id
  ON public.clapcheeks_conversations(user_id);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_analytics_daily_user_id
  ON public.clapcheeks_analytics_daily(user_id);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_referrals_referrer_id
  ON public.clapcheeks_referrals(referrer_id);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_push_tokens_user_id
  ON public.clapcheeks_push_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_photo_scores_user_id
  ON public.clapcheeks_photo_scores(user_id);

CREATE INDEX IF NOT EXISTS idx_profiles_stripe_customer_id
  ON public.profiles(stripe_customer_id);

-- Indexes on timestamp columns commonly used in queries
CREATE INDEX IF NOT EXISTS idx_clapcheeks_sessions_started_at
  ON public.clapcheeks_sessions(started_at DESC);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_created_at
  ON public.clapcheeks_matches(created_at DESC);

-- ============================================================
-- 3. Add missing RLS policies
-- ============================================================

-- stripe_events: admin-only, no user access needed (service role writes)
-- Enable RLS but only allow service_role (no user policies needed)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'stripe_events' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE public.stripe_events ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- clapcheeks_affiliate_applications: public insert (no auth required for apply), admin select
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clapcheeks_affiliate_applications' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE public.clapcheeks_affiliate_applications ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_affiliate_applications' AND policyname = 'Anyone can submit affiliate application') THEN
      EXECUTE 'CREATE POLICY "Anyone can submit affiliate application" ON public.clapcheeks_affiliate_applications FOR INSERT WITH CHECK (true)';
    END IF;
  END IF;
END $$;

-- clapcheeks_device_codes: users can view/use their own codes
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clapcheeks_device_codes' AND table_schema = 'public') THEN
    EXECUTE 'ALTER TABLE public.clapcheeks_device_codes ENABLE ROW LEVEL SECURITY';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_device_codes' AND policyname = 'Users can view own device codes') THEN
      EXECUTE 'CREATE POLICY "Users can view own device codes" ON public.clapcheeks_device_codes FOR SELECT USING (auth.uid() = user_id)';
      EXECUTE 'CREATE POLICY "Users can insert own device codes" ON public.clapcheeks_device_codes FOR INSERT WITH CHECK (auth.uid() = user_id)';
      EXECUTE 'CREATE POLICY "Users can update own device codes" ON public.clapcheeks_device_codes FOR UPDATE USING (auth.uid() = user_id)';
    END IF;
  END IF;
END $$;

-- clapcheeks_agent_events: add missing INSERT policy
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'clapcheeks_agent_events' AND policyname = 'Users can insert own events') THEN
    CREATE POLICY "Users can insert own events"
      ON public.clapcheeks_agent_events FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- ============================================================
-- 4. Fix increment_usage function — validate p_field to prevent SQL injection
-- ============================================================
CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_field TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS TABLE(swipes_used INT, coaching_calls_used INT, ai_replies_used INT) AS $$
BEGIN
  -- Validate field name to prevent SQL injection
  IF p_field NOT IN ('swipes_used', 'coaching_calls_used', 'ai_replies_used') THEN
    RAISE EXCEPTION 'Invalid field name: %', p_field;
  END IF;

  INSERT INTO clapcheeks_usage_daily (user_id, date)
  VALUES (p_user_id, CURRENT_DATE)
  ON CONFLICT (user_id, date) DO NOTHING;

  EXECUTE format(
    'UPDATE clapcheeks_usage_daily SET %I = %I + $1 WHERE user_id = $2 AND date = CURRENT_DATE',
    p_field, p_field
  ) USING p_amount, p_user_id;

  RETURN QUERY SELECT d.swipes_used, d.coaching_calls_used, d.ai_replies_used
  FROM clapcheeks_usage_daily d
  WHERE d.user_id = p_user_id AND d.date = CURRENT_DATE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. Ensure subscription_tier column exists on profiles
--    (app code queries it via plan-server.ts and admin pages)
-- ============================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free';

-- ============================================================
-- 6. Add missing queued_replies index
-- ============================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'clapcheeks_queued_replies' AND table_schema = 'public') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_clapcheeks_queued_replies_user_id ON public.clapcheeks_queued_replies(user_id)';
  END IF;
END $$;
