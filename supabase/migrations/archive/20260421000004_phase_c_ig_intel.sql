-- Phase C (AI-8317) - Instagram enrichment columns.
--
-- instagram_intel (JSONB) already exists from the Phase A migration
-- (20260420000002_matches_intel_fields.sql). Phase C adds two sibling
-- columns so the dashboard + Phase I scoring can tell apart a "we
-- haven't tried to scrape her feed yet" row from a "we tried, she's
-- private" row from a "we tried and her feed is empty" row.
--
-- Shape of instagram_intel once populated:
--   {
--     "handle":            "sarah.m",
--     "display_name":      "Sarah M",
--     "bio":               "nyc + pdx. long runs, longer dinners.",
--     "follower_count":    1843,
--     "following_count":   421,
--     "post_count":        217,
--     "is_private":        false,
--     "is_verified":       false,
--     "recent_posts":      [{"shortcode","caption","like_count",...}, ...x12],
--     "common_hashtags":   ["nyc","coffee","ramen"],
--     "aesthetic_tags":    ["travel","foodie","fitness"],
--     "summary":           "Aesthetic: travel, foodie, fitness. Hashtags
--                           she repeats: #nyc, #coffee, #ramen. Posts
--                           a few times a week."
--   }

ALTER TABLE public.clapcheeks_matches
    ADD COLUMN IF NOT EXISTS instagram_fetched_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS instagram_is_private  BOOLEAN DEFAULT FALSE;

-- Make the ig_enrich worker's "find matches to drain" query fast. The
-- predicate scopes to rows with a non-null handle so the index stays
-- small even as clapcheeks_matches grows.
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_ig_handle
    ON public.clapcheeks_matches (instagram_handle)
    WHERE instagram_handle IS NOT NULL;

-- Dashboard filter: "matches whose IG we haven't fetched yet".
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_ig_unfetched
    ON public.clapcheeks_matches (user_id, created_at DESC)
    WHERE instagram_handle IS NOT NULL
      AND instagram_intel   IS NULL;

COMMENT ON COLUMN public.clapcheeks_matches.instagram_fetched_at IS
  'Phase C (AI-8317): when ig_enrich.enrich_one last wrote instagram_intel. '
  'NULL = never attempted. Non-null with instagram_intel->error != null = '
  'tried and failed; see error field inside instagram_intel.';

COMMENT ON COLUMN public.clapcheeks_matches.instagram_is_private IS
  'Phase C (AI-8317): true when the last fetch saw is_private=true on her '
  'web_profile_info response. Stops the worker re-trying every tick.';
