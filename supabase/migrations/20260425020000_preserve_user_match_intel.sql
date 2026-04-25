-- Preserve user-set fields on clapcheeks_matches.match_intel JSONB across
-- agent syncs. The python match_sync worker upserts the entire match_intel
-- column every cycle (every ~15min), which was wiping Julian's manually
-- entered notes + tags + any custom keys.
--
-- This trigger fires BEFORE UPDATE and merges the new match_intel into
-- the existing row, with these keys ALWAYS preserved from the existing
-- value (they're user-owned, never agent-owned):
--
--   notes, tags, manual_overrides, last_opener_copied,
--   custom_fields, julian_notes
--
-- Anything else the agent writes wins. If the new match_intel doesn't
-- contain a key but the old one does, the old value is preserved.

CREATE OR REPLACE FUNCTION public.clapcheeks_matches_preserve_user_intel()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  user_keys text[] := ARRAY[
    'notes',
    'tags',
    'manual_overrides',
    'last_opener_copied',
    'custom_fields',
    'julian_notes'
  ];
  k text;
  merged jsonb;
BEGIN
  -- Skip if there's no existing match_intel to preserve from.
  IF OLD.match_intel IS NULL OR jsonb_typeof(OLD.match_intel) <> 'object' THEN
    RETURN NEW;
  END IF;

  -- Skip if the new match_intel is null/non-object — keep the old.
  IF NEW.match_intel IS NULL OR jsonb_typeof(NEW.match_intel) <> 'object' THEN
    NEW.match_intel = OLD.match_intel;
    RETURN NEW;
  END IF;

  -- Start with: NEW values overlay OLD (so agent-owned fields update normally),
  -- then force user-owned keys back to their OLD values.
  merged := OLD.match_intel || NEW.match_intel;

  FOREACH k IN ARRAY user_keys LOOP
    IF OLD.match_intel ? k THEN
      merged := jsonb_set(merged, ARRAY[k], OLD.match_intel -> k);
    END IF;
  END LOOP;

  NEW.match_intel := merged;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_clapcheeks_matches_preserve_user_intel ON public.clapcheeks_matches;
CREATE TRIGGER trg_clapcheeks_matches_preserve_user_intel
  BEFORE UPDATE ON public.clapcheeks_matches
  FOR EACH ROW
  EXECUTE FUNCTION public.clapcheeks_matches_preserve_user_intel();

-- Note: this trigger handles UPDATE only, not INSERT. New matches don't have
-- existing user data to preserve. The web app's PATCH /api/matches/[id]
-- continues to work because it explicitly merges against existing — but the
-- trigger is defensive: if it ever forgets, the trigger still wins.
