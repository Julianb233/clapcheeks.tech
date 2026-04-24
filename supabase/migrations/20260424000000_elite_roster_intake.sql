-- Elite roster + screenshot-intake columns (2026-04-24).
--
-- Drives the "Add from screenshot" feature: upload a photo of someone's
-- contact card or IG profile (via web upload, iMessage attachment, or
-- email attachment), Claude Vision extracts name + phone + email + IG
-- handle, we upsert a clapcheeks_matches row tagged `elite=true` and
-- sync the contact to Google Contacts.

ALTER TABLE public.clapcheeks_matches
    -- Marks this row as a member of Julian's curated "Elite" tier. Any
    -- stage can be elite — the flag is orthogonal to the kanban pipeline.
    ADD COLUMN IF NOT EXISTS elite              BOOLEAN  DEFAULT FALSE,
    -- Where the row originated. `source` already exists on other tables
    -- for photo upload origin etc; on matches it tracks intake channel:
    --   screenshot-web | screenshot-imessage | screenshot-email |
    --   manual | tinder | hinge | bumble | sms
    ADD COLUMN IF NOT EXISTS source             TEXT,
    -- Canonical E.164 phone number. Also used as a dedupe key alongside
    -- instagram_handle (case-insensitive).
    ADD COLUMN IF NOT EXISTS contact_phone      TEXT,
    -- Google Contacts resource name (`people/c1234567890`) so we can
    -- update in place on re-ingest instead of creating duplicates.
    ADD COLUMN IF NOT EXISTS google_contact_id  TEXT,
    -- Email extracted from the screenshot, when visible.
    ADD COLUMN IF NOT EXISTS contact_email      TEXT,
    -- The raw screenshot bytes landed in the Supabase `knowledge` bucket;
    -- keep the signed/storage path so we can re-run Vision later.
    ADD COLUMN IF NOT EXISTS intake_screenshot_path TEXT;

CREATE INDEX IF NOT EXISTS clapcheeks_matches_elite_idx
    ON public.clapcheeks_matches (user_id, elite)
    WHERE elite IS TRUE;

CREATE INDEX IF NOT EXISTS clapcheeks_matches_contact_phone_idx
    ON public.clapcheeks_matches (user_id, contact_phone)
    WHERE contact_phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS clapcheeks_matches_instagram_handle_idx
    ON public.clapcheeks_matches (user_id, instagram_handle)
    WHERE instagram_handle IS NOT NULL;
