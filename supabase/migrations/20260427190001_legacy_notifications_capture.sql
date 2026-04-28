-- AI-8769: Capture LIVE prod schema for public.notifications into the migration system.
--
-- Background: web/scripts/001_create_schema.sql (now archived) defined a `notifications` table
-- with FKs to events/groups (which are dead/never deployed) and FK user_id -> public.profiles(id).
-- The LIVE prod table at db.oouuoepmkeqdyzsxrnjh.supabase.co has a DIFFERENT schema:
--   - title varchar(255), message text, type varchar(50), read boolean, action_url text
--   - FK user_id -> public.users(id)  (see 20260427190000_legacy_users_capture.sql)
--   - 2 RLS policies (view + update only, no insert/delete user-side - inserts via service role)
--
-- This migration mirrors the LIVE prod state so a fresh `supabase db reset` produces an
-- identical-shape table. It is safe to re-apply against prod (every clause is IF NOT EXISTS
-- or DO-block guarded).
--
-- Used by: web/app/notifications/page.tsx (lists notifications for the auth user)
-- Source dump: pg_dump --table=public.notifications on 2026-04-27

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    type character varying(50),
    read boolean DEFAULT false,
    action_url text,
    created_at timestamp with time zone DEFAULT now()
);

-- Primary key (idempotent)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notifications_pkey' AND conrelid = 'public.notifications'::regclass
    ) THEN
        ALTER TABLE ONLY public.notifications
            ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user
    ON public.notifications USING btree (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read
    ON public.notifications USING btree (read, created_at DESC);

-- FK to public.users (see 20260427190000_legacy_users_capture.sql which captures that table)
-- Guarded so we don't add the constraint twice and so we don't fail if public.users
-- isn't there yet on a brand-new clone.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
    )
    AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'notifications_user_id_fkey' AND conrelid = 'public.notifications'::regclass
    ) THEN
        ALTER TABLE ONLY public.notifications
            ADD CONSTRAINT notifications_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notifications'
          AND policyname = 'Users can view own notifications'
    ) THEN
        CREATE POLICY "Users can view own notifications" ON public.notifications
            FOR SELECT USING ((auth.uid() = user_id));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'notifications'
          AND policyname = 'Users can update own notifications'
    ) THEN
        CREATE POLICY "Users can update own notifications" ON public.notifications
            FOR UPDATE USING ((auth.uid() = user_id));
    END IF;
END $$;
