# What we measure, and why

## Question

**Do players know when the power-up is about to run out, and which cue tells them best?**

A power-up makes ghosts edible for a few seconds. If a player knows how much time is left, they
chase right up to the end and get out in time. If they do not, they either give up early (wasting
the power) or keep chasing a ghost that turns on them (and get caught). So the player's own
behaviour around the end of each power-up tells us whether the cue worked. We compare eleven cues:
the timer bar (baseline) and ten alternatives.

## Unit of analysis: the trial

One **trial** = one power-up, from eating the power dot until 3 s after the power ends.

## Design

- **Within-subject.** In study mode a participant plays one block per cue. Block order is
  counterbalanced (balanced Latin square row picked by participant number, or a seeded shuffle for
  shorter sessions) so no cue always benefits from practice.
- **Random power length.** In study mode each power-up lasts a random 4-8 s. With a fixed length
  players would simply learn the rhythm; with a random one the cue is the only way to know.
- **Many trials.** Power dots grow back after 12 s and lives are unlimited, so a 90 s block gives
  several trials and a death never ends the session (deaths are still recorded).
- **Self-report.** After each block: "I could tell when the power was about to run out" and "The
  signal got in the way of playing", both 1-7. At the end: pick the clearest and the least clear.
- Arcade mode also records trials (fixed lengths, real lives), tagged `mode: 'arcade'`.
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
| Turn-away time | Time left on the power at the moment the player was closest before they stopped closing in for good. This is when they decided to quit. Negative when they only turned after the power had ended. |
| Turn-away distance | Distance to the ghost at that moment. |
| Late catch | A ghost eaten with 1.5 s or less left. Also record time left for every eat. |
| Exposure at the end | Distance to the nearest ghost that just turned dangerous, and whether the player was still closing in. |
| Aftermath | In the 3 s after the end: caught or not, time until caught, smallest distance to a dangerous ghost, near miss (within 1.5 tiles and survived). |
| Reaction | For players still chasing at the end: time from the end until they first move away. |
| Series | 10 Hz samples from power start to end + 3 s: time left, distance, chasing flag, player tile. |

Outcome of a trial (first that applies):

1. **caught**: died within 3 s after the end to a ghost that had been scared. The cue failed.
2. **late catch**: ate a ghost in the last 1.5 s. The player used the time to the limit.
3. **overstayed**: still closing in when the power ended, within 5 tiles, and survived.
4. **timely retreat**: turned away with 0.2-2 s left.
5. **early retreat**: turned away with more than 2 s left while a ghost was still reachable.
6. **not engaged**: no chase in the warning window.

## Headline numbers per cue

- **Caught rate**: caught / engaged trials. Lower is better. The clearest sign the player did not
  know the end was coming.
- **Well-timed rate** ("awareness"): (late catch + timely retreat) / engaged trials. Higher is
  better. Shown with a 95% Wilson interval, because sample sizes are small.
- **Turn-away time**: median and spread. Close to 0.5-1 s is ideal; large values mean the player
  bailed out early because they could not tell how much time was left.
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

- Never show a rate without its sample size. Flag cues with fewer than 10 engaged trials as "not
  enough data".
- Human and bot data are separate views. Bot data carries a visible "simulated" label.
- Definitions above are shown in the dashboard (tooltips or a "How this is measured" panel).
