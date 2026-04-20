-- Migration: Clapcheeks leads pipeline + user settings
-- Gives the web dashboard a live view of every match, where it sits in the
-- funnel, and when the next follow-up will fire. Paired with the agent's
-- conversation.state + drip engine.

-- ---------------------------------------------------------------------------
-- clapcheeks_leads — one row per tracked match
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clapcheeks_leads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    platform        TEXT NOT NULL,          -- tinder | hinge | bumble | ...
    match_id        TEXT NOT NULL,          -- platform-native id
    name            TEXT,                   -- match first name
    age             INTEGER,

    stage           TEXT NOT NULL DEFAULT 'matched',
    stage_entered_at TIMESTAMPTZ DEFAULT now(),

    last_message_at TIMESTAMPTZ,
    last_message_by TEXT,                   -- 'us' | 'them'
    message_count   INTEGER DEFAULT 0,

    date_asked_at   TIMESTAMPTZ,
    date_slot_iso   TIMESTAMPTZ,            -- proposed slot if stage=date_proposed
    date_booked_at  TIMESTAMPTZ,            -- set when calendar event created
    calendar_event_id TEXT,
    calendar_event_link TEXT,

    -- Match intel snapshot (redacted if CLAPCHEEKS_SYNC_LEADS=metadata_only)
    zodiac          TEXT,
    interests       JSONB DEFAULT '[]'::jsonb,
    prompt_themes   JSONB DEFAULT '[]'::jsonb,

    -- User-editable
    tag             TEXT,                   -- "promising", "maybe", etc.
    notes           TEXT,
    outcome         TEXT,                   -- great | ok | ghosted | bailed
    approval_mode   TEXT,                   -- auto | approve_dates | manual

    drip_fired      JSONB DEFAULT '{}'::jsonb,  -- {rule_id: unix_ts}

    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),

    UNIQUE (user_id, platform, match_id)
);

CREATE INDEX IF NOT EXISTS idx_clapcheeks_leads_user
    ON public.clapcheeks_leads (user_id);
CREATE INDEX IF NOT EXISTS idx_clapcheeks_leads_stage
    ON public.clapcheeks_leads (user_id, stage);
CREATE INDEX IF NOT EXISTS idx_clapcheeks_leads_date_booked
    ON public.clapcheeks_leads (user_id, date_booked_at)
    WHERE date_booked_at IS NOT NULL;

ALTER TABLE public.clapcheeks_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leads_owner_select" ON public.clapcheeks_leads;
CREATE POLICY "leads_owner_select" ON public.clapcheeks_leads
    FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_owner_insert" ON public.clapcheeks_leads;
CREATE POLICY "leads_owner_insert" ON public.clapcheeks_leads
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_owner_update" ON public.clapcheeks_leads;
CREATE POLICY "leads_owner_update" ON public.clapcheeks_leads
    FOR UPDATE USING (user_id = auth.uid());

DROP POLICY IF EXISTS "leads_owner_delete" ON public.clapcheeks_leads;
CREATE POLICY "leads_owner_delete" ON public.clapcheeks_leads
    FOR DELETE USING (user_id = auth.uid());

-- Service role (agent sync) writes freely — stays inside the key.
-- Auto-update timestamp
CREATE OR REPLACE FUNCTION public._clapcheeks_leads_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clapcheeks_leads_updated_at ON public.clapcheeks_leads;
CREATE TRIGGER trg_clapcheeks_leads_updated_at
    BEFORE UPDATE ON public.clapcheeks_leads
    FOR EACH ROW EXECUTE FUNCTION public._clapcheeks_leads_set_updated_at();


-- ---------------------------------------------------------------------------
-- clapcheeks_user_settings — persona, drip rules, quiet hours, etc.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clapcheeks_user_settings (
    user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

    persona         JSONB DEFAULT '{}'::jsonb,           -- Persona dataclass shape
    drip_rules_yaml TEXT,                                -- raw YAML the user edits
    style_text      TEXT,                                -- free-form tone/voice
    quiet_hours     JSONB DEFAULT '{}'::jsonb,           -- {tinder:{start:9,end:22}, ...}

    -- Calendar booking config
    date_calendar_email TEXT DEFAULT 'primary',
    date_slots      JSONB DEFAULT '["18:00","20:00","21:30"]'::jsonb,
    date_slot_days_ahead INT DEFAULT 14,
    date_slot_duration_hours NUMERIC DEFAULT 2,
    date_timezone   TEXT DEFAULT 'America/Los_Angeles',

    -- Approval flags per lifecycle stage
    approve_openers BOOLEAN DEFAULT false,
    approve_replies BOOLEAN DEFAULT false,
    approve_date_asks BOOLEAN DEFAULT true,
    approve_bookings BOOLEAN DEFAULT true,

    updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.clapcheeks_user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_owner_all" ON public.clapcheeks_user_settings;
CREATE POLICY "user_settings_owner_all" ON public.clapcheeks_user_settings
    FOR ALL USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._clapcheeks_user_settings_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_clapcheeks_user_settings_updated_at
    ON public.clapcheeks_user_settings;
CREATE TRIGGER trg_clapcheeks_user_settings_updated_at
    BEFORE UPDATE ON public.clapcheeks_user_settings
    FOR EACH ROW EXECUTE FUNCTION public._clapcheeks_user_settings_updated_at();
