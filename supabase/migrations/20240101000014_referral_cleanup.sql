-- Migration 014: Referral schema cleanup
-- Drop unused columns and sync duplicate referral code columns on profiles

-- ============================================================
-- 1. Drop unused referee_id column from clapcheeks_referrals
--    (canonical column is referred_id, referee_id was from script 010)
-- ============================================================
ALTER TABLE public.clapcheeks_referrals
  DROP COLUMN IF EXISTS referee_id;

-- ============================================================
-- 2. Drop unused ref_code column from clapcheeks_referrals
--    (canonical column is referral_code, ref_code was from script 010)
-- ============================================================
ALTER TABLE public.clapcheeks_referrals
  DROP COLUMN IF EXISTS ref_code;

-- ============================================================
-- 3. Sync profiles.ref_code and profiles.referral_code
--    Both columns exist and are queried by different parts of the app:
--    - referrals/page.tsx reads referral_code
--    - api/referral/generate reads ref_code
--    - api/referral/track reads ref_code
--    Keep both in sync via trigger until app code is consolidated.
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_referral_codes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If ref_code was set/changed, copy to referral_code
  IF NEW.ref_code IS DISTINCT FROM OLD.ref_code AND NEW.ref_code IS NOT NULL THEN
    NEW.referral_code := NEW.ref_code;
  -- If referral_code was set/changed, copy to ref_code
  ELSIF NEW.referral_code IS DISTINCT FROM OLD.referral_code AND NEW.referral_code IS NOT NULL THEN
    NEW.ref_code := NEW.referral_code;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_referral_codes_trigger ON public.profiles;
CREATE TRIGGER sync_referral_codes_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_referral_codes();

-- Backfill: sync any existing rows where one is set but not the other
UPDATE public.profiles
  SET ref_code = referral_code
  WHERE referral_code IS NOT NULL AND ref_code IS NULL;

UPDATE public.profiles
  SET referral_code = ref_code
  WHERE ref_code IS NOT NULL AND referral_code IS NULL;
