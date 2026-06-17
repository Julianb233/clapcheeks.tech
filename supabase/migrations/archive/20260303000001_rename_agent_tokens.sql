-- Migration: Ensure clapcheeks_agent_tokens table exists (DB-01)
-- The outward_agent_tokens table was already renamed in migration 004,
-- but we verify and ensure RLS policies reference the correct name.

-- Safety: if somehow outward_agent_tokens still exists (migration 004 not applied), rename it
ALTER TABLE IF EXISTS public.outward_agent_tokens RENAME TO clapcheeks_agent_tokens;

-- Ensure RLS is enabled
ALTER TABLE IF EXISTS public.clapcheeks_agent_tokens ENABLE ROW LEVEL SECURITY;

-- Recreate policies with clear names (idempotent via IF NOT EXISTS pattern)
DO $$ BEGIN
  -- SELECT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_tokens'
    AND policyname = 'agent_tokens_select_own'
  ) THEN
    CREATE POLICY "agent_tokens_select_own"
      ON public.clapcheeks_agent_tokens FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  -- INSERT policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_tokens'
    AND policyname = 'agent_tokens_insert_own'
  ) THEN
    CREATE POLICY "agent_tokens_insert_own"
      ON public.clapcheeks_agent_tokens FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;

  -- UPDATE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_tokens'
    AND policyname = 'agent_tokens_update_own'
  ) THEN
    CREATE POLICY "agent_tokens_update_own"
      ON public.clapcheeks_agent_tokens FOR UPDATE
      USING (auth.uid() = user_id);
  END IF;

  -- DELETE policy
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'clapcheeks_agent_tokens'
    AND policyname = 'agent_tokens_delete_own'
  ) THEN
    CREATE POLICY "agent_tokens_delete_own"
      ON public.clapcheeks_agent_tokens FOR DELETE
      USING (auth.uid() = user_id);
  END IF;
END $$;
