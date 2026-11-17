-- Circle Chase play stats: the database the game saves every game to (Supabase, which is Postgres).
-- Set it up once: Supabase dashboard > SQL Editor > New query > paste this whole file > Run.
-- Running it again is safe. To read the results, see tools/stats-queries.sql.
--
-- All times are game seconds, so a paused game never adds to them.

-- One row per game.
create table if not exists public.plays (
  id          uuid primary key default gen_random_uuid(),  -- made by the game, so a game sent twice is kept once
  created_at  timestamptz not null default now(),
  version     text not null,     -- what was played: main, a branch name, pr-<number>, or localhost
  difficulty  text not null check (difficulty in ('easy', 'normal', 'hard')),
  ended       text not null check (ended in ('game_over', 'quit')),  -- quit: left or restarted before game over
  survival_s  real not null check (survival_s between 0 and 86400),  -- from Start to the last death (or to quitting)
  life_s      real[] not null default '{}' check (cardinality(life_s) <= 1000), -- each life, from when you could move to that death
  score       integer not null check (score between 0 and 100000000),
  level       integer not null check (level between 1 and 100000)    -- the level reached
);

-- One row per power dot eaten.
create table if not exists public.power_ups (
  id               bigint generated always as identity primary key,
  play_id          uuid not null references public.plays (id) on delete cascade,
  n                integer not null check (n between 1 and 100000),  -- 1 = the game's first power dot
  level            integer not null check (level between 1 and 100000),
  length_s         real not null check (length_s between 0 and 60),  -- how long it lasts (6 s on level 1, Normal)
  started_s        real not null check (started_s >= 0),             -- when it was eaten, counted from Start
  chased           boolean not null,       -- went after a scared ghost (see "Chasing" in index.html) or ate one
  ghosts_eaten     integer not null check (ghosts_eaten between 0 and 4),
  stopped_left_s   real check (stopped_left_s between 0 and length_s), -- power left when they stopped chasing (the
                                                                       -- number on the timer bar); null = never chased
  to_next_power_s  real check (to_next_power_s >= 0), -- from stopping to the next power dot; null = no later one
  ended            text not null check (ended in ('ran_out', 'no_ghosts_left', 'died', 'cleared', 'new_power', 'quit'))
);
create index if not exists power_ups_play_id on public.power_ups (play_id);

-- The game's key is public (it is in the page), so it gets no direct access to the tables: it can only
-- add a game through record_play(). The tables stay readable in the dashboard.
alter table public.plays enable row level security;
alter table public.power_ups enable row level security;
revoke all on table public.plays, public.power_ups from anon, authenticated;

-- Saves one game and its power-ups. The game calls it as POST /rest/v1/rpc/record_play
-- with the body {"play": {...}, "powers": [...]}. A game that arrives again (same id) is ignored.
create or replace function public.record_play(play jsonb, powers jsonb default '[]'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if jsonb_typeof(play) is distinct from 'object' or jsonb_typeof(powers) is distinct from 'array'
     or jsonb_array_length(powers) > 1000 then
    raise exception 'record_play needs a play object and a list of up to 1000 powers';
  end if;

  insert into public.plays (id, version, difficulty, ended, survival_s, life_s, score, level)
  select coalesce(p.id, gen_random_uuid()), left(p.version, 100), p.difficulty, p.ended, p.survival_s,
         coalesce(p.life_s, '{}'), p.score, p.level
  from jsonb_to_record(play) as p(id uuid, version text, difficulty text, ended text, survival_s real,
                                  life_s real[], score integer, level integer)
  on conflict (id) do nothing
  returning id into new_id;
  if new_id is null then
    return; -- already saved
  end if;

  insert into public.power_ups (play_id, n, level, length_s, started_s, chased, ghosts_eaten, stopped_left_s,
                                to_next_power_s, ended)
  select new_id, u.n, u.level, u.length_s, u.started_s, u.chased, u.ghosts_eaten, u.stopped_left_s,
         u.to_next_power_s, u.ended
  from jsonb_to_recordset(powers) as u(n integer, level integer, length_s real, started_s real, chased boolean,
                                       ghosts_eaten integer, stopped_left_s real, to_next_power_s real, ended text);
end;
$$;

revoke all on function public.record_play(jsonb, jsonb) from public;
grant execute on function public.record_play(jsonb, jsonb) to anon, authenticated;
