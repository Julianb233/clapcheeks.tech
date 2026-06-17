-- Backfill subscription_tier from plan where subscription_tier is null
-- This ensures any rows that only had plan set are migrated to subscription_tier
UPDATE profiles
  SET subscription_tier = plan
  WHERE subscription_tier IS NULL AND plan IS NOT NULL;

-- NOTE: The plan column is deprecated. All code now reads/writes subscription_tier.
-- DROP COLUMN will be done in a future migration after confirming no references remain.
-- ALTER TABLE profiles DROP COLUMN IF EXISTS plan;
