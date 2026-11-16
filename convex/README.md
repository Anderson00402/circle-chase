# Convex: study data

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
| `trials` | power-up | context + every measure of `TrialMeasures` (`src/lib/telemetry/types.ts`); the 10 Hz series packed as bytes (~1 KB); `clipId?` |
| `clips` | stored replay (engaged or caught trials) | packed scenes (`data`, 5-15 KB), `markers`, `numbers`, `cue`, `outcome`; separate so trial scans stay light |
| `ratings` | questionnaire answer | `kind: 'block'` (clarity, distraction 1-7) or `'session'` (clearest, leastClear, comment) |
| `presence` | open game page | heartbeat every 5 s; rows older than 20 s are swept by a cron |

## Write side (used by `src/lib/telemetry/client.svelte.ts`)

| Function | Arguments | Returns |
| --- | --- | --- |
| `participants.ensure` | `{ pid, source, device, nickname? }` | `{ participantId, number }` |
| `sessions.start` | `{ key, pid, mode, source, cueOrder, appVersion, difficulty, sound, reducedMotion, inputType, viewport }` | `{ sessionId }` |
| `sessions.update` | `{ key, inputType?, sound?, reducedMotion?, end? }` | session id or null |
| `blocks.start` | `{ key, sessionKey, cue, orderIndex }` | `{ blockId }` |
| `blocks.end` | `{ key, deaths, score }` (last call wins) | block id or null |
| `trials.save` | `{ key, sessionKey, blockKey, trialIndex, sound, reducedMotion, inputType, appVersion, difficulty, ...measures, series: bytes, clip? }` | `{ trialId, clipId }` |
| `ratings.saveBlock` | `{ key, blockKey, clarity: 1-7, distraction: 1-7 }` | rating id |
| `ratings.saveSession` | `{ key, sessionKey, clearest?, leastClear?, comment? }` | rating id |
| `presence.heartbeat` | `{ sessionKey, pid, cue, mode, source, state: 'playing'\|'idle', score, level, powerLeft, nickname? }` | row id |
| `presence.leave` | `{ sessionKey }` | - |

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
| `live.counters` | `{ source?, now? }` | `{ trials, engaged, inRates, clips, sessions, participants, lastMinute, lastTrialAt, nowPlaying, playing[] }` |
| `presence.nowPlaying` | `{}` | presence rows updated in the last 20 s (no `pid`) |
| `exports.trials` | filter + `format: 'csv'\|'json'` | `{ filename, contentType, rows, body }`; CSV is one flat row per trial (48 columns, no series), JSON is full rows with the series unpacked |

HTTP downloads with the same filter as query parameters:
`GET http://127.0.0.1:3211/export/trials.csv?source=human&mode=study` (and `trials.json`).

`live.counters.lastMinute` updates whenever a trial arrives; pass `now` and refresh it every few
seconds if it must also fall back to 0 while nobody plays.

### `CueSummary` (from `convex/lib/stats.ts`)

```ts
{
  cue, trials, engaged, inRates, participants,
  outcomes: Record<Outcome, number>,           // all trials of the cue
  caught:    { k, n, rate, lo, hi },           // caught / inRates, Wilson 95%
  wellTimed: { k, n, rate, lo, hi },           // (late catch + timely retreat) / inRates
  turnAway:  { n, q10, q25, median, q75, q90, mean, values[] },  // turnLeft of trials in rates
  wasted:    { n, ..., mean, values[] },       // power left after early retreats
  lateCatches, nearMisses,
  clarity: { n, mean }, distraction: { n, mean },               // block ratings
  notEnoughData                                // inRates < 10
}
```

`inRates` (the denominator of every rate) = engaged, the power ran out by itself
(`endReason: 'expired'`), and the player did not leave during the aftermath.

### Clips

Encoded by `src/lib/telemetry/recorder.ts` (`encodeClip` / `decodeClip`): 20 Hz scenes from 6 s
before the power ended (or its start, if later) to 3 s after; positions to 1/64 tile, times to
0.01 s, delta + varint packed. `decodeClip(clipRow)` returns `{ meta, scenes: Scene[], markers }`;
draw a scene with `renderScene(canvas, scene, { cue })`. Markers: `powerStart`, `eat` (with ghost
and time left), `turnAway`, `powerEnd`, `death`, each with game time `t`. `numbers` has outcome,
power length, turn-away time and distance, distance at the end, time to caught, eats, engaged.
Measured sizes: 5-12 KB per clip.

## Clearing data

| Mutation | Arguments | Effect |
| --- | --- | --- |
| `admin.deleteBotData` | `{ confirm: 'delete bot data' }` | deletes every row with `source: 'bot'` in every table |
| `admin.wipeEverything` | `{ confirm: 'wipe everything' }` | deletes all rows of all tables (fresh demo); cannot be undone |

Both delete in batches and schedule themselves until done; they return `{ deleted, continuing }`.

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
- **Turn-away**: the last chase of the trial. Its moment is when the player was closest (latest
  moment within 0.05 tiles of the minimum), or, if that chase ran past the end, the last step that
  still closed in (negative time left). A chase ending in an eat turns at the eat (distance 0).
- **Still closing in at the end** (overstayed, exposure): the last chase is not an eat and turned
  with less than 0.2 s left or never turned. This makes the classes contiguous: under 0.2 s is
  overstayed (if within 5 tiles and survived), 0.2-2 s timely, over 2 s early.
- **Early retreat "while a ghost was still reachable"**: at the turn some scared ghost was out
  and within (time left x level-1 player speed) tiles.
- **Two classes added**: `other` (engaged, none of the five fits, e.g. ate the last scared ghost
  with 2.5 s left) and `interrupted` (death during the power, level clear, a second power dot
  `refreshed`, or the player left `quit`). Interrupted trials never count toward the rates.
- **Early retreat before the warning window** (turned with more than about 3.3 s left) is kept
  as `early-retreat` but is not engaged, so it is outside the rates; `wasted` covers all early
  retreats.
- An eat inside the warning window counts as chasing there (engaged).
- An aftermath cut short (new power-up, level clear, player left) keeps `after.seen` < 3 and
  `after.cut`; only `cut: 'quit'` leaves the rates.

## Practical limits

Summary, counters and export queries read every trial of their filter in one query. A trial row
is about 2 KB, so a query stays within Convex's read limits (16 MB, 32k documents per function)
up to roughly 5,000 trials per filter, which is far beyond a study of this size (a 13-cue study
session gives about 60-100 trials). Beyond that, add per-cue counters maintained by
`trials.save` or move summaries to a scheduled aggregate. Clips are never scanned by summaries;
`live.counters` counts them through `trials.clipId`.
