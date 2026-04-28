-- ============================================================================
-- CANONICAL SCHEMA SNAPSHOT: public.clapcheeks_matches
-- ============================================================================
--
-- Source: pg_dump --schema-only --table=public.clapcheeks_matches
-- Target: db.oouuoepmkeqdyzsxrnjh.supabase.co (Clapcheeks production)
-- Captured: 2026-04-27 (AI-8769)
--
-- DO NOT RUN THIS FILE AGAINST ANY DATABASE. This is a read-only snapshot for
-- reference only. The table is built up by ~13 migrations applied in sequence;
-- this snapshot represents the END STATE for cross-checking new ALTERs against.
--
-- Migrations that contributed to this schema (in order):
--   20240101000002_outward_core.sql               -- original CREATE TABLE outward_matches
--   20240101000003_rls_policies.sql               -- (policies on outward_matches; renamed later)
--   20240101000004_rename_outward_to_clapcheeks   -- RENAME outward_matches -> clapcheeks_matches
--   20240101000011_audit_fixes.sql                -- RLS hardening
--   20260420000002_matches_intel_fields.sql       -- 19 columns: external_id, name, age, bio,
--                                                    photos_jsonb, prompts_jsonb, job, school,
--                                                    instagram_handle, spotify_artists, birth_date,
--                                                    zodiac, match_intel, vision_summary,
--                                                    instagram_intel, status, last_activity_at,
--                                                    updated_at + trg_..._touch_updated_at trigger
--   20260420000004_match_scoring_columns.sql      -- 8 cols: location_score, criteria_score,
--                                                    final_score, dealbreaker_flags, scoring_reason,
--                                                    distance_miles, cluster_id, scored_at
--   20260420000005_contact_intelligence.sql       -- (creates contact_* tables, no matches changes)
--   20260421000002_phase_f_handoff.sql            -- 8 cols: her_phone, julian_shared_phone,
--                                                    handoff_complete, primary_channel, met_at,
--                                                    source, first_impression, handoff_detected_at
--   20260421000004_phase_c_ig_intel.sql           -- 2 cols: instagram_fetched_at, instagram_is_private
--   20260421000005_phase_g_drip.sql               -- 4 cols: last_drip_at, drip_count,
--                                                    outcome_prompted_at, outcome
--   20260421000008_phase_j_roster.sql             -- 18 cols: stage, health_score, julian_rank,
--                                                    close_probability, messages_total, messages_7d,
--                                                    messages_30d, his_to_her_ratio, avg_reply_hours,
--                                                    time_to_date_days, flake_count, sentiment_trajectory,
--                                                    night_energy, recurrence_score, red_flags,
--                                                    boundary_flags_count, last_her_initiated_at,
--                                                    geographic_cluster_id
--   20260421000009_phase_k_social_graph.sql       -- 9 cols: mutual_friends_count, mutual_friends_list,
--                                                    social_risk_band, friend_cluster_id, cluster_rank,
--                                                    shared_female_friends, social_graph_confidence,
--                                                    social_graph_sources, social_graph_scanned_at
--
-- Additional state on prod NOT YET tracked in any committed migration (TODO: backfill these
-- as a follow-up migration so the migration set is internally complete):
--   - Columns: reschedule_count INT NOT NULL DEFAULT 0, last_reschedule_at TIMESTAMPTZ,
--              last_flake_at TIMESTAMPTZ
--   - Trigger: trg_clapcheeks_matches_preserve_user_intel BEFORE UPDATE
--   - Function: clapcheeks_matches_preserve_user_intel()
--   - Function: clapcheeks_matches_touch_updated_at()  (referenced by trigger added in
--              20260420000002 but the function definition isn't in any committed migration -
--              another item for the follow-up backfill)
--
-- ============================================================================

CREATE TABLE public.clapcheeks_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    platform text NOT NULL,
    match_id text NOT NULL,
    match_name text,
    opened boolean DEFAULT false,
    opener_sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    -- 20260420000002_matches_intel_fields
    external_id text,
    name text,
    age integer,
    bio text,
    photos_jsonb jsonb DEFAULT '[]'::jsonb,
    prompts_jsonb jsonb DEFAULT '[]'::jsonb,
    job text,
    school text,
    instagram_handle text,
    spotify_artists jsonb,
    birth_date date,
    zodiac text,
    match_intel jsonb,
    vision_summary text,
    instagram_intel jsonb,
    status text DEFAULT 'new'::text,
    last_activity_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    -- 20260420000004_match_scoring_columns
    location_score real,
    criteria_score real,
    final_score real,
    dealbreaker_flags jsonb DEFAULT '[]'::jsonb,
    scoring_reason text,
    distance_miles real,
    cluster_id uuid,
    scored_at timestamp with time zone,
    -- 20260421000002_phase_f_handoff
    her_phone text,
    julian_shared_phone boolean DEFAULT false,
    handoff_complete boolean DEFAULT false,
    primary_channel text DEFAULT 'platform'::text,
    met_at text,
    source text,
    first_impression text,
    handoff_detected_at timestamp with time zone,
    -- 20260421000004_phase_c_ig_intel
    instagram_fetched_at timestamp with time zone,
    instagram_is_private boolean DEFAULT false,
    -- 20260421000008_phase_j_roster
    stage text DEFAULT 'new_match'::text,
    health_score integer,
    health_score_updated_at timestamp with time zone,
    julian_rank integer,
    close_probability real,
    messages_total integer DEFAULT 0,
    messages_7d integer DEFAULT 0,
    messages_30d integer DEFAULT 0,
    his_to_her_ratio real,
    avg_reply_hours real,
    time_to_date_days integer,
    flake_count integer DEFAULT 0,
    sentiment_trajectory text,
    night_energy real,
    recurrence_score real,
    red_flags jsonb DEFAULT '[]'::jsonb,
    boundary_flags_count integer DEFAULT 0,
    last_her_initiated_at timestamp with time zone,
    geographic_cluster_id uuid,
    -- 20260421000009_phase_k_social_graph
    mutual_friends_count integer DEFAULT 0,
    mutual_friends_list jsonb DEFAULT '[]'::jsonb,
    social_risk_band text DEFAULT 'safe'::text,
    friend_cluster_id uuid,
    cluster_rank integer DEFAULT 1,
    shared_female_friends jsonb DEFAULT '[]'::jsonb,
    social_graph_confidence real,
    social_graph_sources jsonb DEFAULT '[]'::jsonb,
    social_graph_scanned_at timestamp with time zone,
    -- NOT IN ANY COMMITTED MIGRATION (TODO backfill):
    reschedule_count integer DEFAULT 0 NOT NULL,
    last_reschedule_at timestamp with time zone,
    last_flake_at timestamp with time zone,
    CONSTRAINT clapcheeks_matches_julian_rank_check
        CHECK (((julian_rank IS NULL) OR ((julian_rank >= 1) AND (julian_rank <= 10)))),
    CONSTRAINT clapcheeks_matches_primary_channel_check
        CHECK ((primary_channel = ANY (ARRAY['platform'::text, 'imessage'::text]))),
    CONSTRAINT clapcheeks_matches_social_risk_band_check
        CHECK ((social_risk_band = ANY (ARRAY['safe'::text, 'watch'::text, 'high_risk'::text, 'auto_flag'::text]))),
    CONSTRAINT clapcheeks_matches_source_check
        CHECK (((source IS NULL) OR (source = ANY (ARRAY['imessage'::text, 'platform'::text, 'tinder'::text, 'hinge'::text, 'bumble'::text, 'offline'::text])))),
    CONSTRAINT clapcheeks_matches_stage_check
        CHECK ((stage = ANY (ARRAY['new_match'::text, 'chatting'::text, 'chatting_phone'::text, 'date_proposed'::text, 'date_booked'::text, 'date_attended'::text, 'hooked_up'::text, 'recurring'::text, 'faded'::text, 'ghosted'::text, 'archived'::text, 'archived_cluster_dupe'::text]))),
    CONSTRAINT clapcheeks_matches_status_check
        CHECK ((status = ANY (ARRAY['new'::text, 'opened'::text, 'conversing'::text, 'chatting'::text, 'chatting_phone'::text, 'stalled'::text, 'date_proposed'::text, 'date_booked'::text, 'dated'::text, 'ghosted'::text])))
);

COMMENT ON COLUMN public.clapcheeks_matches.instagram_fetched_at IS
    'Phase C (AI-8317): when ig_enrich.enrich_one last wrote instagram_intel. NULL = never attempted. Non-null with instagram_intel->error != null = tried and failed; see error field inside instagram_intel.';

COMMENT ON COLUMN public.clapcheeks_matches.instagram_is_private IS
    'Phase C (AI-8317): true when the last fetch saw is_private=true on her web_profile_info response. Stops the worker re-trying every tick.';

-- Constraints
ALTER TABLE ONLY public.clapcheeks_matches
    ADD CONSTRAINT clapcheeks_matches_user_platform_external_uq UNIQUE (user_id, platform, external_id);
ALTER TABLE ONLY public.clapcheeks_matches
    ADD CONSTRAINT outward_matches_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.clapcheeks_matches
    ADD CONSTRAINT outward_matches_user_id_platform_match_id_key UNIQUE (user_id, platform, match_id);
ALTER TABLE ONLY public.clapcheeks_matches
    ADD CONSTRAINT outward_matches_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Indexes (13)
CREATE INDEX idx_clapcheeks_matches_close_probability ON public.clapcheeks_matches USING btree (user_id, close_probability DESC NULLS LAST) WHERE (stage <> ALL (ARRAY['archived'::text, 'archived_cluster_dupe'::text, 'ghosted'::text, 'faded'::text]));
CREATE INDEX idx_clapcheeks_matches_final_score ON public.clapcheeks_matches USING btree (final_score DESC NULLS LAST);
CREATE INDEX idx_clapcheeks_matches_friend_cluster_id ON public.clapcheeks_matches USING btree (friend_cluster_id) WHERE (friend_cluster_id IS NOT NULL);
CREATE INDEX idx_clapcheeks_matches_geo_cluster ON public.clapcheeks_matches USING btree (user_id, geographic_cluster_id) WHERE (geographic_cluster_id IS NOT NULL);
CREATE INDEX idx_clapcheeks_matches_handoff_complete ON public.clapcheeks_matches USING btree (user_id, handoff_complete) WHERE (handoff_complete = true);
CREATE INDEX idx_clapcheeks_matches_health_updated ON public.clapcheeks_matches USING btree (user_id, health_score_updated_at NULLS FIRST);
CREATE INDEX idx_clapcheeks_matches_her_phone ON public.clapcheeks_matches USING btree (user_id, her_phone) WHERE (her_phone IS NOT NULL);
CREATE INDEX idx_clapcheeks_matches_ig_handle ON public.clapcheeks_matches USING btree (instagram_handle) WHERE (instagram_handle IS NOT NULL);
CREATE INDEX idx_clapcheeks_matches_ig_unfetched ON public.clapcheeks_matches USING btree (user_id, created_at DESC) WHERE ((instagram_handle IS NOT NULL) AND (instagram_intel IS NULL));
CREATE INDEX idx_clapcheeks_matches_platform ON public.clapcheeks_matches USING btree (user_id, platform);
CREATE INDEX idx_clapcheeks_matches_social_risk_band ON public.clapcheeks_matches USING btree (user_id, social_risk_band) WHERE (social_risk_band IS NOT NULL);
CREATE INDEX idx_clapcheeks_matches_social_unscanned ON public.clapcheeks_matches USING btree (user_id, created_at DESC) WHERE (social_graph_scanned_at IS NULL);
CREATE INDEX idx_clapcheeks_matches_stage_close ON public.clapcheeks_matches USING btree (user_id, stage, close_probability DESC NULLS LAST);
CREATE INDEX idx_clapcheeks_matches_status ON public.clapcheeks_matches USING btree (user_id, status, last_activity_at DESC);
CREATE INDEX idx_clapcheeks_matches_unscored ON public.clapcheeks_matches USING btree (user_id, created_at DESC) WHERE (final_score IS NULL);
CREATE INDEX idx_clapcheeks_matches_updated_at ON public.clapcheeks_matches USING btree (updated_at DESC);

-- Triggers
CREATE TRIGGER trg_clapcheeks_matches_preserve_user_intel
    BEFORE UPDATE ON public.clapcheeks_matches
    FOR EACH ROW
    EXECUTE FUNCTION public.clapcheeks_matches_preserve_user_intel();

CREATE TRIGGER trg_clapcheeks_matches_touch_updated_at
    BEFORE UPDATE ON public.clapcheeks_matches
    FOR EACH ROW
    EXECUTE FUNCTION public.clapcheeks_matches_touch_updated_at();

-- RLS
ALTER TABLE public.clapcheeks_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own matches"   ON public.clapcheeks_matches FOR SELECT USING ((auth.uid() = user_id));
CREATE POLICY "Users can insert own matches" ON public.clapcheeks_matches FOR INSERT WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "Users can update own matches" ON public.clapcheeks_matches FOR UPDATE USING ((auth.uid() = user_id));
CREATE POLICY "Users can delete own matches" ON public.clapcheeks_matches FOR DELETE USING ((auth.uid() = user_id));
