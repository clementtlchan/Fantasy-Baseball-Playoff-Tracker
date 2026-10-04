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

create table if not exists public.game_records (
  game_pk bigint primary key,
  season integer not null,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function public.touch_game_record() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists game_record_touch on public.game_records;
create trigger game_record_touch before update on public.game_records for each row execute function public.touch_game_record();
alter table public.game_records enable row level security;
drop policy if exists "public can read game records" on public.game_records;
create policy "public can read game records" on public.game_records for select using (true);
drop policy if exists "admins can insert game records" on public.game_records;
create policy "admins can insert game records" on public.game_records for insert to authenticated
with check (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));
drop policy if exists "admins can update game records" on public.game_records;
create policy "admins can update game records" on public.game_records for update to authenticated
using (exists (select 1 from public.league_admins a where a.user_id=auth.uid()))
with check (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));


create table if not exists public.player_eligibility (
  season integer not null,
  mlb_player_id bigint not null,
  player_name text not null,
  espn_player_id bigint,
  positions text[] not null check (cardinality(positions) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (season, mlb_player_id)
);
create or replace function public.touch_player_eligibility() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists player_eligibility_touch on public.player_eligibility;
create trigger player_eligibility_touch before update on public.player_eligibility for each row execute function public.touch_player_eligibility();
alter table public.player_eligibility enable row level security;
drop policy if exists "public can read player eligibility" on public.player_eligibility;
create policy "public can read player eligibility" on public.player_eligibility for select using (true);
drop policy if exists "admins can insert player eligibility" on public.player_eligibility;
create policy "admins can insert player eligibility" on public.player_eligibility for insert to authenticated
with check (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));
drop policy if exists "admins can update player eligibility" on public.player_eligibility;
create policy "admins can update player eligibility" on public.player_eligibility for update to authenticated
using (exists (select 1 from public.league_admins a where a.user_id=auth.uid()))
with check (exists (select 1 from public.league_admins a where a.user_id=auth.uid()));

alter table public.player_eligibility
  add column if not exists source_version integer not null default 1;
