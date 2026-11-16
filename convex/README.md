# Convex: study data

> **Trial rows no longer hold the 10 Hz series** (since 2026-11-16). It lives in `trialSeries`
> (one row per trial: `trialId`, `sessionId`, `cue`, `source`, `mode`, `createdAt`, `simRun?`,
> `series`; indexes `by_trial`, `by_source_cue` [source, cue, createdAt], `by_run` [simRun, cue,
> createdAt]). Read one with the query `trials.series({ trialId })` (unpacked arrays) or, inside
> Convex, `packedSeriesOf(ctx, trial)` from `convex/trials.ts`. `trials.series` on a trial row is a
> legacy optional field that is always empty after `migrations.slimTrials`; do not read it.
> Simulated trials carry `simRun` (the session's `sim.run`), and the shared filter takes `run`.

Everything the game measures lives here. What each measure means is defined in
`docs/STUDY.md`; how it is computed is in `src/lib/telemetry/tracker.ts` (header comment) and
summarised under "Interpretations" below.

Local deployment, no account: data is in `.convex/`, the API at `http://127.0.0.1:3210`, HTTP
routes at `http://127.0.0.1:3211`. `npm run convex` pushes this folder on save.

```svelte
<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	const summary = useQuery(api.summary.byCue, () => ({ source: 'human', mode: 'study' }));
</script>
```

## Conventions

- **source**: every row is `human` or `bot`. Read queries take `source: 'human' | 'bot' | 'all'`
  and default to `human`, so bot data never mixes in unless asked for. A browser driven by
  automation (`navigator.webdriver`) or a URL with `?bot` records as `bot`.
- **Keys**: the browser makes a `key` for every session, block, trial and rating. Writes with a
  key that already exists return the existing row, so retries never duplicate.
- **Times**: `createdAt`, `startedAt`... are server ms since 1970. Inside a trial (`startedAt`,
  `endedAt`, `eats[].t`, `turnAt`, series `t`) times are game seconds.
- **Filter** (`Filter`), accepted by every read query marked "filter":
  `{ source?, mode?: 'study'|'arcade', cue?, from?, to?, participantId?, sessionId? }`
  (`from`/`to` are server ms, inclusive).

## Tables

| Table | One row per | Notes |
| --- | --- | --- |
| `participants` | browser (anonymous id in localStorage) or bot | `number` 1, 2, 3... (for the counterbalanced cue order), `nickname?`, `device`, first/last seen |
| `sessions` | visit | `mode`, `source`, `cueOrder`, `appVersion`, `difficulty`, `sound`, `reducedMotion`, `inputType`, `viewport`, started/ended, counters |
| `blocks` | cue played within a session | `cue`, `orderIndex`, started/ended, `trialCount`, `engagedCount`, `deaths`, `score` |
| `trials` | power-up | context + every measure of `TrialMeasures` (`src/lib/telemetry/types.ts`), including `lastChaseEnd` and `rulesVersion`; the 10 Hz series packed as bytes (~1 KB); `clipId?` |
| `clips` | stored replay (engaged or caught trials) | packed scenes (`data`, 5-15 KB), `markers`, `numbers`, `cue`, `outcome`; separate so trial scans stay light |
| `ratings` | questionnaire answer | `kind: 'block'` (clarity, distraction 1-7) or `'session'` (clearest, leastClear, comment) |
| `presence` | open game page | heartbeat every 5 s; rows older than 20 s are swept by a cron |
| `counters` | source (`human`, `bot`) | running totals for `live.counters`: trials, engaged, inRates, decisions, clips, sessions, participants, lastTrialAt; kept by `participants.ensure`, `sessions.start`, `trials.save` (practice trials not counted) |

## Write side (used by `src/lib/telemetry/client.svelte.ts`)

| Function | Arguments | Returns |
| --- | --- | --- |
| `participants.ensure` | `{ pid, source, device, nickname? }` | `{ participantId, number }` |
| `sessions.start` | `{ key, pid, mode, source, cueOrder, appVersion, difficulty, sound, reducedMotion, inputType, viewport }` | `{ sessionId }` |
| `sessions.update` | `{ key, inputType?, sound?, reducedMotion?, end? }` | session id or null |
| `blocks.start` | `{ key, sessionKey, cue, orderIndex }` | `{ blockId }` |
| `blocks.end` | `{ key, deaths, score }` (last call wins) | block id or null |
| `trials.save` | `{ key, sessionKey, blockKey, trialIndex, sound, reducedMotion, inputType, appVersion, difficulty, ...measures, series: bytes, clip? }`; the outcome is recomputed from the measures (`convex/lib/rules.ts`), a write without `lastChaseEnd` is stored as `rulesVersion: 1` | `{ trialId, clipId }` |
| `ratings.saveBlock` | `{ key, blockKey, clarity: 1-7, distraction: 1-7 }` | rating id |
| `ratings.saveSession` | `{ key, sessionKey, clearest?, leastClear?, comment? }` | rating id |
| `presence.heartbeat` | `{ sessionKey, pid, cue, mode, source, state: 'playing'\|'idle', score, level, powerLeft, nickname? }` | row id |
| `presence.leave` | `{ sessionKey }` | - |
| `blocks.start` | also takes `mode?` (rules of this run, when they differ from the session's) | |
| `runs.setup` | `{ sessionKey, run: { participantLabel, participantNumber, orderRow } }` | session id, or null until the session exists |
| `runs.markBlock` | `{ blockKey, pauses?, pausedSeconds? }` | block id, or null until the block exists |

Cue, mode, source, participant and block index of a trial are taken from its block and session,
not from the caller.

## Read side

| Query | Arguments | Returns |
| --- | --- | --- |
| `summary.byCue` | filter | `{ source, cues: CueSummary[], all: CueSummary, scanned }` (see below) |
| `trials.list` | filter + `outcome?`, `engagedOnly?`, `paginationOpts` | Convex page of trials, newest first, **without** `series` |
| `trials.get` | `{ id }` | trial + `series: { t, left, dist, chasing, px, py }` (arrays) + `clipId`, `participant { number, nickname }`, `block { cue, orderIndex, trialCount }`; null if missing |
| `clips.byTrial` | `{ trialId }` | clip row with `data` (decode with `decodeClip`) or null |
| `clips.get` | `{ id }` | clip row with `data` or null |
| `clips.moments` | `{ cue?, outcome?, source?, paginationOpts }` | page of clips newest first, **without** `data` (`trialId`, `cue`, `outcome`, `markers`, `numbers`, `mazeId`, `level`, `t0`, `t1`, `scenes`, `size`, `createdAt`, `source`, `mode`) |
| `sessions.overview` | `{ source?, mode?, limit? = 50 }` | sessions newest first with `participant { number, nickname }` and `blocks[]` |
| `participants.overview` | `{ source? }` | participants with `sessions`, `studySessions`, `trials` counts, most recently seen first |
| `live.counters` | `{ source?, now? }` | `{ trials, engaged, inRates, decisions, clips, sessions, participants, lastMinute, lastTrialAt, nowPlaying, playing[] }` from the `counters` table plus an index range for the last minute (no trial scan) |
| `presence.nowPlaying` | `{}` | presence rows updated in the last 20 s (no `pid`) |
| `runs.session` | `{ sessionKey }` | the run sheet: `participant`, `run` info, `runs[]` (one per block: `cue`, `orderIndex`, `mode`, `trials`, `counted` decisions, `wellTimed`, `caught`, `catches`, `clips`, `outcomes`, `clarity`, `distraction`); null until the session exists |
| `runs.block` | `{ blockKey }` | one run for its summary: the same tally plus `rows[]` (each trial: `outcome`, `counted`, `total`, `turnLeft`, `eats`, `clipId`) and its rating; null until the block exists |
| `exports.trials` | filter + `format: 'csv'\|'json'` | `{ filename, contentType, rows, body }`; CSV is one flat row per trial (52 columns, no series; includes `rulesVersion`, `decision`, `catchLate`, `lastChaseEnd`), JSON is full rows with the series unpacked and `decision` |

HTTP downloads with the same filter as query parameters:
`GET http://127.0.0.1:3211/export/trials.csv?source=human&mode=study` (and `trials.json`).

`live.counters.lastMinute` updates whenever a trial arrives; pass `now` and refresh it every few
seconds if it must also fall back to 0 while nobody plays.

### `CueSummary` (from `convex/lib/stats.ts`)

```ts
{
  cue, trials, engaged, inRates, decisions, participants, decisionParticipants,
  outcomes: Record<Outcome, number>,           // all trials of the cue
  wellTimed: { k, n, rate, lo, hi, method },   // timely retreat / decisions: the headline
  tooLate:   { k, n, rate, lo, hi, method },   // (caught + overstayed) / decisions
  caught:    { k, n, rate, lo, hi, method },   // caught / decisions (worst part of too late)
  tooEarly:  { k, n, rate, lo, hi, method },   // early retreat / decisions
  interval: 'bootstrap' | 'wilson',            // participant bootstrap; Wilson under 3 people
  catches: { n, late, share },                 // catches; share of inRates; in no rate
  turnAway:  { n, q10, q25, median, q75, q90, mean, values[] },  // turnLeft of decision trials
  wasted:    { n, ..., mean, values[] },       // power left after early retreats
  nearMisses, oldRules,                        // oldRules: rulesVersion 1 rows, in no rate
  clarity: { n, mean }, distraction: { n, mean },               // block ratings
  notEnoughData                                // decisions < 10
}
```

`inRates` (stored on each trial) = engaged, the power ran out by itself (`endReason: 'expired'`),
and the player did not leave during the aftermath. **Decision trials** (the denominator of every
rate, `isDecision` in `convex/lib/rules.ts`) are the `inRates` trials of rules version 2 whose
outcome is caught, overstayed, timely retreat or early retreat. Catches, other and rows of older
rules are not decisions. `dashboard.points`, `recent` and `sessions` report `inRates` as "is a
decision trial".

Intervals: `clusteredRates` resamples participants with replacement 2,000 times (seeded by the
condition and its counts, so the same data gives the same interval), pools their decision trials
and takes the 2.5th and 97.5th percentiles; with fewer than 3 participants it returns Wilson, and
so does a rate with k = 0 or k = n (the bootstrap would collapse to a point). Each rate's `method`
says which was used.
`wilson` is kept for learning curves and small groups.

### Clips

Encoded by `src/lib/telemetry/recorder.ts` (`encodeClip` / `decodeClip`): 20 Hz scenes from 6 s
before the power ended (or its start, if later) to 3 s after; positions to 1/64 tile, times to
0.01 s, delta + varint packed. `decodeClip(clipRow)` returns `{ meta, scenes: Scene[], markers }`;
draw a scene with `renderScene(canvas, scene, { cue })`. Markers: `powerStart`, `eat` (with ghost
and time left), `turnAway`, `powerEnd`, `death`, each with game time `t`. `numbers` has outcome,
power length, turn-away time and distance, distance at the end, time to caught, eats, engaged.
Measured sizes: 5-12 KB per clip.

## Runs (the run console, `/`)

The researcher types a participant label ("P07"). Each label gets its own anonymous participant id
(`run-<uuid>`, or `bot-<uuid>` under automation) and one session; `sessions.run` holds the label,
the participant number and the row of the balanced Latin square used for the suggested order
(stored in `cueOrder`). Every run of a case is a block: `orderIndex` is its position in the
session, `mode` the rules of that run (trials and clips take their `mode` from the block, so a
session may mix study and arcade runs), `pauses` / `pausedSeconds` how often and how long the game
was paused. A refresh in the middle of a run closes that block (the power-up in progress is stored
as `interrupted`) and the next play starts a new block. `practice`, `abandoned` and `study` exist
only on rows from an earlier guided study flow and are no longer written.

## Clearing data

| Mutation | Arguments | Effect |
| --- | --- | --- |
| `admin.deleteBotData` | `{ confirm: 'delete bot data' }` | deletes every row with `source: 'bot'` in every table |
| `admin.wipeEverything` | `{ confirm: 'wipe everything' }` | deletes all rows of all tables (fresh demo); cannot be undone |
| `admin.reclassify` | `{ confirm: 'reclassify' }` | recomputes `outcome`, `rulesVersion` and `wasted` of every trial and the outcome of its clip from the stored measures; rows without `lastChaseEnd` keep their class and become `rulesVersion: 1`; recounts `counters` at the end |
| `counters.rebuildCounters` | `{ confirm: 'rebuild counters' }` | recounts the `counters` table from trials, sessions and participants |

The deleting ones work in batches and schedule themselves until done; they return
`{ deleted, continuing }`. `reclassify` and `rebuildCounters` run in the background (pages of 200
and 400 rows) and log a line to the Convex log when done.

## Interpretations of STUDY.md

Places where the definitions needed a concrete reading (full list in `tracker.ts`):

- Distances are continuous path distances (fractions of a tile between tile centres) with tunnel
  wrap, to ghosts that are out of the pen. During the power the targets are the scared ghosts;
  after it, the ghosts that were scared when it ran out.
- **Chasing** (during the power) is literal: nearest target within 8 tiles, closer than the same
  ghost 0.3 s of play earlier by more than 0.05 tiles, or at most 1 tile away. Game time stands
  still during the freeze after an eat, so it does not break a chase.
- **After the end** the ghosts hunt the player, so total distance shrinks even when fleeing. A
  chase running at the end continues only while the player's own steps still bring them closer
  (sum over 0.3 s below -0.05 tiles). No new chase starts after the end.
- **Final decision / turn-away**: the last chase of the trial (`lastChaseEnd`: turn, eat, open).
  Its moment is when the player was closest (latest moment within 0.05 tiles of the minimum), or,
  if that chase ran past the end, the last step after the end that still closed in (negative time
  left), or the end itself (0) when no step did. A chase ending in an eat turns at the eat
  (distance 0).
- **Outcome rules** live in `convex/lib/rules.ts` (`classify`), shared by the tracker and Convex.
  Caught needs `after.caught` and `endDist` of 5 tiles or less. Overstayed: the last chase is open
  or turned with less than 0.2 s left. This makes the turn-away classes contiguous: under 0.2 s is
  overstayed, 0.2-2 s timely, over 2 s early (with a ghost reachable).
- **Early retreat "while a ghost was still reachable"**: at the turn some scared ghost was out
  and within (time left x level-1 player speed, 7 tiles/s) tiles. Since chasing needs the ghost
  within 8 tiles, every turn with more than 2 s left is reachable; `other` is a safety net.
- **Two classes added**: `other` (engaged, none of the classes fits) and `interrupted` (death
  during the power, level clear, a second power dot `refreshed`, or the player left `quit`).
  Interrupted trials never count toward the rates.
- **Early retreat before the warning window** (turned with more than about 3.3 s left) is kept
  as `early-retreat` but is not engaged, so it is outside the rates; `wasted` covers all early
  retreats. Other trials that are not engaged are `not-engaged`, whatever they ate.
- An eat inside the warning window counts as chasing there (engaged).
- An aftermath cut short (new power-up, level clear, player left) keeps `after.seen` < 3 and
  `after.cut`; only `cut: 'quit'` leaves the rates.

## Practical limits

Summary, dashboard and export queries read every trial of their filter in one query (they must:
the rates and the bootstrap need every decision trial). `live.counters` does not: it reads the
`counters` table and the last minute of trials. A trial row
is about 2 KB, so a query stays within Convex's read limits (16 MB, 32k documents per function)
up to roughly 5,000 trials per filter, which is far beyond a study of this size (a 13-cue study
session gives about 60-100 trials). Beyond that, add per-cue counters maintained by
`trials.save` or move summaries to a scheduled aggregate. Clips are never scanned by summaries.
`dashboard.sessions` still reads the trials of its 100 newest sessions on every change, and
`replays.list` the newest 4,000 trials; both are bounded but grow with the data.
