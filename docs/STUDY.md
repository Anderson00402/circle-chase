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
  power-up runs at a time, lives are unlimited and the maze and speeds never change, so a
  1-2 minute run gives several comparable trials (deaths are still recorded).
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

Behaviour (definitions the tracker must implement; distances are **path distances through the
maze** in tiles, to the nearest scared ghost that is out of the pen):

| Measure | Definition |
| --- | --- |
| Chasing | The distance to the nearest scared ghost within 8 tiles has been shrinking over the last 0.3 s, or is at most 1 tile. |
| Engaged | The player was chasing at some point in the last 3 s of the power ("the warning window"). Unengaged trials are kept but left out of the rates. |
| Final decision | The last chase of the trial (the last one running in the warning window or after it), and how it ended: turned away, ate the ghost (no chase began after it), or still running when the trial closed. |
| Turn-away time | Time left on the power at the moment the player was closest before they stopped closing in for good on that last chase. This is when they decided to quit. Negative when they only turned after the power had ended; 0 when they were still closing in at the end and stopped right then. For a chase that ended in an eat, the time left at the eat. |
| Turn-away distance | Distance to the ghost at that moment. |
| Eats | Time left for every ghost eaten. A catch with 1.5 s or less left is a late catch. |
| Exposure at the end | Distance to the nearest ghost that just turned dangerous, and whether the player was still closing in. |
| Aftermath | In the 3 s after the end: caught or not, time until caught, smallest distance to a dangerous ghost, near miss (within 1.5 tiles and survived). |
| Reaction | For players still chasing at the end: time from the end until they first move away. |
| Series | 10 Hz samples from power start to end + 3 s: time left, distance, chasing flag, player tile. |

Outcome of a trial (rules version 2, in `convex/lib/rules.ts`, shared by the tracker and Convex;
first that applies). A trial is **engaged** when the player was chasing at some point in the
warning window (the last 3 s, or the whole power if shorter). For an engaged trial the outcome
comes from its **final decision**, the last chase:

1. **caught** ("caught"): died within 3 s after the end to a ghost that had been scared, **and**
   when the power ended the player was within 5 tiles (path distance) of a ghost that had just
   turned dangerous. The cue failed.
2. **catch** ("caught the ghost"): the last chase ended by eating the ghost and no further chase
   began before the power ended. Marked late when eaten with 1.5 s or less left. Shows no decision.
3. **overstayed** ("stayed too long"): the last chase was still running when the power ended
   (turned away with less than 0.2 s left, after the end, or never), and not caught.
4. **timely retreat** ("turned away in time"): turned away from the last chase with 0.2-2 s left.
5. **early retreat** ("turned away too early"): turned away with more than 2 s left while a ghost
   was still reachable.
6. **other**: engaged, but none of these fits (in practice: turned with more than 2 s left and no
   ghost reachable, which the chase range of 8 tiles makes all but impossible).
7. **not engaged**: no chase in the warning window (an early retreat before the window is kept as
   early retreat, outside the rates). **interrupted**: the power did not run out by itself.

A death after the end that does not meet the "caught" rule leaves the class as it is; it is still
recorded in the aftermath fields. Every engaged trial whose last chase ended in a turn-away lands in
exactly one of timely, early or overstayed.

Why catches are excluded from the rates: eating a ghost shows the player was chasing, not whether
they knew the time left; a player chasing blindly who happens to eat a ghost in the last second
looks exactly like one who judged it well.
Why "caught" needs proximity: a player who turned away in good time and was 7 tiles from any ghost
when the power ended, then died 2 s later, did not misjudge the end; only a death that follows
from being close to a ghost as it turned dangerous says the cue failed.

Each trial stores `rulesVersion`. The raw measures are the source of truth: `admin.reclassify`
recomputes every outcome from them. Rows recorded before version 2 lack the last chase's ending,
so they keep their old class, are marked version 1 and are left out of every rate.

## Headline numbers per cue

Every rate divides by **decision trials** = caught + overstayed + timely retreat + early retreat,
among engaged trials whose power ran out by itself and whose aftermath the player stayed for
(rules version 2). These are the trials whose ending shows whether the player knew the time left.
On the dashboard "counted" means decision trials.

- **Well-timed rate** (the headline): timely retreats / decision trials. Higher is better.
- **Too-late rate**: (caught + overstayed) / decision trials. Lower is better. Its worst part, the
  **caught rate** (caught / decision trials), is shown with it.
- **Too-early rate**: early retreats / decision trials. Lower is better.
- **Catches** are reported apart: count, share of engaged trials (eligible as above), and how
  many were late. They are in no rate's denominator.
- **Intervals**: 95%, clustered by participant: a seeded bootstrap over participants (2,000
  resamples; resample participants with replacement, pool their decision trials, take the 2.5th
  and 97.5th percentiles of the pooled rate), because the power-ups of one person are not
  independent. A condition with fewer than 3 participants, or a rate with no event at all (or only
  events), where the bootstrap collapses to a point, falls back to a 95% Wilson interval; the
  dashboard says which was used. Learning curves and pooled channel views use Wilson.
- **Turn-away time**: median and spread over decision trials. Close to 0.5-1 s is ideal; large
  values mean the player bailed out early because they could not tell how much time was left.
- **Wasted power**: mean seconds of power left unused after an early retreat.
- **Clarity and distraction ratings** from the questionnaire.
- Always show the number of trials and participants behind each figure.

## Replay clips

For every engaged trial (and every caught trial) store a clip: scenes at 20 Hz from 6 s before the
power ends (or its start) to 3 s after, with the maze id, a dots snapshot, the cue, and markers
(power start, each eat, turn-away, power end, death). The replay page redraws the clip with the
real renderer and cue, so the viewer sees the exact moment the ghosts switch and what the player
did about it.

## Honesty rules for the dashboard

- Never show a rate without its sample size. Flag cues with fewer than 10 decision trials as "not
  enough data".
- Human and bot data are separate views. Bot data carries a visible "simulated" label.
- Definitions above are shown in the dashboard (tooltips or a "How this is measured" panel).
