CREATE TABLE IF NOT EXISTS alpha_feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  type TEXT NOT NULL DEFAULT 'general' CHECK (type IN ('bug', 'feature', 'general', 'praise')),
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  message TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE alpha_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "submit_feedback" ON alpha_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "view_own_feedback" ON alpha_feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_alpha_feedback_user ON alpha_feedback(user_id);
CREATE INDEX idx_alpha_feedback_type ON alpha_feedback(type);
CREATE INDEX idx_alpha_feedback_created ON alpha_feedback(created_at DESC);
