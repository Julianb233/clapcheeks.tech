-- Add Clap Cheeks fields to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'base' CHECK (plan IN ('base', 'elite'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rizz_score INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_matches INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS dates_booked INTEGER DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS total_spend NUMERIC(10,2) DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'inactive';
