-- Phase 19: Weekly Reports
-- Tables for report storage and user preferences

CREATE TABLE IF NOT EXISTS clapcheeks_weekly_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  metrics_snapshot JSONB NOT NULL DEFAULT '{}',
  pdf_url TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reports_user
  ON clapcheeks_weekly_reports(user_id, week_start DESC);

ALTER TABLE clapcheeks_weekly_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reports"
  ON clapcheeks_weekly_reports FOR SELECT
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS clapcheeks_report_preferences (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  email_enabled BOOLEAN DEFAULT TRUE,
  send_day TEXT DEFAULT 'sunday' CHECK (send_day IN ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  send_hour INTEGER DEFAULT 8 CHECK (send_hour >= 0 AND send_hour <= 23),
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

ALTER TABLE clapcheeks_report_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences"
  ON clapcheeks_report_preferences FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own preferences"
  ON clapcheeks_report_preferences FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own preferences"
  ON clapcheeks_report_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);
