CREATE TABLE IF NOT EXISTS clapcheeks_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID REFERENCES auth.users(id),
  referee_id UUID REFERENCES auth.users(id),
  ref_code TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'converted', 'credited')),
  credited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_referrals_ref_code ON clapcheeks_referrals(ref_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON clapcheeks_referrals(referrer_id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ref_code TEXT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_credits INTEGER DEFAULT 0;
