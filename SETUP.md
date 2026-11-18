# Setup: get Circle Chase running

For a person or a coding agent starting from a fresh clone. Every step below was run on a clean
clone of this branch (macOS, Node 26) and worked as written. Once it runs, read `README.md` (what
the tool is and how to use it) and `AGENTS.md` (how to work in the code).

## What you need

- **Node.js 22.17 or newer** (`node -v`). The project sets `engine-strict`, so an older Node makes
  `npm install` fail.
- **npm** (comes with Node).
- Internet access for the first run only: `npm install`, and Convex downloads its local backend
  binary the first time it starts.
- Optional: **Google Chrome** (the browser check scripts drive it through Playwright) and
  **ffmpeg** (only for `scripts/record-cues.mjs`).

No account, API key or `.env` file is needed. The database is a local Convex backend that runs on
this machine with no login.

## Steps

Run everything from the repository root.

```bash
# 1. Install dependencies (a few seconds to a minute)
npm install

# 2. Start the database. Leave this running in its own terminal.
npm run convex
```

Wait for the line `Convex functions ready!`. The first start downloads the backend and creates:

- `.env.local` with `PUBLIC_CONVEX_URL` (normally `http://127.0.0.1:3210`), which the app reads;
- `.convex/` with the local database.

Both are ignored by git. Do not create `.env.local` by hand.

```bash
# 3. In a second terminal: load the simulated demo data (about 40 s). Optional but recommended,
#    otherwise the dashboard and the replay list are empty.
npm run data:import

# 4. In the same second terminal: start the app. Leave it running.
npm run dev
```

Open **http://localhost:5173**. You should see the run console with thirteen case cards.

## Check that it works

- **Run console** `http://localhost:5173/`: pick a case, press Play, then Start. Arrow keys or WASD
  move; P pauses; E ends the run.
- **Dashboard** `http://localhost:5173/dashboard?source=bot`: the simulated view opens with a
  headline sentence and a ranking of the thirteen conditions (after step 3).
- **Replays** `http://localhost:5173/replays?source=bot`: a list of recorded moments (after step 3).

Command-line checks:

```bash
npm test         # unit tests: 264 pass (about a minute)
npm run check    # type check: 0 errors
npm run e2e      # end-to-end checks in headless Chrome; needs both servers running, takes
                 # several minutes, adds simulated play to the database and deletes nothing
```

## What `npm run data:import` does

It loads `data/simulated-demo.zip` (24 MB): two simulator runs of 40 simulated participants each
(15,380 power-ups, 10,326 replay clips, a few whole-run recordings) and no human data.

**It replaces everything in the local database.** Never run it on a database that holds real
study data. Simulated data is always labelled as simulated in the app and says nothing about
which real cue is better; it is there to show that every screen works.

`npm run data:export` writes the current local database to that same file.

## If something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| `npm install` fails with an engine error | Node is older than 22.17. Install a newer Node. |
| The app shows "Can't reach the database" | The Convex terminal is not running, or was started after the app. Start `npm run convex`, wait for "Convex functions ready!", then reload the page (restart `npm run dev` if `.env.local` did not exist when it started). |
| `npm run dev` says port 5173 is in use | Another copy is running. Stop it, or run `npx vite dev --port 5174` and use that port. |
| Convex prints different ports (for example 3212) | Port 3210 was taken, so it chose the next free pair and wrote them to `.env.local`. The app follows that file. The `scripts/*-e2e.mjs` checks assume 3210/3211 and 5173, so free those ports before running them. |
| `Local backend did not start ... within N seconds` | A large local database is slow to open. `npm run convex` already allows 240 s; wait, and make sure no second `convex dev` is running. |
| `npm run data:import` asks to confirm or fails on existing data | It runs with `--replace-all`; make sure `npm run convex` is running in the other terminal and try again. |
| Convex pushes fail with a TypeScript error | Convex type-checks the `convex/` folder on every save. Fix the error it prints; nothing is deployed until it passes. |
| The browser scripts cannot find a browser | They use the installed Google Chrome (`channel: 'chrome'`). Install Chrome, or change the channel in the script. |

## Notes for an agent working in the repository

- Read `AGENTS.md` first: conventions (imports use `#lib/...` with the file extension, SvelteKit 3
  specifics), commands, and the rules for several agents sharing one checkout.
- The two servers are long-running. Start each once, in the background or in its own terminal,
  and do not restart them to "refresh" things: Vite reloads on save and Convex pushes `convex/`
  on save. A server started inside a short-lived agent session stops when that session ends.
- `docs/ARCHITECTURE.md` explains the code layout, `docs/STUDY.md` what is measured and why,
  `docs/CUES.md` how the countdown cues are written, `convex/README.md` the data API.
- `legacy/` is the first single-file version of the game, kept for reference. Nothing imports it.
- `media/countdowns/` holds a short video of each of the thirteen conditions. Re-record them with
  `node scripts/record-cues.mjs` (needs the dev server and ffmpeg).
