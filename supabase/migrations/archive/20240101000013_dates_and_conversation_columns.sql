-- Migration 013: Add clapcheeks_dates table and missing clapcheeks_conversations columns
-- Required by web/app/events/page.tsx and web/app/groups/page.tsx

-- ============================================================
-- 1. clapcheeks_dates — upcoming dates synced from local agent
-- ============================================================
CREATE TABLE IF NOT EXISTS public.clapcheeks_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  match_name TEXT,
  platform TEXT,
  location TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed', 'pending')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_dates_user_id
  ON public.clapcheeks_dates(user_id);
CREATE INDEX IF NOT EXISTS idx_clapcheeks_dates_scheduled
  ON public.clapcheeks_dates(user_id, scheduled_at);

ALTER TABLE public.clapcheeks_dates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dates"
  ON public.clapcheeks_dates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own dates"
  ON public.clapcheeks_dates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own dates"
  ON public.clapcheeks_dates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own dates"
  ON public.clapcheeks_dates FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================
-- 2. Add missing columns to clapcheeks_conversations
--    groups/page.tsx reads match_name and last_message
-- ============================================================
ALTER TABLE public.clapcheeks_conversations
  ADD COLUMN IF NOT EXISTS match_name TEXT;

ALTER TABLE public.clapcheeks_conversations
  ADD COLUMN IF NOT EXISTS last_message TEXT;
