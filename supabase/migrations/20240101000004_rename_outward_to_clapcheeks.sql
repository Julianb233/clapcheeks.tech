-- Migration 004: Rename all outward_* tables to clapcheeks_*
-- Runs inside a transaction so it's fully atomic — either all rename or none do.

begin;

-- 1. Rename tables
alter table if exists public.outward_agent_tokens    rename to clapcheeks_agent_tokens;
alter table if exists public.outward_sessions        rename to clapcheeks_sessions;
alter table if exists public.outward_matches         rename to clapcheeks_matches;
alter table if exists public.outward_conversations   rename to clapcheeks_conversations;
alter table if exists public.outward_analytics_daily rename to clapcheeks_analytics_daily;

-- 2. Rename RLS policies (drop old names, recreate with new table references)
--    Supabase auto-attaches policies to tables by OID so renaming the table
--    keeps policies intact — but rename them for clarity.

-- agent_tokens policies
do $$ begin
  if exists (select 1 from pg_policies where tablename = 'clapcheeks_agent_tokens' and policyname = 'Users can view own tokens') then
    alter policy "Users can view own tokens" on public.clapcheeks_agent_tokens rename to "clapcheeks_agent_tokens_select";
  end if;
end $$;

-- 3. Rename sequences if any were named after the old tables
do $$
declare
  seq record;
begin
  for seq in
    select sequence_name from information_schema.sequences
    where sequence_schema = 'public' and sequence_name like 'outward_%'
  loop
    execute format('alter sequence public.%I rename to %I',
      seq.sequence_name,
      replace(seq.sequence_name, 'outward_', 'clapcheeks_')
    );
  end loop;
end $$;

-- 4. Update any foreign key references stored as text in config tables
--    (none expected, but safety net)

commit;

-- Verification: list renamed tables
select tablename
from pg_tables
where schemaname = 'public'
  and tablename like 'clapcheeks_%'
order by tablename;
