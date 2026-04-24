-- Migration: Dashboard schema sync — align live clapcheeks_analytics_daily with
-- what the app (dashboard, coaching, reports, api sync) expects, and create the
-- missing clapcheeks_subscriptions table that dashboard/dogfood/reports query.
--
-- Context (discovered 2026-04-24 in dashboard audit):
--  * Live clapcheeks_analytics_daily is the outward_analytics_daily schema (platform, messages_sent)
--    NOT the analytics_daily schema from migration 009 (app, conversations_started, money_spent).
--    Migration 20260303000002 was intended to consolidate them but failed silently because
--    live only had one table, not two — the rename was a no-op.
--  * clapcheeks_subscriptions never got created on prod. Dashboard queries it and crashes silently.
--
-- Approach:
--  * Additive only. Keep platform (agent writes it). Add the extra daily columns so the
--    /analytics/sync endpoint can write them without error.
--  * Create clapcheeks_subscriptions from migration 009 spec so dashboard/dogfood/reports
--    queries succeed.
--  * No renames, no drops — safe on prod.

-- 1. Add missing columns to clapcheeks_analytics_daily (idempotent)
ALTER TABLE IF EXISTS public.clapcheeks_analytics_daily
  ADD COLUMN IF NOT EXISTS conversations_started integer NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.clapcheeks_analytics_daily
  ADD COLUMN IF NOT EXISTS money_spent numeric(10,2) NOT NULL DEFAULT 0;

-- 2. Create clapcheeks_subscriptions if it doesn't exist
CREATE TABLE IF NOT EXISTS public.clapcheeks_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  stripe_subscription_id text UNIQUE,
  plan text NOT NULL CHECK (plan IN ('starter', 'pro', 'elite', 'base', 'free')),
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_subscriptions_user_id
  ON public.clapcheeks_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_clapcheeks_subscriptions_stripe_id
  ON public.clapcheeks_subscriptions(stripe_subscription_id);

-- 3. RLS policies on clapcheeks_subscriptions
ALTER TABLE public.clapcheeks_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_subscriptions'
    AND policyname = 'clapcheeks_subscriptions_select_own'
  ) THEN
    CREATE POLICY "clapcheeks_subscriptions_select_own"
      ON public.clapcheeks_subscriptions FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_subscriptions'
    AND policyname = 'clapcheeks_subscriptions_insert_service'
  ) THEN
    CREATE POLICY "clapcheeks_subscriptions_insert_service"
      ON public.clapcheeks_subscriptions FOR INSERT
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_subscriptions'
    AND policyname = 'clapcheeks_subscriptions_update_service'
  ) THEN
    CREATE POLICY "clapcheeks_subscriptions_update_service"
      ON public.clapcheeks_subscriptions FOR UPDATE
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 4. Backfill clapcheeks_subscriptions from profiles where we already know the state
-- (idempotent — only inserts rows that don't already exist)
INSERT INTO public.clapcheeks_subscriptions (user_id, plan, status, stripe_subscription_id)
SELECT
  p.id,
  COALESCE(p.subscription_tier, p.plan, 'free'),
  COALESCE(p.subscription_status, 'active'),
  p.stripe_subscription_id
FROM public.profiles p
WHERE p.subscription_status = 'active'
  AND p.id NOT IN (SELECT user_id FROM public.clapcheeks_subscriptions WHERE user_id IS NOT NULL)
ON CONFLICT DO NOTHING;
