-- Phase 22: Usage Limits
-- Daily usage tracking for per-plan limit enforcement

CREATE TABLE IF NOT EXISTS clapcheeks_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  swipes_used INTEGER DEFAULT 0,
  coaching_calls_used INTEGER DEFAULT 0,
  ai_replies_used INTEGER DEFAULT 0,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_daily_lookup
  ON clapcheeks_usage_daily(user_id, date);

ALTER TABLE clapcheeks_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON clapcheeks_usage_daily FOR SELECT
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION increment_usage(
  p_user_id UUID,
  p_field TEXT,
  p_amount INTEGER DEFAULT 1
) RETURNS TABLE(swipes_used INT, coaching_calls_used INT, ai_replies_used INT) AS $$
BEGIN
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

-- Cleanup old usage records (keep 30 days for analytics)
-- Run via pg_cron or Supabase scheduled function:
-- SELECT cron.schedule('cleanup-usage-daily', '0 1 * * *',
--   $$DELETE FROM clapcheeks_usage_daily WHERE date < CURRENT_DATE - INTERVAL '30 days'$$
-- );
