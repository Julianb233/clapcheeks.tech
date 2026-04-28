-- Per-contact memo storage for the operator-trust dashboard.
--
-- The local agent writes per-contact memos to ~/.clapcheeks/memos/+E164.md on
-- the operator's Mac. sync.py mirrors the markdown content into this table so
-- the dashboard can render + edit them without depending on the operator's
-- local filesystem.
--
-- contact_handle is normalised to E.164 phone format (e.g. "+15551234567")
-- when the contact is known. For platform matches that haven't exchanged a
-- phone yet, the platform external_id is used (e.g. "tinder:abc123").
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.clapcheeks_memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_handle text NOT NULL,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contact_handle)
);

ALTER TABLE public.clapcheeks_memos ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'clapcheeks_memos'
       AND policyname = 'users own memos select'
  ) THEN
    CREATE POLICY "users own memos select" ON public.clapcheeks_memos
      FOR SELECT USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'clapcheeks_memos'
       AND policyname = 'users own memos write'
  ) THEN
    CREATE POLICY "users own memos write" ON public.clapcheeks_memos
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clapcheeks_memos_user_handle
  ON public.clapcheeks_memos(user_id, contact_handle);
