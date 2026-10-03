create table if not exists public.league_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  owner text not null default '',
  player_ids bigint[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.league_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create or replace function public.touch_league_team() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists league_team_touch on public.league_teams;
create trigger league_team_touch before update on public.league_teams for each row execute function public.touch_league_team();
alter table public.league_teams enable row level security;
alter table public.league_admins enable row level security;
drop policy if exists "public can read teams" on public.league_teams;
create policy "public can read teams" on public.league_teams for select using (true);
drop policy if exists "admins can insert teams" on public.league_teams;
create policy "admins can insert teams" on public.league_teams for insert to authenticated with check (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));
drop policy if exists "admins can update teams" on public.league_teams;
create policy "admins can update teams" on public.league_teams for update to authenticated using (exists (select 1 from public.league_admins a where a.user_id=auth.uid())) with check (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));
drop policy if exists "admins can delete teams" on public.league_teams;
create policy "admins can delete teams" on public.league_teams for delete to authenticated using (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));
-- After creating your Auth user, run: insert into public.league_admins(user_id) values ('YOUR-AUTH-USER-UUID');

drop policy if exists "admins can read own admin row" on public.league_admins;
create policy "admins can read own admin row"
on public.league_admins for select to authenticated
using (user_id = auth.uid());
