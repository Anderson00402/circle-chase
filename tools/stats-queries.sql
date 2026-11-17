-- Circle Chase play stats: questions to ask the data. In the Supabase dashboard open SQL Editor,
-- paste one query and click Run. (Table Editor shows the raw rows.)
-- Leave out version = 'localhost' to skip games played on your own computer.

-- 1. How long players survive, per version (games played to game over).
select version,
       count(*) as games,
       round(avg(survival_s)::numeric, 1) as avg_survival_s,
       round(percentile_cont(0.5) within group (order by survival_s)::numeric, 1) as median_survival_s,
       round(avg(cardinality(life_s))::numeric, 1) as avg_lives_lost
from plays
where ended = 'game_over'
group by version
order by games desc;

-- 2. When players stop chasing, per version. Only power-ups that ran out on their own, so stopping was
--    the player's choice (not a death, a cleared maze or no ghosts left to catch).
select p.version,
       count(*) as power_ups,
       round(100.0 * avg(u.chased::int)) as pct_chased,
       round(avg(u.stopped_left_s)::numeric, 2) as avg_power_left_when_stopped_s,
       round(percentile_cont(0.5) within group (order by u.stopped_left_s)::numeric, 2) as median_power_left_when_stopped_s,
       round(avg(u.to_next_power_s)::numeric, 1) as avg_s_from_stop_to_next_power
from power_ups u
join plays p on p.id = u.play_id
where u.ended = 'ran_out'
group by p.version
order by power_ups desc;

-- 3. The same stop points as a histogram: how many players stopped with 0-1 s, 1-2 s, ... of power left.
--    Main's walls blink red in the last 2 s, so watch the 1-2 s and 2-3 s rows.
select p.version,
       floor(u.stopped_left_s) as power_left_from_s,
       count(*) as power_ups
from power_ups u
join plays p on p.id = u.play_id
where u.ended = 'ran_out' and u.chased
group by 1, 2
order by 1, 2;

-- 4. The latest games, newest first.
select created_at, version, difficulty, ended, survival_s, life_s, score, level
from plays
order by created_at desc
limit 50;
