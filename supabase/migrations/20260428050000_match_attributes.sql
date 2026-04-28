-- AI-8814: Match attribute extraction + tagging
-- Adds structured attribute JSONB to clapcheeks_matches.
-- Schema:
--   attributes: {
--     dietary: [{value, confidence, source_msg_excerpt, source_msg_index}],
--     allergy:  [...],   -- LIFE-SAFETY, rendered distinctly
--     schedule: [...],
--     lifestyle:[...],
--     logistics:[...],
--     comms:    [...],
--     _dismissed: [{value, category, dismissed_at}],  -- operator overrides
--     _extracted_at: ISO timestamp of last extraction run,
--     _model_used: "haiku-4-5" | "sonnet-4-6"
--   }

ALTER TABLE public.clapcheeks_matches
  ADD COLUMN IF NOT EXISTS attributes            JSONB    DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS attributes_updated_at TIMESTAMPTZ;

-- GIN index for fast filter queries (e.g., "show me all vegan matches")
CREATE INDEX IF NOT EXISTS idx_clapcheeks_matches_attributes
  ON public.clapcheeks_matches
  USING gin (attributes);

-- Comment for future devs
COMMENT ON COLUMN public.clapcheeks_matches.attributes IS
  'AI-extracted structured attributes (dietary, allergy, schedule, lifestyle, logistics, comms). '
  'Allergies rendered with life-safety red treatment. _dismissed[] stores operator overrides. '
  'See agent/clapcheeks/intel/attributes.py for schema. AI-8814.';

COMMENT ON COLUMN public.clapcheeks_matches.attributes_updated_at IS
  'Timestamp of last attribute extraction run. AI-8814.';
