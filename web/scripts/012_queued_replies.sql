CREATE TABLE IF NOT EXISTS clapcheeks_queued_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users NOT NULL,
  match_name TEXT,
  platform TEXT,
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clapcheeks_queued_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own queued replies"
  ON clapcheeks_queued_replies FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert their own queued replies"
  ON clapcheeks_queued_replies FOR INSERT
  WITH CHECK (user_id = auth.uid());
