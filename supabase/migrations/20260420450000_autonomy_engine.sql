-- Phase 44: Autonomy Engine (AI-8329)
-- Tables for auto-swipe, auto-respond, approval gates, preference learning

-- ============================================================
-- 1. User autonomy configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS clapcheeks_autonomy_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  autonomy_level TEXT NOT NULL DEFAULT 'supervised' CHECK (autonomy_level IN ('supervised', 'semi_auto', 'full_auto')),
  auto_swipe_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_respond_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_reengage_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_swipe_confidence_min REAL NOT NULL DEFAULT 75.0,
  auto_respond_confidence_min REAL NOT NULL DEFAULT 80.0,
  max_auto_swipes_per_hour INTEGER NOT NULL DEFAULT 40,
  max_auto_replies_per_hour INTEGER NOT NULL DEFAULT 10,
  stale_hours_threshold INTEGER NOT NULL DEFAULT 48,
  notify_on_auto_action BOOLEAN NOT NULL DEFAULT true,
  require_approval_for_first_message BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE clapcheeks_autonomy_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own autonomy config"
  ON clapcheeks_autonomy_config FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 2. Per-match autonomy overrides
-- ============================================================
CREATE TABLE IF NOT EXISTS clapcheeks_match_autonomy (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL,
  match_name TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  autonomy_level TEXT CHECK (autonomy_level IN ('supervised', 'semi_auto', 'full_auto')),
  auto_respond_override BOOLEAN,
  auto_reengage_override BOOLEAN,
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, match_id)
);

ALTER TABLE clapcheeks_match_autonomy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own match autonomy"
  ON clapcheeks_match_autonomy FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 3. Swipe decisions log (preference learning data)
-- ============================================================
CREATE TABLE IF NOT EXISTS clapcheeks_swipe_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  profile_id TEXT NOT NULL,
  profile_data JSONB NOT NULL DEFAULT '{}',
  decision TEXT NOT NULL CHECK (decision IN ('like', 'pass', 'super_like')),
  confidence REAL NOT NULL DEFAULT 0.0,
  was_auto BOOLEAN NOT NULL DEFAULT false,
  model_version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clapcheeks_swipe_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own swipe decisions"
  ON clapcheeks_swipe_decisions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_swipe_decisions_user ON clapcheeks_swipe_decisions(user_id, created_at DESC);
CREATE INDEX idx_swipe_decisions_platform ON clapcheeks_swipe_decisions(user_id, platform);

-- ============================================================
-- 4. Preference model snapshots
-- ============================================================
CREATE TABLE IF NOT EXISTS clapcheeks_preference_model (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  weights JSONB NOT NULL DEFAULT '{}',
  bias REAL NOT NULL DEFAULT 0.0,
  training_samples INTEGER NOT NULL DEFAULT 0,
  accuracy REAL NOT NULL DEFAULT 0.0,
  feature_order JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE clapcheeks_preference_model ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own preference model"
  ON clapcheeks_preference_model FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 5. Auto-action log (replies, re-engagements, swipes)
-- ============================================================
CREATE TABLE IF NOT EXISTS clapcheeks_auto_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('auto_respond', 'auto_reengage', 'auto_swipe', 'auto_unmatch')),
  match_id TEXT,
  match_name TEXT DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  proposed_text TEXT,
  proposed_data JSONB DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'executed' CHECK (status IN ('executed', 'queued', 'approved', 'rejected', 'expired')),
  ai_reasoning TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clapcheeks_auto_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own auto actions"
  ON clapcheeks_auto_actions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_auto_actions_user ON clapcheeks_auto_actions(user_id, created_at DESC);
CREATE INDEX idx_auto_actions_status ON clapcheeks_auto_actions(user_id, status);

-- ============================================================
-- 6. Approval queue (pending items awaiting user decision)
-- ============================================================
CREATE TABLE IF NOT EXISTS clapcheeks_approval_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  match_id TEXT,
  match_name TEXT DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  proposed_text TEXT,
  proposed_data JSONB DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.0,
  ai_reasoning TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

ALTER TABLE clapcheeks_approval_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own approval queue"
  ON clapcheeks_approval_queue FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_approval_queue_pending ON clapcheeks_approval_queue(user_id, status) WHERE status = 'pending';

-- ============================================================
-- Updated-at triggers
-- ============================================================
CREATE OR REPLACE FUNCTION update_autonomy_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_autonomy_config_updated
  BEFORE UPDATE ON clapcheeks_autonomy_config
  FOR EACH ROW EXECUTE FUNCTION update_autonomy_updated_at();

CREATE TRIGGER trg_match_autonomy_updated
  BEFORE UPDATE ON clapcheeks_match_autonomy
  FOR EACH ROW EXECUTE FUNCTION update_autonomy_updated_at();

CREATE TRIGGER trg_preference_model_updated
  BEFORE UPDATE ON clapcheeks_preference_model
  FOR EACH ROW EXECUTE FUNCTION update_autonomy_updated_at();

-- ============================================================
-- Seed default config on new user signup
-- ============================================================
CREATE OR REPLACE FUNCTION seed_autonomy_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO clapcheeks_autonomy_config (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Only create trigger if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_seed_autonomy_config'
  ) THEN
    CREATE TRIGGER trg_seed_autonomy_config
      AFTER INSERT ON auth.users
      FOR EACH ROW EXECUTE FUNCTION seed_autonomy_config();
  END IF;
END;
$$;
