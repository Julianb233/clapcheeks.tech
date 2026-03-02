create table clapcheeks_device_codes (
  code text primary key,
  user_id uuid references auth.users(id),
  created_at timestamptz default now(),
  expires_at timestamptz not null,
  used boolean default false
);
-- Auto-cleanup expired codes
create index on clapcheeks_device_codes(expires_at);
