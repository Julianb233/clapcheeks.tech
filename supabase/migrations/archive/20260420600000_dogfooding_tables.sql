-- ═══════════════════════════════════════════════════════════════════
-- Phase 33: Founder Dogfooding — tables for health tracking,
-- friction logging, and weekly reports with real data.
-- ═══════════════════════════════════════════════════════════════════

-- ─── Friction Points ────────────────────────────────────────────────
-- Logs UX issues, bugs, and pain points encountered during dogfooding.
-- Synced from the local agent's friction_tracker.py.

CREATE TABLE IF NOT EXISTS clapcheeks_friction_points (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    severity    TEXT NOT NULL DEFAULT 'minor'
                CHECK (severity IN ('blocker', 'major', 'minor', 'cosmetic')),
    category    TEXT NOT NULL DEFAULT 'other'
                CHECK (category IN (
                    'swiping', 'conversation', 'agent_setup', 'auth',
                    'stripe', 'dashboard', 'reports', 'performance',
                    'crash', 'ux', 'other'
                )),
    platform    TEXT,
    auto_detected BOOLEAN DEFAULT FALSE,
    context     JSONB DEFAULT '{}',
    resolved    BOOLEAN DEFAULT FALSE,
    resolution  TEXT,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_friction_user ON clapcheeks_friction_points(user_id);
CREATE INDEX idx_friction_severity ON clapcheeks_friction_points(severity);
CREATE INDEX idx_friction_unresolved ON clapcheeks_friction_points(user_id)
    WHERE NOT resolved;

ALTER TABLE clapcheeks_friction_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own friction points"
    ON clapcheeks_friction_points FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own friction points"
    ON clapcheeks_friction_points FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own friction points"
    ON clapcheeks_friction_points FOR UPDATE
    USING (auth.uid() = user_id);

-- Allow service role full access for agent sync
CREATE POLICY "Service role full access friction"
    ON clapcheeks_friction_points FOR ALL
    USING (auth.role() = 'service_role');


-- ─── Dogfood Health Log ─────────────────────────────────────────────
-- Daily health snapshots: uptime, crashes, streak. One row per user
-- per day. The dashboard reads the most recent entry for display.

CREATE TABLE IF NOT EXISTS clapcheeks_dogfood_health (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    consecutive_streak INT DEFAULT 0,
    days_active     INT DEFAULT 0,
    total_crashes   INT DEFAULT 0,
    weekly_summary  JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, date)
);

CREATE INDEX idx_health_user_date ON clapcheeks_dogfood_health(user_id, date DESC);

ALTER TABLE clapcheeks_dogfood_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own health data"
    ON clapcheeks_dogfood_health FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own health data"
    ON clapcheeks_dogfood_health FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own health data"
    ON clapcheeks_dogfood_health FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Service role full access health"
    ON clapcheeks_dogfood_health FOR ALL
    USING (auth.role() = 'service_role');


-- ─── Report preferences (add report_type column) ───────────────────
-- Extend existing weekly reports table if it doesn't have dogfood fields.

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'clapcheeks_weekly_reports'
        AND column_name = 'report_type'
    ) THEN
        ALTER TABLE clapcheeks_weekly_reports
            ADD COLUMN report_type TEXT DEFAULT 'standard';
    END IF;
END $$;
