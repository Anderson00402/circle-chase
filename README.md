# Circle Chase

Circle Chase is a maze-chase game built to answer one question: **do players know when a power-up
is about to run out, and which on-screen signal tells them best?** A researcher sits with each
participant, picks one of 13 signals ("cases") and lets them play it; every power-up is measured
automatically, stored in a local database, and can be watched again as a replay. A live dashboard
compares the cases with the statistics a report needs.

It is an internal tool for the people running the study, not a public site.

## Start it

You need a recent Node (20 or later; developed on 26) and Google Chrome (for the checks).

```sh
npm install
npm run convex      # the database; leave it running in its own terminal
npm run dev         # the app; in a second terminal
```

Then open <http://localhost:5173>.

- `npm run convex` starts a local Convex backend on this machine (no account, nothing leaves the
  machine): the API on port 3210, downloads on port 3211. The first run creates `.env.local` with
  `PUBLIC_CONVEX_URL=http://127.0.0.1:3210` and `PUBLIC_CONVEX_SITE_URL=http://127.0.0.1:3211`.
- With a large database (the simulated data is about 2 GB) the backend needs about 30 s to start;
  the command already allows it 240 s. A fresh database starts in a second or two.
- The top bar says "Saved" when everything played has reached the database. If it says it cannot
  reach the database, check that `npm run convex` is still running; nothing played is lost, it is
  kept in the browser and sent when the database is back.

## The three screens

| Screen | Address | What it is for |
| --- | --- | --- |
| **Run** (the console) | `/` | Type the participant label, see the suggested next case, play it, rate it afterwards. Everything during a session happens here. |
| **Dashboard** | `/dashboard` | The results: which case leads, how sure that is, why, and the data quality. Live while people play. Human data by default; "Simulated" shows one simulator run at a time. Downloads are in its header. |
| **Replays** | `/replays` | Every power-up with a clip, filterable by case, outcome and participant. Opens a player that shows exactly what the participant saw, with the moment of each decision marked. |

Two small developer pages sit apart in the top bar: the simulator (`/dev/simulate`) and a film
strip of the cues (`/dev/strip`).

## A session with a participant

1. Open the console (`/`). Type a label for the person (for example `P07`), or leave it empty and
   the console names them by their number (`#7`).
2. The console suggests the next case from a counterbalanced order (a balanced Latin square row
   picked by the participant's number). Keep the suggestion unless there is a reason not to; the
   order actually played is recorded either way.
3. Pick the run length (default 16 power-ups, about 4 minutes) and press Play. The participant
   plays; the run ends by itself after the last power-up has been measured. End run stops it early.
4. After the run, ask the two questions on screen (how clear the signal was, how much it got in the
   way, 1 to 7), or skip them.
5. Back on the console, the next suggested case is ready. All 13 cases take about 50 minutes of
   play; split them over two sittings rather than shortening the runs.

A refresh or a closed tab during a run is safe: the run continues where it was and its counts add
up across pages. The power-up that was on at the moment of the refresh is stored as interrupted and
left out of the rates.

If the database turns a write down several times (for example after a code change), a red "1 write
refused" button appears next to the save status. Open it to see what it is, try it again, download
it as a file, or discard it.

## Where the data is, and how to get it out

- Everything is in the local database under `.convex/local/default/` on this machine. Back it up
  by copying the `.convex` folder while `npm run convex` is stopped.
- **Downloads**: on the dashboard, the buttons in the header download the data of the current view
  (human or a simulator run, with its filters): Power-ups CSV (one row per power-up with every
  measure), Power-ups JSON (the same, with the 10 Hz series), Answers CSV (the questionnaire) and
  Runs CSV (one row per run of a case). The same files are at
  `http://127.0.0.1:3211/export/trials.csv?source=human` and so on (`trials`, `ratings`, `blocks`;
  `.csv` or `.json`).
- In the files, `consoleNumber` is the participant number the console shows (`#7`);
  `participantNumber` is a different, overall count. Join on `participantId` or `consoleNumber`.
- A file that could not be read to the end says so on its last line (`EXPORT FAILED: ...`); a
  complete file never has that line.
- Every outcome can be worked out again from the Power-ups CSV alone: `node scripts/csv-reclassify.mjs`.

## Simulated demo data in the repository

`data/simulated-demo.zip` (about 24 MB) is a snapshot of the simulated data set: one planted and
one flat simulator run of 40 simulated participants each, 15,380 power-ups, 10,326 replay clips and
a few whole-run recordings. It holds no human data. The local database file itself is not in the
repository (it is about 2 GB, mostly old revisions the snapshot leaves out).

To load it into a fresh checkout, start Convex once (`npm run convex`), then in another terminal:

```
npm run data:import
```

This **replaces everything** in the local database with the snapshot, so do not run it on a
database that holds study data. `npm run data:export` writes the current database to the same file.

## Before a real study: clear the simulated data

The database ships with two simulated runs of 40 participants each (a "planted" run where the cases
were given different quality on purpose, and a "flat" run where they were not). They are never
mixed into the human view, but a clean database is simpler:

1. Download anything you want to keep from the dashboard's Simulated view.
2. Open `/dev/simulate`, press "Delete all simulated data", type `delete simulated data` and confirm. Human rows are not
   touched. (Deleting runs in the background; the counts on that page fall to zero when it is done.)

To start completely fresh instead, stop `npm run convex`, move the `.convex` folder somewhere safe,
and start it again.

## The simulator, and what it is evidence of

`node scripts/simulate.mjs --preset planted --participants 40` plays the real game with simulated
players, through the same pipeline and database as people (`--preset flat` gives every case the
same quality; `--summary` prints the results of stored runs without playing). The data is tagged
as simulated and stays out of the human view.

It shows that the pipeline works: the planted run's order is recovered (rank correlation -0.99) and
the flat run shows no difference, using the same statistics as the dashboard. **It is no evidence
about the signals themselves**: a simulated player cannot see a cue; it is told how well it knows
the time left. Its yield (about 5 decisions per run of 16 power-ups) is a guess about people, to be
checked in the pilot.

## Checks

| Command | What it checks | Time |
| --- | --- | --- |
| `npm test` | Unit tests: the game, the measure, the statistics, the outbox, the data functions (in-memory database) | under a minute |
| `npm run check` | Types across the whole project | about a minute |
| `npm run e2e` | In Chrome against the running app: a full run with refreshes, the outbox offline and after a closed tab, and every download (adds a little simulated play, deletes nothing) | several minutes |

The e2e checks need `npm run convex` and `npm run dev` running.

## Deeper documents

- [`docs/STUDY.md`](docs/STUDY.md): what is measured and why, every rule, the primary analysis
  fixed in advance, the checklist before collecting data, and the limitations to report.
- [`convex/README.md`](convex/README.md): the database, every function, the download columns, the
  outbox, database growth.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): how the code is organised (read before changing it).
- [`docs/CUES.md`](docs/CUES.md): the 13 signals.
- [`AGENTS.md`](AGENTS.md): conventions for anyone (or any agent) changing the code.

## Known limits

- **Local database only.** Data lives on the machine that runs `npm run convex`. Collecting on
  other machines, or on several at once, needs a Convex account and a cloud deployment (`npx convex
  deploy`), and the app's `PUBLIC_CONVEX_URL` pointed at it.
- **Sound has never been checked by ear.** Check it on the study machine before the first session.
- **No human data yet.** Every figure so far comes from the simulator. Run the 2 or 3 person pilot
  in `docs/STUDY.md` ("Before collecting data") first.
- **One maze and one set of study rules.** Results may not carry over to other layouts or speeds.
- The database file grows with every power-up (about 50 KB each now; it was about 130 KB before
  the digests were split into chunks), so a large database takes longer to start.
