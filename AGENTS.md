# Circle Chase

A maze-chase arcade game built as a **research instrument**. The question it answers:

> Do players know when a power-up is about to run out, and which on-screen signal ("cue") tells
> them best?

The game plays like the classic maze-chase genre (dots, power dots, four chasers with different
personalities, tunnels, levels), but it is **an original game**: our own characters, mazes, names,
art and sounds. Never reproduce the name, characters, maze layouts, art or music of Pac-Man or any
other existing game. Genre mechanics are fine; a recognisable copy is not.

Thirteen conditions ("cases": two references, a timer bar and ten alternative cues) can be plugged
into the same game. Every power-up a person plays is measured, stored in Convex, replayable, and
compared on a live dashboard.

**It is an internal tool for the researchers who run the study**, not a public site. A researcher
sits with the participant and drives everything: pick a case, play that case, look at the data. So
the app is three focused screens (the run console, the dashboard, replays) with no marketing, no
onboarding wizard and no practice round. Clear and quick to operate beats explanatory.

Read `docs/ARCHITECTURE.md` before changing code and `docs/STUDY.md` before touching anything that
measures, stores or shows data.

## Stack

- SvelteKit 3 + Svelte 5 (runes), TypeScript, single-page app (`ssr = false`), static adapter.
- Convex for data, real-time queries through `convex-svelte` (`useQuery`, `useConvexClient`).
  Local deployment, no account: data lives on this machine (`.convex/`, port 3210).
- Canvas 2D for the game. Vitest for unit tests. Playwright (system Chrome) for browser checks.

## Commands

| What | Command |
| --- | --- |
| App dev server (port 5173) | `npm run dev` |
| Convex dev (pushes `convex/` on save) | `npm run convex` |
| Type check | `npm run check` |
| Unit tests | `npm test` (or `npx vitest run <path>`) |
| Screenshot a page | `node scripts/shot.mjs /play/timer-bar .shots/x.png --keys "Enter" --wait 3000` |

## Conventions

- Imports from `src/lib` use `#lib/...` **with the file extension**: `#lib/game/cues/index.ts`,
  `#lib/game/Game.svelte`. Relative imports inside `src/lib` need no extension. Convex code is
  imported as `#convex/_generated/api.js`. There is no `$lib` and no `$env`; public env values come
  from `import.meta.env.PUBLIC_*`.
- SvelteKit 3 differs from older versions (config lives in `vite.config.ts`, `$app/state` instead
  of stores). Check `node_modules/@sveltejs/kit/types/index.d.ts` rather than guessing.
- Tabs for indentation. Comments explain intent in plain words. No new dependencies without a
  clear need; say so in your report when you add one.
- Game animation is driven by game time (`frame.t`), never wall-clock time, CSS animation or
  timers: replays and pausing depend on it.
- Respect `prefers-reduced-motion` and the sound setting everywhere.
- UI text: plain words, sentence case, no jargon, no em dashes.

## Working in parallel with other agents

Several agents work in this checkout at the same time.

- **Stay in the files your task lists as yours.** If you need a change in someone else's file,
  make the smallest additive change, and say so in your final report. `src/lib/game/types.ts` is
  shared: only add to it (new optional fields, new helpers), never rename or remove; re-read it
  right before each edit.
- The dev server (:5173) and Convex watcher (:3210) are **already running and shared**. Do not
  start, stop or restart them, and do not run `vite build`. Logs are in `.logs/`. If one is down,
  restart it with the command above and say so in your report.
- `npm run check` reports the whole project. Only errors in your own files are yours; others may
  be mid-edit. Re-run before you finish.
- Commit only your own files: `git add <your paths> && git commit -m "..."`. Never `git add -A`,
  `git stash`, `git reset`, `git checkout -- <file>` or anything else that touches other people's
  work. If git reports a lock, wait a few seconds and retry. Do not push.
- Put screenshots in `.shots/<your-area>-*.png` (ignored by git).
