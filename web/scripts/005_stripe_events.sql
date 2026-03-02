-- Stripe webhook idempotency tracking
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-cleanup: events older than 30 days
CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at ON stripe_events (processed_at);
