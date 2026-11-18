# Architecture

```
engine  ──Frame──▶  renderer + cue  ──▶ canvas          (what the player sees)
   │
   └────Scene────▶  telemetry ──▶ Convex ──▶ dashboard, replays   (what we learn)
```

Everything talks through the plain-data contracts in `src/lib/game/types.ts`. Read that file first.

## The one rule that makes replays work

A **Frame** is a snapshot of the board. A **Scene** is a Frame plus the maze and the current dots.
The renderer and every cue are **pure functions of a Scene**: the same scene always draws the same
picture. So:

- a replay is a list of recorded scenes drawn again with the same renderer and cue, and it shows
  exactly what the player saw, including the countdown cue;
- scrubbing backwards, pausing and slow motion come for free;
- a recorded moment can be re-drawn with a *different* cue to compare.

To keep this true, drawing code must not keep state that depends on earlier frames. Particles,
embers, sparkles and so on are computed from game time (for example hashed from an index and
`now`), not simulated step by step. Caches keyed by maze, tile size or colour are fine.

## Folders and who owns them

| Path | What it is |
| --- | --- |
| `src/lib/game/types.ts` | Contracts. Shared; additive changes only. |
| `src/lib/game/engine/` | Rules: mazes, levels, ghost behaviour, power-ups, bot. No DOM. Deterministic for a seed. |
| `src/lib/game/render/` | Canvas renderer: maze, characters, effects, HUD pieces drawn on the board. |
| `src/lib/game/audio/` | Synthesized sound. |
| `src/lib/game/cues/` | One file per countdown cue plus the registry `index.ts`. |
| `src/lib/game/Game.svelte` | The playable board: loop, input, sizing, overlay. Emits scenes through `onframe`. |
| `src/lib/telemetry/` | Turns scenes into trials, metrics and replay clips; sends them to Convex. |
| `convex/` | Schema, mutations and queries. |
| `src/lib/ui/` | Shared UI components and design tokens. |
| `src/lib/charts/` | Chart components for the dashboard. |
| `src/routes/` | Pages: home, play, study, cues gallery, dashboard, replays. |
| `docs/` | This file, `STUDY.md` (what is measured and why), `CUES.md` (how to write a cue). |
| `legacy/` | The first single-file version, its 10 cue experiments, and the old tracker. Reference only. |

## Engine

`createGame(config)` returns a `Game`: `steer(dir)`, `update(dt)` (call with a fixed 1/120 s step),
`frame()` / `scene()`. All randomness comes from `config.seed`.

- `createGame` actually returns an `EngineGame` (`engine/game.ts`), a superset of `Game` with
  `peek()` (a snapshot that leaves the events in place), `info` (the current level's settings) and
  `goToLevel(n)`.
- `engine/levels.ts` holds the level table (`levelInfo(level, difficulty)`: maze, speeds, power
  length, waves, bonus item); `engine/mazes.ts` the five mazes and `engine/validate.ts` their rules;
  `engine/bot.ts` an autopilot used for previews, tests and simulated data; `engine/paths.ts` path
  distances through the maze.
- `mode: 'study'` plus `frightRange`, `powerRespawn`, `infiniteLives`, `fixedLevel`, `powerLock` (see
  `STUDY_CONFIG`) make the game produce many comparable power-ups without ever ending: random
  power lengths, one power-up at a time, always the same maze and speeds. `scaredFlee` and
  `scaredSpeedShare` make scared ghosts near the player run from it, a little slower than the
  player, so many power-ups end with a chase under way (docs/STUDY.md "Study-rule levers").
- `src/lib/sim/` plays simulated participants through the same engine and tracker; `yield.ts`
  says where power-ups go, `recover.test.ts` checks planted versus recovered without Convex.
- `Frame.power` describes the power-up: `left`, `total`, `startedAt`, `endedAt`, `endReason`,
  `serial`. Each ghost carries `scared`, `revertedAt` (when the timer turned it dangerous again)
  and `eatenAt`.
- `Frame.events` lists what happened since the previous `frame()` call.

## Renderer and cues

`createRenderer(canvas).draw(scene, { cue, reduceMotion })` draws in this order, giving the cue a
hook at each step:

1. maze walls → `cue.walls`
2. pickups → `cue.dots` (may replace)
3. `cue.under`
4. ghosts → `cue.ghost` (may replace or decorate each one)
5. player → `cue.player`
6. `cue.over`
7. score popups and banners

Each hook receives a `CueContext` with the canvas, tile size, the scene, a ready-made `power`
summary (`left`, `frac`, `sinceExpired`...), the palette and default drawing helpers. A cue may
also implement `sound(prev, frame, sfx)`.

The old implementations of the ten ideas live on the branches listed in `legacy/hub/index.html`
(worktrees under `~/.t3/worktrees/MazeGame/`); they are a starting point, not a spec.

## Data flow

`Game.svelte` calls `onframe(scene, game)` for every live frame. The telemetry module consumes
those, keeps a rolling buffer of recent scenes, measures each power-up as one **trial**, cuts a
**clip** around the end of the power-up, and writes both to Convex. It also keeps the **whole run**
(`telemetry/runrec.ts`): 10 Hz scenes, inputs, events and notes in chunks of about 5 s of game
time, each written once (`runChunks`), plus one index document when the run closes
(`runRecordings`); `/replays/run/<blockKey>` plays it back. Pages subscribe with
`useQuery`, so the dashboard updates while someone is playing in another tab.
