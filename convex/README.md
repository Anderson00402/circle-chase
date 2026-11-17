# Convex: study data

> **Changed 2026-11-16.** Trial rows no longer hold the 10 Hz series: it lives in `trialSeries`
> (one row per trial). Read it with `trials.series({ trialId })` (unpacked arrays) or, inside
> Convex, `packedSeriesOf(ctx, trial)` from `convex/trials.ts`. Simulated trials carry `simRun`
> (the session's `sim.run`) and every filter takes `run`. Exports are streamed page by page (no
> size limit) and there are ratings and blocks CSVs. Every rate reports `leftOut.oldRules`. All
> writes go through one outbox that never drops a write (`src/lib/study/outbox.svelte.ts`).

> **Changed 2026-11-16, later.** Exports never stall (a page with no matching row no longer ends
> the stream; `node scripts/export-e2e.mjs` checks every file through HTTP) and ratings and blocks
> also come as JSON; the trials CSV carries the rules-v3 raw measures and the chase log. A refresh
> resumes its run with its counters (`blocks.progress`, block `segments`). Clips store `layout` and
> the dying phase. The live panel reads `summary.cueCounts`. `appVersion` comes from `/build.json`.
> The outbox parks a write the server keeps rejecting.

> **Changed 2026-11-16, final polish.** Export pages are small (100-200 rows; blocks and ratings
> read once per session, never per row) and the HTTP stream retries a failed page at half the size
> before it gives up with an `EXPORT FAILED` line; the CSVs gain `consoleNumber` (the "#4" of the run
> console). The outbox lists parked writes (`parkedWrites`) with retry, download and discard, and
> never counts them as on the way (`src/lib/study/outbox-parked.svelte`). Dashboard and replay
> digests are kept in chunks of 25 rows (see "Database growth"). The per-session totals count "gave
> up very early" only for trials classed too early and count decisions cut by a maze clear
> (`migrations.rebuildCells` recomputed them for the stored data).

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
- **appVersion** is a build identifier: package version + git commit, `0.0.1+e8606d3`, with
  `.dev` when served by the dev server (whose files may also hold uncommitted changes). Each page
  reads it at load from `/build.json` (`src/routes/build.json/+server.ts`: under the dev server it
  runs `git rev-parse` on every request, so it names the commit checked out when the page loaded,
  not the one the server started on; a static build prerenders it). Until that answers, and
  outside the app (tests, Node), it is the value `vite.config.ts` injected (`__APP_BUILD__`).
- **inputType**: `keyboard`, `touch`, `mouse`, `mixed`, `none`; in a browser driven by automation
  `automated` (nothing pressed: steered by a script) or `automated-keyboard` and so on.
- **Keys**: the browser makes a `key` for every session, block, trial and rating. Writes with a
  key that already exists return the existing row, so retries never duplicate.
- **Times**: `createdAt`, `startedAt`... are server ms since 1970. Inside a trial (`startedAt`,
  `endedAt`, `eats[].t`, `turnAt`, series `t`) times are game seconds.
- **Filter** (`Filter`), accepted by every read query marked "filter":
  `{ source?, mode?: 'study'|'arcade', cue?, from?, to?, participantId?, sessionId?, run?, includePractice? }`
  (`from`/`to` are server ms, inclusive; `run` is a simulator run, index `trials.by_run`).
  `convex/lib/filters.ts`: `trialRange(ctx, f)` picks the narrowest index, `matches(t, f)` checks
  the rest, `scanTrials(ctx, f)` does both.
- **Rows left out for old rules**: a trial recorded before the current rules version lacks a
  measure the rules need, so it cannot be recomputed and is in no rate. Every result with rates
  says how many eligible rows (`inRates`) that left out: `leftOut: { oldRules }` on
  `decisionRates()` / `CueSummary`, `summary.byCue` and `live.counters` ("Not counted: N recorded
  before the current rules").

## Tables

| Table | One row per | Notes |
| --- | --- | --- |
| `participants` | browser (anonymous id in localStorage) or bot | `number` 1, 2, 3... in order of first visit (everyone); `runNumber?` 1, 2, 3... per source for run-console participants only (picks the counterbalanced case order; play pages opened without a run never get one), `nickname?`, `device`, first/last seen |
| `sessions` | visit | `mode`, `source`, `cueOrder`, `appVersion`, `difficulty`, `sound`, `reducedMotion`, `inputType`, `viewport`, started, `endedAt` (when its last open block closed; cleared when a block starts), counters, `run?`, `sim?` |
| `blocks` | cue played within a session | `cue`, `orderIndex`, started/ended, `trialCount`, `engagedCount`, `deaths`, `score`, `pauses?`, `pausedSeconds?`; `segments?`: one entry per page that played it (a refresh resumes the block in a new page) with its own deaths, score and pauses; the block's totals are their sums |
| `trials` | power-up | context + every measure of `TrialMeasures` (`src/lib/telemetry/types.ts`), including `lastChaseEnd` and `rulesVersion`; `simRun?`; `clipId?`. About 1 KB, no series |
| `trialSeries` | trial | the 10 Hz series packed (~1 KB) + `trialId`, `sessionId`, `cue`, `source`, `mode`, `createdAt`, `simRun?`; indexes `by_trial`, `by_source_cue` [source, cue, createdAt], `by_run` [simRun, cue, createdAt] |
| `trialDigests` | up to 25 trials of a session (`chunk` 0, 1...; older ones hold a whole session) | compact row per trial for the dashboard (`convex/lib/digest.ts`); kept by `trials.save` and `admin.reclassify` |
| `trialCells` | session | the session's totals for the headline numbers (`convex/lib/cells.ts`), rewritten from all its digest rows on every digest change |
| `replayDigests` | up to 25 clips of a session (`chunk`, as above) | slim row per trial with a clip, for the replay browser (`convex/lib/replayDigest.ts`) |
| `clips` | stored replay (engaged or caught trials) | packed scenes (`data`, 5-15 KB), `markers`, `numbers`, `cue`, `outcome`, `layout?` (the maze layout fingerprint); separate so trial scans stay light |
| `ratings` | questionnaire answer | `kind: 'block'` (clarity, distraction 1-7) or `'session'` (clearest, leastClear, comment) |
| `presence` | open game page | heartbeat every 5 s; rows older than 20 s are swept by a cron |
| `cueCounters` | source, case and rules | running totals for `summary.cueCounts` (the live panel): trials, decisions, timely, early, overstayed, caught, lastTrialAt; kept by `trials.save`, recounted by `counters.rebuildCounters` |
| `counters` | source (`human`, `bot`) | running totals for `live.counters`: trials, engaged, inRates, decisions, oldRules, clips, sessions, participants, lastTrialAt; kept by `participants.ensure`, `sessions.start`, `trials.save` (practice trials not counted) |

## Write side (sent through the outbox, `src/lib/study/outbox.svelte.ts`)

| Function | Arguments | Returns |
| --- | --- | --- |
| `participants.ensure` | `{ pid, source, device, nickname?, console? }`; `console: true` (the run console) gives the participant a `runNumber` if it has none | `{ participantId, number, runNumber }` (`runNumber` null unless a console participant) |
| `sessions.start` | `{ key, pid, mode, source, cueOrder, appVersion, difficulty, sound, reducedMotion, inputType, viewport }` | `{ sessionId }` |
| `sessions.update` | `{ key, inputType?, sound?, reducedMotion?, end? }` | session id or null |
| `blocks.start` | `{ key, sessionKey, cue, orderIndex, segment? }`; `segment` names the page playing it: a page resuming the block after a refresh adds its segment and reopens the block (earlier segments count as over) | `{ blockId }` |
| `blocks.end` | `{ key, deaths, score, pauses?, pausedSeconds?, segment? }`: with `segment`, that page's own numbers (last call per segment wins); the block's totals are the sums over its segments whatever order they arrive in, and it ends when no segment is open. Without `segment` (the simulator) the call sets the totals. Sets the session's `endedAt` when no other block of it is open | block id, or null until the block exists |
| `trials.save` | `{ key, sessionKey, blockKey, trialIndex, sound, reducedMotion, inputType, appVersion, difficulty, ...measures, series: bytes, clip? }`; the outcome is recomputed from the measures (`convex/lib/rules.ts`; a row that lacks a measure the rules need keeps an older `rulesVersion`); the series goes to `trialSeries`, the clip to `clips`, and the session's digest is updated | `{ trialId, clipId }` |
| `ratings.saveBlock` | `{ key, blockKey, clarity: 1-7, distraction: 1-7, note? }` | rating id, or null until the block exists |
| `ratings.saveSession` | `{ key, sessionKey, clearest?, leastClear?, comment? }` | rating id, or null until the session exists |
| `presence.heartbeat` | `{ sessionKey, pid, cue, mode, source, state: 'playing'\|'idle', score, level, powerLeft, nickname? }` | row id |
| `presence.leave` | `{ sessionKey }` | - |
| `blocks.start` | also takes `mode?` (rules of this run, when they differ from the session's) | |
| `runs.setup` | `{ sessionKey, run: { participantLabel, participantNumber, orderRow } }` | session id, or null until the session exists |
| `runs.markBlock` | `{ blockKey, pauses?, pausedSeconds? }` (pauses now also come with `blocks.end`) | block id, or null until the block exists |

Cue, mode, source, participant, block index and `simRun` of a trial are taken from its block and
session, not from the caller.

### The outbox

`startOutbox(client)` (root layout) starts the app's one queue; `getOutbox(client).send(fn, args,
{ id?, lane?, onDone?, about? })` queues a write (`about`: participant label and case, to name it if it
gets stuck); `outboxStatus` is reactive:
`{ state: 'saved'|'saving'|'offline'|'failing', pending, waiting, failing, failingCount, lastError, parked, parkedErrors, parkedWrites, savedAt }`.

- Nothing is dropped: a failing write is retried with back-off (0.5 s doubling to 30 s) for as long
  as the page lives and stays in localStorage until Convex has it. After 3 errors in a row it
  counts as failing (`failingCount`, `lastError`), but it is still kept and retried.
- A write the server keeps rejecting (8 times in a row, while not offline; a lost connection never
  rejects a write, it only delays it) is **parked**: kept, tried again every 5 minutes, counted in
  `failingCount` and listed in `parked` / `parkedErrors` (`{ fn, error }`) and in full in
  `parkedWrites` (what it is in plain words, participant, session, case, the server's error, first
  refused, parked, last tried, tries). It is **not** counted in `pending` (it is not on the way),
  and it no longer holds its lane, so the later writes of its session go on. Parked writes stay
  parked, with their count and error, when another page adopts them. `retryParked(id?)` tries
  again now, `parkedJson(id?)` gives them with their stored arguments for a download, and
  `discardParked(id)` drops one for good. `<OutboxParked />` (`src/lib/study/outbox-parked.svelte`)
  is the small "1 write refused" button and panel with those three actions; it shows nothing while
  there are none.
- Writes of one lane (the telemetry client uses the session key) go in order; a stuck lane does
  not hold the others.
- A write answering null (`runs.setup`, `runs.markBlock`, ratings, `blocks.end`,
  `sessions.update`: their row is not there yet) waits, every 3 s then every 15 s; it counts as
  `waiting`, not pending or failing.
- Each tab stores its queue under `cc.outbox.<id>` with a heartbeat; queues of tabs quiet for
  12 s (closed, crashed) and the older formats (`cc.queue.*`, `cc.run.outbox`) are adopted by any
  page, so the console alone delivers what a closed play page left.
- Checks: `src/lib/study/outbox.test.ts` (fake client), `node scripts/outbox-e2e.mjs` (Chrome:
  offline, close the page, console alone delivers).

## Read side

| Query | Arguments | Returns |
| --- | --- | --- |
| `summary.byCue` | filter | `{ source, cues: CueSummary[], all: CueSummary, scanned, leftOut: { oldRules } }` (see below) |
| `summary.cueCounts` | `{ source?, cue, mode? }` | `{ trials, decisions, wellTimed, tooLate, caught, tooEarly, notEnoughData, lastTrialAt }` for one case from `cueCounters` (Wilson intervals; one small document, a few ms): what the live panel shows |
| `blocks.progress` | `{ key }` | where a block stands, for a page resuming it: `{ trials, nextIndex, decisions, deaths, score, pauses, pausedSeconds, segments }`; null if not stored |
| `trials.list` | filter + `outcome?`, `engagedOnly?`, `paginationOpts` | Convex page of trials, newest first |
| `trials.series` | `{ trialId }` | the series unpacked `{ t, left, dist, chasing, px, py }` or null |
| `trials.get` | `{ id }` | trial + `series` (as above, null if missing) + `clipId`, `participant { number, nickname }`, `block { cue, orderIndex, trialCount }`; null if missing |
| `clips.byTrial` | `{ trialId }` | clip row with `data` (decode with `decodeClip`) or null |
| `clips.get` | `{ id }` | clip row with `data` or null |
| `clips.moments` | `{ cue?, outcome?, source?, paginationOpts }` | page of clips newest first, **without** `data` (`trialId`, `cue`, `outcome`, `markers`, `numbers`, `mazeId`, `level`, `t0`, `t1`, `scenes`, `size`, `createdAt`, `source`, `mode`) |
| `sessions.overview` | `{ source?, mode?, limit? = 50 }` | sessions newest first with `participant { number, nickname }` and `blocks[]` |
| `participants.overview` | `{ source? }` | participants with `sessions`, `studySessions`, `trials` counts, most recently seen first |
| `live.counters` | `{ source?, now? }` | `{ trials, engaged, inRates, decisions, clips, sessions, participants, lastMinute, lastTrialAt, nowPlaying, playing[] }` from the `counters` table plus an index range for the last minute (no trial scan) |
| `presence.nowPlaying` | `{}` | presence rows updated in the last 20 s (no `pid`) |
| `runs.session` | `{ sessionKey }` | the run sheet: `participant`, `run` info, `runs[]` (one per block: `cue`, `orderIndex`, `mode`, `trials`, `counted` decisions, `wellTimed`, `caught`, `catches`, `clips`, `outcomes`, `clarity`, `distraction`); null until the session exists |
| `runs.block` | `{ blockKey }` | one run for its summary: the same tally plus `rows[]` (each trial: `outcome`, `counted`, `total`, `turnLeft`, `eats`, `clipId`) and its rating; null until the block exists |
| `exports.page` | filter + `kind: 'trials'\|'ratings'\|'blocks'`, `format: 'csv'\|'json'`, `paginationOpts` | `{ header, rows, isDone, continueCursor }`: CSV lines (header separate, the same on every page) or JSON objects; a page may hold fewer rows than asked, even none. Ratings and blocks are read through an index on the session, the case or the source (`by_source_created`, `by_source_started`), not the whole table |

### Downloads (HTTP, streamed page by page, any size)

`GET http://127.0.0.1:3211/export/<file>?<filter>` with the filter as query parameters (`source`,
`mode`, `cue`, `from`, `to`, `participantId`, `sessionId`, `run`, `includePractice`); `pageSize`
(1-1000) forces smaller pages. Rows created after the download started are left out.

Pages are small by default (trials 200, trials JSON 100, ratings 200, blocks 200: `PAGE_SIZE` in
`exports.ts`), and the context of a row (session, participant, block, the block's rating) is read
once per session on the page, not per row. On a busy machine Convex can still stop a query ("too
many system operations"); the stream then reads the same page again at half the size, up to 6
times with a short pause, and keeps the smaller size for the rest of the file. Only if that fails
too does the file end with `EXPORT FAILED: the file is incomplete. <error> (tried 7 times, down to
pages of N rows; R rows were written before this line, the rest are missing)`. `simulateLimit=N`
(checks only) makes every page above N rows fail that way: `node scripts/export-e2e.mjs --squeeze 7`.

| File | One row per | Columns |
| --- | --- | --- |
| `trials.csv` | trial | ids, `createdAt`, who (`participantLabel`, `consoleNumber` (the number the run console shows, "#4"; empty outside the console), `participantNumber` (overall order of first visit: not the console's number), `runNumber`, `orderNumber`, `orderRow`, `simRun`), `source`, `mode`, `cue`, `blockIndex` (run order in the session, from 0), `suggestedPosition` (position of the cue in the suggested order), `pauses`, `pausedSeconds` (of its block), settings, every measure flat (`after.*` spelled out), the rules-v3 raw measures (`chaseEndDist`, `chaseGain`, `chaseGhost`, `gaveUpEarly`, `chaseLog`), `outcome`, `rulesVersion`, `inRates`, `decision`, `catchLate`, `hasClip`, `practice`. `chaseLog` is one cell: one chase per `;`, each `ghost from at left dist gain end endDist` (seconds since the power started, power left, tiles; `-` for no distance); empty without chases, blank before rules version 3 (`chaseLogCell` / `parseChaseLogCell` in `exports.ts`). Every class can be recomputed from this file alone: `node scripts/csv-reclassify.mjs` |
| `trials.json` | trial | full row + who + pauses + `decision` + `series` unpacked |
| `ratings.csv`, `ratings.json` | questionnaire answer | ids, who, `kind`, `cue`, `blockIndex`, `clarity`, `distraction`, `note`, `clearest`, `leastClear`, `comment` |
| `blocks.csv`, `blocks.json` | run of a case (block) | ids, who, `cue`, `blockIndex`, `suggestedPosition`, start/end, `trials`, `engaged`, `deaths`, `score`, `pauses`, `pausedSeconds`, its rating, `appVersion`, `inputType` |

A failure part way through ends the file with a line `EXPORT FAILED: ...`. The stream reads
pages until one has something to send, so a filter that matches few rows among many (the human
rows among thousands of simulated ones) or none at all still finishes. Measured on 16,068 simulated
trials, 1,044 blocks and 1,069 ratings (`node scripts/export-e2e.mjs`, which downloads every file
for human and bot data, with and without a run filter, in tiny pages and with filters that match
nothing, and checks the rows against the query; part of `npm run e2e`): `trials.json` 56.7 MB in
28.5 s, `trials.csv` 6.5 MB in 10 s, blocks and ratings under 0.6 s; the human files in under
0.1 s.

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
  flagged: { cutByClear },                     // decision trials whose aftermath a maze clear cut short
  clarity: { n, mean }, distraction: { n, mean },               // block ratings
  notEnoughData                                // decisions < 10
}
```

`inRates` (stored on each trial) = the power ran out by itself (`endReason: 'expired'`), the
player did not leave during the aftermath, and the trial is engaged or the player gave up a
reachable ghost before the warning window (`gaveUpEarly`). **Decision trials** (the denominator of
every rate, `isDecision` in `convex/lib/rules.ts`) are the `inRates` trials of rules version 3 whose
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

Encoded by `src/lib/telemetry/recorder.ts` (`encodeClip` / `decodeClip`): 20 Hz scenes from 8 s
before the power ended (or its start, if later: the whole power-up under study rules) to 3 s
after, always reaching the frame that closed the trial; a trial that ended in a death is stored
half a second of game time later (`createWriteQueue` in `write.ts`, used by the browser and the
simulator), so its clip runs 0.5 s into the dying phase. `layout` (also in `decodeClip(..).meta`)
is the maze's layout fingerprint (`Maze.layout`, e.g. `w25h25-7415fef2`); clips stored before it
have none; positions to 1/64 tile, times to
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
was paused. A refresh in the middle of a run stores the power-up in progress as `interrupted` and
**resumes the same block**: the new page opens a new segment of it, and carries on the trial index
(no number used twice), the power-ups measured (the run length counts on) and the decision trials,
from this browser's record (`cc.tel.block.<key>`, `src/lib/telemetry/resume.ts`) or the server's
(`blocks.progress`), whichever is ahead. Deaths, score and pauses are summed over the segments. `practice`, `abandoned` and `study` exist
only on rows from an earlier guided study flow and are no longer written.

## Clearing data

| Mutation | Arguments | Effect |
| --- | --- | --- |
| `admin.deleteBotData` | `{ confirm: 'delete bot data' }` | deletes every row with `source: 'bot'` in every table |
| `admin.wipeEverything` | `{ confirm: 'wipe everything' }` | deletes all rows of all tables (fresh demo); cannot be undone |
| `admin.reclassify` | `{ confirm: 'reclassify' }` | recomputes `outcome`, `rulesVersion`, `inRates`, `wasted` and `gaveUpEarly` of every trial and the outcome of its clip from the stored measures; rows that lack a measure the rules need (`chaseEndDist` before version 3, `lastChaseEnd` before version 2) keep their class and their older `rulesVersion`; recounts `counters` at the end |
| `counters.rebuildCounters` | `{ confirm: 'rebuild counters' }` | recounts the `counters` table from trials, sessions and participants |

The deleting ones work in batches and schedule themselves until done; they return
`{ deleted, continuing }`. `reclassify` and `rebuildCounters` run in the background (pages of 200
and 400 rows) and log a line to the Convex log when done.

## Interpretations of STUDY.md

Places where the definitions needed a concrete reading (full list in `tracker.ts`):

- Distances are continuous path distances (fractions of a tile between tile centres) with tunnel
  wrap, to ghosts that are out of the pen. During the power the targets are the scared ghosts;
  after it, the ghosts that were scared when it ran out.
- **Chasing** counts only the player's own steps: each frame, how much the player's step changed
  the path distance to where each scared ghost is now. An approach starts with a step toward a
  ghost within 6 tiles; it is a chase once those steps closed 3 tiles; it is over when the player
  is 1 tile back from their closest point, came no closer for 0.5 s, or the ghost is out of range.
  A ghost walking toward a player who flees or stands still is not chased. Game time stands still
  during the freeze after an eat, so it does not break a chase. The numbers are `CHASE` in
  `convex/lib/rules.ts`.
- **After the end** the same rule goes on for an approach under way (the targets are the ghosts
  that were scared when the power ran out). No approach starts after the end.
- **Final decision / turn-away**: the chase whose turn-away moment came last (`lastChaseEnd`:
  turn, eat, open). The moment is the player's closest point by their own steps, not the frame on
  which the end was noticed: `turnLeft` is negative after the end, never pushed late by a lag. A
  chase ending in an eat turns at the eat (distance 0); an eat also wipes every approach under way.
- **Outcome rules** live in `convex/lib/rules.ts` (`classify`, `derive`), shared by the tracker and
  Convex. Caught needs `after.caught` and `endDist` of 5 tiles or less. Overstayed: the last chase
  is open or turned with less than 0.2 s left, and `chaseEndDist` (distance to its ghost when the
  power ran out) is 5 tiles or less. Timely (0.2-2 s left) and early (over 2 s) retreats need the
  ghost reachable at the turn: `turnDist` at most `turnLeft` x 5.6 tiles/s.
- **`other`**: a final chase that shows no decision (turned from a ghost out of reach inside the
  warning window, or still running at the end farther than 5 tiles from its ghost).
  **`interrupted`**: death during the power, level clear, a second power dot `refreshed`, or the
  player left `quit` (stored with the last frame's time as `endedAt` and the power left then).
  Neither counts toward the rates.
- **Giving up before the warning window** (final chase turned with more than 3 s left from a
  reachable ghost, nothing chased or eaten after it) is `early-retreat` with `gaveUpEarly: true`
  and counts toward the rates. Other trials that are not engaged are `not-engaged`.
- An eat inside the warning window counts as a chase there (engaged).
- **Raw measures for recomputing** (rules version 3): `chaseEndDist`, `chaseGain`, `chaseGhost`
  and `chaseLog` (every chase: ghost, first step, turn-away moment, time left, distance, tiles
  closed, end, distance at the end). `rescore()` recomputes `outcome`, `inRates`, `wasted` and
  `gaveUpEarly`; rows without `chaseEndDist` keep their class and their older `rulesVersion`.
- An aftermath cut short (new power-up, level clear, player left) keeps `after.seen` < 3 and
  `after.cut`; only `cut: 'quit'` leaves the rates. Decision trials cut by a maze clear are
  counted in every rate result as `flagged.cutByClear`.
- The 6 tiles of range are measured after the player's step; of equal closest points by the
  player's own steps the first counts (both pinned in `tracker.test.ts`).

## Practical limits

The local backend costs about 0.6 ms per document read, whatever its size: scanning 6,664 trial
rows takes about 4 s with or without the series in them (measured: `summary.byCue` uncached
about 5 s for 6,664 bot trials, 80 ms for the few human ones; `.shots/data/bench.sh`). So speed
comes from reading fewer documents: the dashboard reads `trialDigests` (one per session) instead
of trial rows. `summary.byCue`, `exports.page` and the run sheet still read trial rows (exports
in pages, so they work at any size); `summary.byCue` (about 5 s over all simulated data) is only
used by the simulator page, while the live panel reads `summary.cueCounts` (a few ms). Convex warns above 4,096 document reads per function and stops at 32,000 (or 16 MiB read);
a trial row is about 1 KB. `live.counters` reads the `counters` table and the last
minute of trials. Clips and series are never scanned by summaries.

## Database growth

The local backend keeps every revision of every document in its SQLite file
(`.convex/local/default/convex_local_backend.sqlite3`), so a document rewritten on every saved
power-up costs its full size each time. Measured on 2026-11-16 (15,279 power-ups, 87 sessions,
read-only from the SQLite file, `.shots/data-r4/`):

| Table | Live size | All revisions | Why |
| --- | --- | --- | --- |
| `trialDigests` | 10 MB | **1,005 MB** | one document per session (up to 140 KB) rewritten on every power-up |
| `replayDigests` | 4.9 MB | **337 MB** | the same per clip (up to 83 KB) |
| `clips` | 154 MB | 154 MB | written once |
| `trialCells` | 0.7 MB | 73 MB | per-session totals (up to 10 KB) rewritten on every power-up |
| `sessions`, `blocks`, counters | 1 MB | 39 MB | small rows patched on every power-up |
| `trials`, `trialSeries` | 36 MB | 36 MB | written once |
| whole file | | 1.9 GB | |

So about 1.4 GB of the 1.9 GB were old revisions of the two digests: a 175-trial session rewrote
about 88 rows per save on average. Digests are now kept in chunks of 25 rows (`DIGEST_CHUNK`,
`REPLAY_CHUNK`): a save rewrites the last chunk only, on average about 13 rows. In the test
harness (`convex/digestChunks.test.ts`, 240 power-ups in two 120-trial sessions, chunks of 7) the
digest bytes written fell from 9.7 MB to 0.7 MB and the replay digest bytes from 5.7 MB to 0.5 MB,
with every dashboard and replay query giving the same answer. For the stored data's session sizes
and chunks of 25 that is about 0.13 GB instead of 1.0 GB for the digests and 0.06 GB instead of
0.34 GB for the replay digests: roughly 0.7 GB in all for 15,000 power-ups instead of 1.9 GB.
Existing digests were not rewritten (a session's old single document stays chunk 0 and new trials
go into new chunks), so the file does not shrink; only new data grows more slowly. The per-session
totals (`trialCells`, about 5 KB per power-up) are still rewritten every time.

The backend reads this file at start: with about 2 GB it takes about 30 s, longer than the CLI's
default wait, so `npm run convex` sets `CONVEX_LOCAL_BACKEND_STARTUP_TIMEOUT_SECS=240`. A fresh
database for a real study (after deleting or archiving the simulated data, or starting from an
empty `.convex/`) starts in a second or two.

## Migrations (`convex/migrations.ts`)

Resumable, in batches, never delete a row; started with `npx convex run`:

| Mutation | Arguments | Effect |
| --- | --- | --- |
| `migrations.slimTrials` | `{ confirm: 'slim trials' }` | moves each trial's series into `trialSeries` and fills `simRun` (done 2026-11-16: 6,669 rows) |
| `migrations.rebuildCells` | `{ confirm: 'rebuild cells' }` | works out every session's `trialCells` again from its digest rows (after a change to `convex/lib/cells.ts`); touches nothing else (done 2026-11-16: 87 sessions, 15,279 rows) |
| `migrations.numberRunParticipants` | `{ confirm: 'number run participants' }` | gives `runNumber` to participants who already played through the console (per source, by first visit); stored numbers stay as they were (done: 35 bot, 0 human) |
