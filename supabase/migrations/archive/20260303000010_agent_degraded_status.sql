-- Add degraded status columns to clapcheeks_agent_tokens for AGENT-01
-- Allows daemon to push degraded platform info for dashboard visibility

ALTER TABLE clapcheeks_agent_tokens
  ADD COLUMN IF NOT EXISTS degraded_platform TEXT,
  ADD COLUMN IF NOT EXISTS degraded_reason TEXT;
