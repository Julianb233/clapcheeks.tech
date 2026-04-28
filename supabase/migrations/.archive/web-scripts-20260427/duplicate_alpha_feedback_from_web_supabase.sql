CREATE TABLE IF NOT EXISTS alpha_feedback (id UUID DEFAULT gen_random_uuid() PRIMARY KEY, user_id UUID NOT NULL, user_email TEXT, type TEXT NOT NULL DEFAULT 'general', rating INTEGER, message TEXT NOT NULL, metadata JSONB DEFAULT '{}'::jsonb, resolved BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT NOW());
ALTER TABLE alpha_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "submit_feedback" ON alpha_feedback FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "view_own_feedback" ON alpha_feedback FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_alpha_feedback_user ON alpha_feedback(user_id);
