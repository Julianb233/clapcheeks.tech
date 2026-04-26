-- Extend sequence_type to cover the full nurture set:
--   follow_up        — generic re-engagement (existing)
--   manual           — Julian typed it himself (existing)
--   app_to_text      — move from dating app to iMessage (existing)
--   pre_date_confirm — fire 24h before scheduled date
--   post_date_thank  — fire 12h after a date_attended row
--   ghost_reengage   — single attempt to revive a faded/ghosted match
--   nudge            — light "thinking of you" between dates
ALTER TABLE clapcheeks_scheduled_messages
  DROP CONSTRAINT IF EXISTS clapcheeks_scheduled_messages_sequence_type_check;

ALTER TABLE clapcheeks_scheduled_messages
  ADD CONSTRAINT clapcheeks_scheduled_messages_sequence_type_check
  CHECK (sequence_type IN (
    'follow_up', 'manual', 'app_to_text',
    'pre_date_confirm', 'post_date_thank', 'ghost_reengage', 'nudge'
  ));

-- We need an index on (user_id, status, scheduled_at) so the drainer can
-- efficiently find rows that are due. Existing index is on (user_id, status)
-- only, which forces a seq scan over scheduled_at.
CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
  ON clapcheeks_scheduled_messages (status, scheduled_at)
  WHERE status IN ('pending', 'approved');

-- match_id was added as TEXT by an earlier migration; we need UUID so we can
-- join to clapcheeks_matches.id (UUID). Drop+re-add if currently TEXT.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clapcheeks_scheduled_messages'
      AND column_name = 'match_id'
      AND data_type = 'text'
  ) THEN
    ALTER TABLE clapcheeks_scheduled_messages DROP COLUMN match_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clapcheeks_scheduled_messages'
      AND column_name = 'match_id'
  ) THEN
    ALTER TABLE clapcheeks_scheduled_messages
      ADD COLUMN match_id UUID REFERENCES clapcheeks_matches(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Helper view: due-now scheduled messages joined to match phone (so the
-- drainer doesn't have to cross-join itself).
CREATE OR REPLACE VIEW clapcheeks_scheduled_messages_due AS
SELECT
  sm.*,
  COALESCE(sm.phone, m.her_phone) AS effective_phone
FROM clapcheeks_scheduled_messages sm
LEFT JOIN clapcheeks_matches m ON m.id = sm.match_id
WHERE sm.status IN ('pending', 'approved')
  AND sm.scheduled_at <= NOW();
