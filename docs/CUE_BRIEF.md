# Brief: rebuilding the ten cue ideas

Read `AGENTS.md`, `docs/CUES.md` (the API and its four rules) and the "Conditions" section of
`docs/STUDY.md` first.

Each of the ten ideas was prototyped once, in a hurry, in the old single-file game. Your job is
not to port them: it is to **make each one the best version of its idea** on the new renderer.
Start from the idea, look at the old attempt and its known weak points, then design it properly.

## What every cue must do

- **Read at a glance, with no explanation.** A first-time player in the middle of a chase should
  get it. Early in the power-up it feels calm and full; the last 2 seconds unmistakably say
  "about to end"; the moment it ends is obvious; nothing lingers confusingly afterwards.
- **Give continuous information where the idea allows** (how much is left, not only "soon"), and a
  clear *final warning* that starts at a consistent time before the end (about 2 s) whatever the
  power length.
- **Work for any power length from 2 s to 9 s.** In the study each power-up lasts a random
  4-8 s; in arcade mode it is fixed per level and can be as short as 2 s.
- **One signal only.** `baseFlash: false`. Do not blink the ghosts white. Do not add a second,
  different signal "to be safe"; if the idea has a visual and a sound that are the same message
  (a heartbeat you see and hear), that is one signal and fine.
- **Pure.** No state between frames; everything from `k` (see CUES.md). The film strip and
  replays draw frames out of order.
- **Stay readable in every situation:** all five maze themes (levels 1-5), several scared ghosts
  or only one, ghosts eaten and returning as eyes, ghosts in the pen, the freeze when a ghost is
  eaten, a second power dot eaten mid-power (`serial` changes, timer restarts), death or level
  clear mid-power (the cue just stops; end animations only play when `power.sinceExpired` says the
  timer ran out), in a tunnel (wrapped copies), at small sizes (tile 10 px) and large (34 px),
  and with reduced motion.
- **Not get in the way.** The player must still see dots, walls, ghosts and themselves.
- **Fit the game's look**: use the palette and helpers in `k`, the display font for any text.
- Fill in `name`, `tagline` (one short sentence), `description` (what the player sees from start
  to end, 2-3 sentences, plain words), `channel`, `role: 'idea'`, and `code` ("1".."10").

## How to check your work

- Film strip: `http://localhost:5173/dev/strip?cue=<id>` shows one bot-played power-up as frames
  from start to after the end. Options: `&dense=1` (many frames in the last 2.4 s and just after),
  `&level=1..5` (maze themes), `&tile=10..30`, `&seed=N` (another situation), `&reduce=1`.
  Screenshot it: `node scripts/shot.mjs "/dev/strip?cue=<id>&dense=1&tile=20" .shots/cue-<id>-dense.png --w 1900 --h 1100 --full`
  then **look at the image critically**. Do this for both normal and dense strips, at least two
  levels, small and large tiles, and reduced motion.
- Live: `/play/<id>?mode=study` (power dots grow back, power length is random). In dev,
  `window.__cc.game` is the live game if you want to drive it from Playwright.
- `npm run check` for types (only your files count). Add no new dependencies.

## Files

One file per cue: `src/lib/game/cues/<id>.ts`, exporting the cue. Register it in
`src/lib/game/cues/index.ts` (other agents add theirs to the same file at the same time: re-read
the file right before editing, add only your import lines and array entries, and keep `CUES` in
code order A, B, 0, 1..10). Shared helpers for several of your cues can go in
`src/lib/game/cues/shared-<yourarea>.ts`. If the drawing API lacks something, prefer solving it
inside your cue; if it truly belongs in the renderer, add it there minimally and say so in your
report.

The old prototypes, for reference only (each is a full single-file game; search for the idea's
drawing code): `~/.t3/worktrees/MazeGame/<dir>/index.html`

| Code | Id | Old prototype dir |
| --- | --- | --- |
| 1 | ink-refill | t3-f4189158-2fdc4703931ba43c |
| 2 | clock-halos | t3-cd048767-5672fbf95e33a0a2 |
| 3 | burning-fuse | t3-05669012-3ea891e8b5daa3c2 |
| 4 | wall-tide | t3-e1f432e9-7431d76ee94c9f19 |
| 5 | heartbeat | t3-8bd031d1-550cc02851c17ed6 |
| 6 | waking-ghosts | t3-b45400c5-e67c108c1b5eac1d |
| 7 | pen-hourglass | t3-39caec44-eb6f92d71d628e94 |
| 8 | deflating-player | t3-48da0e1e-e599564fa9f2f055 |
| 9 | final-count | t3-d6de5e5b-4166156630228cc4 |
| 10 | dot-sweep | t3-7ba5054c-3d931160fd179ca9 |

## Report

For each cue: what the player sees from start to end, what you changed from the old attempt and
why, how it behaves with reduced motion, its honest weak point as a signal (every cue has one),
and the screenshot paths you judged it by. Commit your own files as you go.
