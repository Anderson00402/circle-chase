# What we measure, and why

## Question

**Do players know when the power-up is about to run out, and which cue tells them best?**

A power-up makes ghosts edible for a few seconds. If a player knows how much time is left, they
chase right up to the end and get out in time. If they do not, they either give up early (wasting
the power) or keep chasing a ghost that turns on them (and get caught). So the player's own
behaviour around the end of each power-up tells us whether the cue worked.

## Conditions

Thirteen, each showing **one signal only** so results are not muddied by a second cue:

| Code | Condition | Role |
| --- | --- | --- |
| A | No signal | Reference: the floor. Players must guess. |
| B | Classic blink | Reference: the genre's usual white blink in the last 2 s. |
| 0 | Timer bar | Baseline: a draining bar with seconds. |
| 1-10 | The ten ideas | Ink refill, clock halos, burning fuse, wall tide, heartbeat, waking ghosts, pen hourglass, deflating player, 3-2-1 stamps, dot sweep. |

Only "Classic blink" uses the white ghost blink. The base game itself must never hint at the time
left (no music that speeds up, no colour drift): that is the cue's job alone.

## Unit of analysis: the trial

One **trial** = one power-up, from eating the power dot until 3 s after the power ends.

## Design

- **Run by a researcher.** The researcher picks a case on the run console and the participant
  plays it; one run of one case is a **block**. There is no self-serve wizard and no practice
  round. A participant label ("P07") ties the runs of one person into a session.
- **Within-subject, counterbalanced by suggestion.** The console suggests the next case from a
  counterbalanced order (balanced Latin square row picked by participant number), so no case
  always benefits from practice. The researcher may override it; the actual order is recorded.
- **Random power length.** Under study rules each power-up lasts a random 4-8 s. With a fixed
  length players would simply learn the rhythm; with a random one the cue is the only way to know.
- **Many comparable trials.** Under study rules power dots grow back after 12 s, only one
  power-up runs at a time, no power dot is on the board until 3 s after a power-up ended (so the
  aftermath of a trial is never cut short by the next one, even when the maze is cleared and comes
  back), lives are unlimited and the maze and speeds never change (deaths are still recorded).
- **Power-ups that end in a decision.** Under study rules scared ghosts close to the player run
  from it, a little slower than the player, so a chase lasts and is often still under way when the
  power runs out: that is when the player has to decide. See "Study-rule levers" below.
- **Run length.** A run ends by itself after a set number of power-ups (default 16, about 4
  minutes), finishing the one in progress first. See "How long a run is" below.
- **Self-report, optional.** After a run the researcher can ask: "I could tell when the power was
  about to run out" and "The signal got in the way of playing", both 1-7.
- Arcade rules (fixed power lengths, real lives, levels) also record trials, tagged `mode: 'arcade'`.
- Simulated players (bots) may be used to exercise the pipeline. Their data is tagged
  `source: 'bot'` and is **never** mixed with human data by default: a bot cannot see a cue, so
  bot results say nothing about which cue is better.

## What is recorded for every trial

Context: participant, session, block index, trial index in block, cue, mode, difficulty, level,
maze, power length, sound on/off, reduced motion, input type, average frame rate, app version,
`source`.

Behaviour. All distances are **path distances through the maze** in tiles (tunnels wrap), to
scared ghosts that are out of the pen. The numbers live in `convex/lib/rules.ts`; the tracker
(`src/lib/telemetry/tracker.ts`) measures, the rules classify.

### Chasing

The outcome classes describe a **decision about timing**: a player who is going after a scared
ghost turns away in time, turns away too early, or stays too long. So everything hangs on what
"going after a ghost" means. It is the player's own doing, toward a ghost they could plausibly
get, for long enough to mean it:

| Part | Rule | Why this number |
| --- | --- | --- |
| The player's own steps | Every frame, for every scared ghost, take the path distance to where the ghost is now, from where the player is now and from where the player was one frame ago. The difference is what the player's step did. Only that counts. | A ghost that walks toward a player who stands still or runs away closes the gap too. That is not a chase. (And a ghost that runs away while the player follows is one, although the gap may grow.) |
| A plausible target: **6 tiles** | An approach starts with a step toward a scared ghost at most 6 tiles away, and is over if the ghost gets farther than that. | The player runs about 5.6 tiles/s (6.2 with the power on). Under arcade rules a scared ghost runs 3.6 and turns at random: 6 tiles is about 1 s away if it holds still and 2.3 s if it runs straight away, inside the 3 s warning window whatever it does. Under study rules (since the fleeing ghosts, see "Study-rule levers") a scared ghost within 7 tiles runs from the player at 4.7 tiles/s, so the pursuit closes about 1.5 tiles a second and a ghost 6 tiles off takes about 4 s. The number was kept: it says which ghost the player is plausibly going after, not that it will be caught. |
| Sustained: **3 tiles** | An approach is a chase once the player's own steps closed 3 tiles on the ghost while the power was on (about half a second of running). Shorter approaches leave no trace. | A step or two toward a ghost is a blip, not a decision. With 3 tiles, a simulated player who avoids scared ghosts shows a chase in 11% of power-ups (25% with 2 tiles), while players who do chase keep about nine in ten of theirs. |
| The end of a chase: **1 tile back, or 0.5 s without progress** | The chase is over when the player's own steps took them 1 tile back from their closest point, or brought them no closer for 0.5 s (they stopped, or dither), or the ghost got out of range. | One tile is clearly a turn and not a wobble at a corner (0.16 s of running). |
| The turn-away moment | The player's closest point by their own steps: the last step toward the ghost before they backed off or stopped. Not the later frame on which the end was noticed. | So there is no lag: a player closest with 0.3 s left who then only moves away turned with 0.3 s left. An approach is followed past the end of the power with the same rule, so a turn after the end has a negative time left. |
| Eating | Eating a ghost ends the chase there, at distance 0, and wipes every approach under way. What the player does next has to earn a new chase from nothing. | An eat can end a chase but never start one: running on for a moment after a catch is not "turning away from the next ghost". |
| After the end | Nothing starts, and nothing becomes a chase, once the power is over. A chase under way at the end is followed until the player turns. | Once the ghosts hunt the player, every step is toward one of them, so steps taken then prove nothing. Running on in a chase that was already under way is exactly the mistake to record. |

Other measures:

| Measure | Definition |
| --- | --- |
| Final decision | If chases were still running when the power ran out (their turn-away came at or after the end, or never): the one whose ghost was nearest at that moment, the ghost the player was exposed to. Otherwise the chase whose turn-away moment came last (of two that turned on the same frame, the nearer ghost). And how it ended: `turn`, `eat` or `open`. |
| Turn-away time, distance | Power left, and distance to the chased ghost, at the turn-away moment of the final chase. For a chase that ended in an eat: the time left at the eat, distance 0. None for a chase that never turned. |
| Reachable | At the turn-away the chased ghost could still have been reached before the power ran out had it held still: distance at most (time left x 5.6 tiles/s). |
| Engaged | Some chase reached into the **warning window**, the last 3 s of the power (the whole power if shorter): its turn-away or eat came with 3 s or less left, or it was still running. |
| Gave up very early | Not engaged, but the final chase was a turn-away from a reachable ghost before the window: the player dropped a ghost they could have had and chased nothing after it. Stored as `gaveUpEarly`. |
| Eats | Time left for every ghost eaten. A catch with 1.5 s or less left is a late catch. |
| Exposure at the end | Distance to the nearest ghost that just turned dangerous (`endDist`), distance to the ghost of the final chase (`chaseEndDist`), and whether that chase was still running. |
| Aftermath | In the 3 s after the end: caught or not, time until caught, smallest distance to a dangerous ghost, near miss (within 1.5 tiles and survived). |
| Reaction | For a chase still running at the end: seconds after the end the player kept stepping toward the ghost. |
| Chase log | Every chase of the power-up: ghost, first step, turn-away moment, time left, distance, tiles closed, how it ended, distance at the end. Kept so that a later rule can choose again. |
| Series | 10 Hz samples from power start to end + 3 s: time left, distance to the nearest scared ghost, chasing flag (first step to turn-away of each chase), player tile. |

### Outcome of a trial

Rules version 3, in `convex/lib/rules.ts`, shared by the tracker and Convex; first that applies:

1. **interrupted** ("cut short"): the power did not run out by itself (death, level clear, the
   player left). A trial closed by leaving ends at the last frame seen, with the power left then.
2. **caught**: died within 3 s after the end to a ghost that had been scared, **and** when the
   power ended the player was within 5 tiles of a ghost that had just turned dangerous. The cue
   failed.
3. **not engaged** ("not chasing near the end"): no chase at all.
4. Otherwise the **final decision** decides:
   - it ended in an eat: **catch** ("caught the ghost") if that was in the warning window, else not
     engaged. Marked late with 1.5 s or less left. A catch shows no decision.
   - it was still running when the power ended (never turned, turned after the end, or with less
     than 0.2 s left): **overstayed** ("stayed too long") if the chased ghost was within 5 tiles at
     that moment, else **other**.
   - the player turned away with 0.2 s or more left from a **reachable** ghost: **timely retreat**
     ("turned away in time") with 2 s or less left, **early retreat** ("turned away too early")
     with more. That includes giving up before the warning window.
   - the player turned away from a ghost that was out of reach: **other** inside the warning
     window, not engaged before it.

A death after the end that does not meet rule 2 leaves the class as it is; it is still recorded in
the aftermath fields.

**Counts toward the rates** (`inRates`): the power ran out by itself, the player did not leave
during the aftermath, and the trial is engaged or the player gave up very early. This is settled by
what the player did while the power was on, never by how the aftermath went, so the denominator of
a rate cannot depend on its numerator. (A player who was not chasing and walked into a ghost as it
turned is recorded as caught, outside the rates.)

Why each threshold:

- **Catches are excluded from the rates.** Eating a ghost shows the player was chasing, not
  whether they knew the time left; a player chasing blindly who happens to eat a ghost in the last
  second looks exactly like one who judged it well.
- **"Caught" needs 5 tiles.** A player who turned away in good time and was 7 tiles from any ghost
  when the power ended, then died 2 s later, did not misjudge the end.
- **"Stayed too long" needs the chased ghost within 5 tiles at the end**, the same 5 tiles. Player
  and ghost running at each other (5.6 + 5.25 tiles/s) close that gap in under half a second,
  less than it takes to notice and turn round: the player was exposed. Still running toward a
  ghost 6 tiles off is harmless and shows nothing about what the player knew.
- **Retreats need a reachable ghost.** With 0.5 s left a ghost 4 tiles away cannot be caught
  (0.5 x 5.6 = 2.8). Turning away from it is not a decision about timing: any player would. "Held
  still" was chosen as the neutral guess for a scared ghost that turns at random; 5.6 tiles/s is
  the player's plain speed, on the cautious side of the 6.2 they have with the power on. Under
  study rules a scared ghost runs away, so "reachable" is now generous: a ghost 4 tiles ahead with
  2.5 s left counts as reachable although the pursuit would need about 2.7 s. The rule was left as
  it is (it decides classes; changing it is a new rules version). What it means is under "What
  this measure cannot do".
- **0.2 s** is where "in time" ends: under a fifth of a second before the end is no margin at
  all, about one reaction time; it is counted as staying too long.
- **Giving up very early counts as "too early".** If such trials stayed outside the rates, a cue
  that scares players off long before the end would lose its worst trials and look better than it
  is: the well-timed rate would be computed over the few who stayed. A ghost within 6 tiles with
  more than 3 s left can always be caught, so dropping it and chasing nothing else wastes the
  power, which is what "too early" means. The cost: a chase given up early for another reason (a
  dangerous ghost in the way, the dots looked better) also lands here, for every cue alike. That
  blurs the rate a little but does not favour a cue, whereas leaving these trials out would. The
  share is stored (`gaveUpEarly`) so it can be shown apart, and `wasted` records the seconds.
- **2 s, and the cues' final warning.** Every cue (except "no signal") switches to its final
  warning with 2 s left, and the classic blink starts there. The line between "in time" and "too
  early" sits on the same 2 s, on purpose: "turned away in time" then reads "left during the final
  warning", the thing the warning is for. It has one consequence to keep in mind. A player who
  reacts to the start of the warning turns a few tenths of a second after it and is always in
  time; a player who reads a steady cue and leaves a few tenths *before* the warning is "too
  early" by the same few tenths. So right at the line the classes are harsher on anticipating
  than on reacting. Moving the line would not remove this (any line near a cue event has it); what
  keeps it honest is that the turn-away time is stored for every trial: look at its distribution
  beside the rates, and recompute the rates with the line at 2.5 s as a check (one constant,
  `TIMELY`, and `admin.reclassify`). In the simulated runs below, 30% of "too early" lay between
  2.0 and 2.5 s, and 31% of "in time" between 1.5 and 2.0 s. The classic blink gives no information
  before 2 s, so a blink player cannot be "too early" by reading the cue, only by guessing: that is
  a property of that cue, not of the measure.

Each trial stores `rulesVersion` and the raw measures the rules read (`lastChaseEnd`, `turnLeft`,
`turnDist`, `chaseEndDist`, `endDist`, `engaged`, the aftermath, the chase log). The raw measures
are the source of truth: `admin.reclassify` recomputes outcome, eligibility, wasted power and
`gaveUpEarly` from them. Rows recorded before version 3 were measured with another idea of a chase
and lack `chaseEndDist`; they keep their class and their old version and are left out of every rate.

### What this measure cannot do

- **It cannot read intent.** A player who ignores the ghosts and eats dots still runs toward some
  ghost within 6 tiles for 3 tiles now and then. A scripted player that never looks at ghosts
  produced a "decision" in about one power-up in six (10 of 64), most of them "too early". This noise is the
  same for every cue; it lowers contrast, it does not create a ranking.
- **"Too early" is judged by the clock, not by the distance.** Leaving a ghost 5 tiles away with
  2.3 s left is "too early" although catching it would have eaten most of that time. The stored
  turn-away time and distance allow a finer measure (time to spare after reaching the ghost).
- **Decision trials were scarce under the first study rules**: one power-up in six. With fleeing
  ghosts it is one in three (see "Study-rule levers"), still far from every power-up. Plan the
  number of participants and the length of a run for that ("How long a run is").
- **Some "too early" is a judgement of the chase, not of the clock.** A fleeing ghost is gained on
  at about 1.5 tiles a second. A player who sees a chase will not close in time and turns away
  with 2.5 s left is "too early" by the clock although they judged the chase well. This affects
  every cue alike and does not create a ranking, but it puts a floor under "too early" that a
  perfect clock cannot remove. The stored turn-away distance allows a finer measure (was the ghost
  catchable at the gain it was being chased at?).
- **A run at a ghost that starts in the last half second is not a chase.** The 3 tiles have to be
  closed while the power is on. A player who sets off 0.4 s before the end and runs on after it is
  recorded by the death, if there is one ("caught"), not as "stayed too long".

### Study-rule levers

The measures above only see a decision when a player is going after a scared ghost while the
power runs out. Under the first study rules (scared ghosts turning at random at 3.6 tiles/s)
about one power-up in six did. Where the others went, measured with the real tracker over 300
simulated 90 s blocks per column (`src/lib/sim/yield.ts`, `YIELD=1 npx vitest run
src/lib/sim/yield.test.ts`; flat awareness, the simulator's mix of participants):

| Where a power-up went | First study rules, planned chases | First study rules, eager chases | Fleeing ghosts, planned | **Fleeing ghosts, eager (now)** |
| --- | --- | --- | --- | --- |
| A decision (in time, too early, too late) | 17% | 23% | 24% | **37%** |
| Caught a ghost in the warning window | 29% | 32% | 14% | **23%** |
| Chasing near the end, no clear decision | 1% | 2% | 2% | 4% |
| Cut short (died while the power was on) | 10% | 10% | 11% | 10% |
| Participant ignored this power-up | 7% | 7% | 6% | 7% |
| Ate one ghost early, the rest out of range | 13% | 10% | 5% | 4% |
| A scared ghost out but never within 6 tiles near the end | 10% | 6% | 19% | 6% |
| One within 6 tiles, but the player believed the power over | 4% | 5% | 5% | 4% |
| One within 6 tiles, not chased | 9% | 6% | 13% | 4% |
| No scared ghost out near the end | 0% | 0% | 0% | 0% |
| Decisions per minute of play | 0.69 | 0.94 | 0.99 | **1.54** |
| Ghosts eaten per power-up | 0.94 | 1.01 | 0.39 | 0.62 |
| Deaths per minute | 0.44 | 0.47 | 0.38 | 0.45 |
| Score per minute | 2,448 | 2,461 | 1,975 | 2,077 |

"Planned" is the simulated player of model version 1: it goes after a ghost only while it believes
it can reach it before the power runs out. "Eager" (model version 2) goes after any scared ghost it
can reach safely until it believes the power is about to end, the way people chase.

So power-ups did not start without targets (3.2 of 4 ghosts are out and scared at the start); they
were lost because chases ended too soon: the ghost was caught early, or wandered off out of range.
The levers, chosen on that evidence (`STUDY_CONFIG` in `src/lib/game/engine/game.ts`):

- **Scared ghosts flee** (`scaredFlee`: radius 7 tiles, 25% random). At each junction a scared ghost
  within 7 tiles (path distance) of the player takes the exit that leads farthest from it; at one
  junction in four it turns at random, so it can still be cornered. Farther away it wanders at
  random as before, so a far ghost may come the player's way. Ghosts still never turn back in a
  corridor, so a ghost heading toward the player keeps coming and can be caught head-on. Measured
  at junctions within the radius: 84% take the farthest exit under study rules, 53% under arcade
  rules (`game.test.ts`).
- **Scared ghosts run at three quarters of the player's power-up speed** (`scaredSpeedShare` 0.75:
  4.7 tiles/s against 6.2). A pursuit closes about 1.5 tiles a second, so a chase started 5 tiles
  away lasts about 3 s and is often still under way when the power runs out.
- Neither depends on the time left: the rule and the speed are the same for the whole power-up
  (`game.test.ts` plays two games that differ only in power length and checks that every ghost is
  in the same place until the shorter power ends).

Tried and left out: releasing ghosts from the pen every 2 s whatever the dots eaten (+1 point of
decisions: the ghosts are out already), power dots growing back after 8 s instead of 12 (+4% power-ups
per minute: the lock after each power-up decides the rhythm), a radius of 5, 6 or 10 tiles and
speeds of 0.7, 0.8 and 0.85 (0.7 keeps more catches, 27%, for fewer decisions, 34%; 0.8 and above
leave too few catches).

The game stays fair and playable: deaths per minute are unchanged, fewer ghosts are eaten (0.62
against 1.01 per power-up; score per minute 16% lower). A scripted keyboard player that simply runs
at the nearest scared ghost on the real page caught 9 ghosts in 8 power-ups.

### How long a run is

Under the final study rules a power-up comes about every 15 s and 36% of them end in a decision.
The run console sets a **run length** in power-ups (8, 12, 16, 24 or no limit; default **16**, about
4 minutes and 5 to 6 decisions). When the last power-up has been measured, aftermath included, the
run ends by itself and shows its summary; End run still ends it early. The play screen shows
"Decisions measured this run" outside participant view, updated only when a trial closes.

Why 16: planted versus recovered without Convex (`src/lib/sim/recover.test.ts`, `RECOVER=1`), 40
simulated participants, all 13 conditions, the dashboard's paired Holm comparison:

| Power-ups per run | Minutes per run | Decisions per condition | Rank correlation with planted noise (in time / too late / too early) | Pairs clearly apart on "in time" |
| --- | --- | --- | --- | --- |
| 8 | 2 | 103-125 | -0.96 / 0.90 / 0.74 | 11 of 78 |
| 12 | 3 | 156-186 | -0.95 / 0.94 / 0.96 | 14 of 78 |
| **16** | **4** | 207-254 | -0.99 / 0.97 / 0.88 | **22 of 78** |
| 24 | 6 | 318-357 | -0.99 / 0.98 / 0.89 | 24 of 78 |
| 16, flat preset | 4 | 222-253 | no relation (none planted) | 0 of 78 |

Beyond 16 the gain is small for half as much time again. Thirteen runs of 16 power-ups are about 50
minutes of play per participant; if that is too long for one sitting, split the cases over two
sittings rather than shortening the runs.

### Checked against recorded data

The definition was fixed with players whose intent is known (scripted pilots and the simulated
player with and without ghost-chasing), then checked on stored simulated runs in three ways. The
scripts are `src/lib/sim/audit.ts`, `audit.test.ts` and `.shots/measures/` (scan, calibration).

**1. An independent reading of every clip.** `audit.ts` works out the outcome of a trial again
from the scenes of its replay clip, with its own path distances, its own chase detection and its
own rules, typed in from this document; it shares no code with the tracker or the rules and sees
the game at 20 frames a second where the tracker saw 60.

| Run (30 simulated participants each) | Clips audited | Same outcome | Different |
| --- | --- | --- | --- |
| Planted, `v3u1an6y` | 1,097 | 1,085 (98.9%) | 12 |
| Flat, `v6zkvjx1` | 1,105 | 1,097 (99.3%) | 8 |

All 20 differences sit on a line where the two frame rates land on either side: 15 on "3 tiles of
own approach" (3 of them counted at the end of the power), 3 on "5 tiles at the end", 2 on the 2 s
line. Turn-away times agree to 0.02 s in the median (0.04 s at the 95th percentile). All 88 clips
of a trial that ended in a death end on the death. Under rules version 2 the same kind of audit
agreed on 193 of 203 trials (95%) and 17 of 18 death clips stopped before the death. The audit
also found three things that are fixed above: a death on the very frame the power ran out was
filed as "died during the power"; a run that began on the last frame before the end could become
a chase through steps taken after it; and of two chases running at the end the farther ghost could
decide.

**2. The scan of the stored series** (10 Hz samples, not the class rules), before and after:

| Check | Rules v2 (2,334 trials) | Rules v3 (`v3u1an6y` + `v6zkvjx1`, 4,443 trials) |
| --- | --- | --- |
| Decision trials | 1,213 (52%) | 729 (16%) |
| "In time", but the nearest scared ghost was out of reach at the player's speed | 354 of 727 (49%) | 1 of 319 (0.3%) |
| ... out of reach even at 11 tiles/s | 149 of 727 (20%) | 0 of 319 |
| Decision trials that turn from 7 tiles or more | 231 of 1,195 (19%) | 0 of 701 |
| "Stayed too long", more than 5 tiles from every ghost at the end | 193 of 269 (72%) | 0 of 89 |
| Decision trials engaged only through a blip | 22 | 0 (5 turned within 0.05 s of the 3 s line, after chases of 0.5 s or more) |
| Last chase of one series sample or less | 61 | 0 (shortest last chase 0.39 s, 3.0 tiles) |
| "Stayed too long", but closest with 0.2 s or more left and the gap grew after | 18 of 269 | 1 of 89 (it left one ghost and ran at a second through the end: the class is right) |
| A turn-away stored at the moment of an eat | 21 | 0 |
| Trials that "end" before they start | 165 | 0 |
| Engaged trials closed by leaving, without a clip | 47 of 47 | 0 of 61 |
| Decision trials whose aftermath was cut by a new power-up | 406 (33%) | 0 (the engine keeps power dots off the board) |

**3. Planted versus recovered.** The simulator gives each condition a declared awareness (noise
in seconds); the pipeline should find that ranking again, and nothing in a flat run. Three pairs of
30-participant runs under rules version 3 (the first two before the last two refinements, which
change the class of fewer than 1 trial in 200):

| Planted run | Rank correlation with planted noise: in time | too late | too early | Pairs of conditions clearly apart |
| --- | --- | --- | --- | --- |
| `u7xd8pxf` | -0.77 | 0.90 | 0.12 | 9 of 78 |
| `uoocl6ce` | -0.69 | 0.87 | -0.23 | 10 of 78 |
| `v3u1an6y` (final rules) | -0.54 | 0.42 | 0.21 | 0 of 78 |
| The three pooled (90 participants) | -0.82 | 0.86 | 0.16 | not computed |

Flat runs `ubzd01cu`, `uscnvkm9`, `v6zkvjx1` (final rules): 0, 0 and 7 of 78 pairs "clearly
apart". The 7 all come from one condition that reached 75% in time on 20 decisions by chance.
Under rules version 2 a planted run gave -0.48 and 0.52 with 2 pairs.

Read this as follows. The measure itself follows what was planted: against the simulated player's
own error about the time left, underestimating by more than a second gives about 90% "too early",
being right about 75% "in time" and none "too late", overestimating by more than a second 60 to
90% "too late". Pooled over 90 participants the well-timed rate splits cleanly (49 to 54% for the
seven conditions with the least noise, 21 to 39% for the six with the most), and the share that
gave up before the warning window tends to rise with the noise (10 to 22% of decisions against 16
to 30%; rank correlation 0.57). But **30
participants are too few under these rules**: with 20 to 40 decision trials per condition a run can
miss the ranking or show a difference that is not there. A pipeline check needs about 90 simulated
participants, and the same arithmetic applies to people. "Too early" does not follow the planted
noise in simulated data for a reason that lies in the simulated player, not in the measure
(`src/lib/sim/model.ts`): it gives up distant ghosts early even when it knows the time, and when it
believes the power is over it never starts a chase, which leaves nothing to judge.

## Headline numbers per cue

Every rate divides by **decision trials** = caught + overstayed + timely retreat + early retreat,
among the trials that count toward the rates (rules version 3). These are the trials whose ending
shows whether the player knew the time left. On the dashboard "counted" means decision trials.

- **Well-timed rate** (the headline): timely retreats / decision trials. Higher is better.
- **Too-late rate**: (caught + overstayed) / decision trials. Lower is better. Its worst part, the
  **caught rate** (caught / decision trials), is shown with it.
- **Too-early rate**: early retreats / decision trials. Lower is better. The part that **gave up
  before the warning window** (`gaveUpEarly`) can be shown with it.
- **Catches** are reported apart: count, share of the trials that count toward the rates, and how
  many were late. They are in no rate's denominator.
- **Intervals**: 95%, clustered by participant: a seeded bootstrap over participants (2,000
  resamples; resample participants with replacement, pool their decision trials, take the 2.5th
  and 97.5th percentiles of the pooled rate), because the power-ups of one person are not
  independent. A condition with fewer than 3 participants, or a rate with no event at all (or only
  events), where the bootstrap collapses to a point, falls back to a 95% Wilson interval; the
  dashboard says which was used. Learning curves and pooled channel views use Wilson.
- **Turn-away time**: median and spread over decision trials. About 1 s is ideal; large values
  mean the player bailed out early because they could not tell how much time was left. Read it
  beside the rates: it does not depend on where the 2 s line is.
- **Wasted power**: mean seconds of power left unused after an early retreat.
- **Clarity and distraction ratings** from the questionnaire.
- Always show the number of trials and participants behind each figure.

## Replay clips

For every engaged trial, every trial that counts toward the rates and every caught trial, store a
clip: scenes at 20 Hz from 8 s before the power ends (or its start: under study rules that is the
whole power-up) to 3 s after, with the maze id, a dots snapshot, the cue, and markers (power
start, each eat, turn-away, power end, death). A clip always ends on the frame that closed the
trial, so the clip of a caught trial ends on the death itself (the `die` event, the dying phase).
The replay page redraws the clip with the real renderer and cue, so the viewer sees the exact
moment the ghosts switch and what the player did about it. Because a clip holds everything the
measure saw, the stored outcome of any trial can be checked against it by hand or by the audit.

## The live panel

The participant can see the screen, and only the cue may tell them how much power is left. While a
power-up runs, the tracker's live readout carries no clock, no power length and nothing judged
against the warning window: only the distance to the nearest scared ghost and whether the player is
going after one. An outcome is available once the trial is closed, 3 s after the power ran out.

## Honesty rules for the dashboard

- Never show a rate without its sample size. Flag cues with fewer than 10 decision trials as "not
  enough data".
- Human and bot data are separate views. Bot data carries a visible "simulated" label.
- Definitions above are shown in the dashboard (tooltips or a "How this is measured" panel).
