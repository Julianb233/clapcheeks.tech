-- ==========================================================================
-- Phase 36: Beta Readiness — Dunning, Grace Periods, Monitoring
-- ==========================================================================

-- Add dunning columns to profiles (if not already present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'failed_payment_count') THEN
    ALTER TABLE profiles ADD COLUMN failed_payment_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'last_payment_failure_at') THEN
    ALTER TABLE profiles ADD COLUMN last_payment_failure_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'access_expires_at') THEN
    ALTER TABLE profiles ADD COLUMN access_expires_at timestamptz;
  END IF;
END $$;

-- Dunning events audit trail
CREATE TABLE IF NOT EXISTS dunning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  stripe_customer_id text,
  stripe_invoice_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'payment_failed', 'payment_recovered', 'grace_period_expired',
    'manual_retry', 'subscription_canceled'
  )),
  attempt_number integer DEFAULT 1,
  grace_period_end timestamptz,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Index for querying dunning history by user
CREATE INDEX IF NOT EXISTS idx_dunning_events_user
  ON dunning_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dunning_events_customer
  ON dunning_events(stripe_customer_id, created_at DESC);

-- Index for grace period expiry cron
CREATE INDEX IF NOT EXISTS idx_profiles_grace_expiry
  ON profiles(subscription_status, access_expires_at)
  WHERE subscription_status = 'past_due' AND access_expires_at IS NOT NULL;

-- API health check log
CREATE TABLE IF NOT EXISTS api_health_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL,
  status_code integer,
  response_time_ms integer,
  is_healthy boolean DEFAULT true,
  error_message text,
  checked_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_health_checks_endpoint
  ON api_health_checks(endpoint, checked_at DESC);

-- Security audit log
CREATE TABLE IF NOT EXISTS security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  source_ip text,
  user_id uuid,
  endpoint text,
  details jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_severity
  ON security_audit_log(severity, created_at DESC);

-- RLS policies for dunning_events (admin only)
ALTER TABLE dunning_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage dunning events"
  ON dunning_events
  FOR ALL
  USING (auth.role() = 'service_role');

-- RLS for security audit log (admin only)
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage security log"
  ON security_audit_log
  FOR ALL
  USING (auth.role() = 'service_role');

-- RLS for health checks (admin only)
ALTER TABLE api_health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Service role can manage health checks"
  ON api_health_checks
  FOR ALL
  USING (auth.role() = 'service_role');
