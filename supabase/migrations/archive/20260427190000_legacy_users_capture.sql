-- AI-8769: Capture LIVE prod schema for public.users (legacy table) into the migration system.
--
-- Background: prod (db.oouuoepmkeqdyzsxrnjh.supabase.co) has a `public.users` table that pre-dates
-- every migration in supabase/migrations/. It was likely created via Supabase Studio or a manual
-- psql session in the original "Outward" product era and was never tracked.
--
-- The canonical user record today is `public.profiles` (created by 20240101000001_create_user_profiles.sql)
-- which keys off auth.users. `public.users` is a parallel legacy table that survives only because
-- `public.notifications` has a FK pointing at it (see 20260427190000_legacy_notifications_capture.sql).
--
-- This migration mirrors the LIVE prod state so a fresh `supabase db reset` produces an
-- identical-shape DB. It does NOT consolidate users + profiles - that's a separate hardening task
-- (follow-up Linear issue mentioned in the AI-8769 audit inventory).
--
-- Source dump: pg_dump --table=public.users on 2026-04-27

-- updated_at trigger function (prod uses this name; existing migrations use set_updated_at instead -
-- both are valid, just different vintages)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    name character varying(255) NOT NULL,
    date_of_birth date,
    primary_love_language character varying(100),
    secondary_love_language character varying(100),
    personality_type character varying(50),
    photo_url text,
    preferences jsonb DEFAULT '{}'::jsonb,
    stripe_customer_id character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_pkey' AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE ONLY public.users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_email_key' AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE ONLY public.users ADD CONSTRAINT users_email_key UNIQUE (email);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_stripe_customer_id_key' AND conrelid = 'public.users'::regclass
    ) THEN
        ALTER TABLE ONLY public.users ADD CONSTRAINT users_stripe_customer_id_key UNIQUE (stripe_customer_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email);
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON public.users USING btree (stripe_customer_id);

DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can view own profile'
    ) THEN
        CREATE POLICY "Users can view own profile" ON public.users
            FOR SELECT USING ((auth.uid() = id));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can update own profile'
    ) THEN
        CREATE POLICY "Users can update own profile" ON public.users
            FOR UPDATE USING ((auth.uid() = id));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users'
          AND policyname = 'Users can insert own profile'
    ) THEN
        CREATE POLICY "Users can insert own profile" ON public.users
            FOR INSERT WITH CHECK ((auth.uid() = id));
    END IF;
END $$;

-- TODO (follow-up Linear): consolidate public.users into public.profiles + auth.users.
-- Risk: notifications.user_id FK points here; need to migrate FK target before dropping.
