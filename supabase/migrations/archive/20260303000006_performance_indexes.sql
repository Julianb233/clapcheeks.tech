-- Migration: Performance indexes for conversation_stats and spending (DB-03)
-- Dashboard queries scan these tables on every load. Add indexes to prevent
-- full table scans.

-- Indexes for clapcheeks_conversation_stats
CREATE INDEX IF NOT EXISTS idx_conversation_stats_user_id
  ON public.clapcheeks_conversation_stats(user_id);

CREATE INDEX IF NOT EXISTS idx_conversation_stats_date
  ON public.clapcheeks_conversation_stats(date DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_stats_user_date
  ON public.clapcheeks_conversation_stats(user_id, date DESC);

-- Indexes for clapcheeks_spending
CREATE INDEX IF NOT EXISTS idx_spending_user_id
  ON public.clapcheeks_spending(user_id);

CREATE INDEX IF NOT EXISTS idx_spending_date
  ON public.clapcheeks_spending(date DESC);

-- Note: idx_spending_user_date already created in migration 012,
-- but recreate with DESC for dashboard query pattern
CREATE INDEX IF NOT EXISTS idx_spending_user_date_desc
  ON public.clapcheeks_spending(user_id, date DESC);
