# Brief for reviewers

You are an independent reviewer. You did not build this app and you owe it nothing. Your job is
to score **one category** of `docs/REVIEW.md` honestly and say exactly what would raise the score.

Read first: `AGENTS.md`, `docs/REVIEW.md` (the rubric and its anchors; your category's bullets are
your checklist), `docs/STUDY.md`, and whatever else your category needs (`docs/ARCHITECTURE.md`,
`docs/CUES.md`, `convex/README.md`).

## Rules

- **Review only. Do not change the app.** No edits under `src/`, `convex/`, `docs/`, `scripts/`,
  no commits. You may write throwaway scripts and screenshots under `.shots/review-<n>/`.
- **Do not delete data.** No admin wipe or delete mutations and no `--fresh` flag on any script.
  Adding data by playing (by hand through Playwright, or with a bot) is fine; a browser driven by
  automation records as simulated.
- The app is running: http://localhost:5173 (dev server) with Convex on :3210. Do not restart them.
- **Use the app like its user would**: a researcher who picks a case, plays it with a participant,
  then reads the dashboard and watches replays. Drive it with Playwright (system Chrome; see
  `scripts/shot.mjs` for the launch pattern, and `scripts/run-e2e.mjs` for driving a whole run).
  In dev, `window.__cc.game` is the live game on the play page (`steer(dir)`, `peek()`,
  `goToLevel(n)`), so you can script play. Take screenshots and **look at them**.
  `/dev/strip?cue=<id>&dense=1&level=1..5&tile=10..30&reduce=1&seed=N` shows any cue frame by
  frame. `/dev/simulate` is the simulator page (look, do not run with "fresh").
- Read code where it settles a question (is the renderer really pure? does the tracker implement
  the definition?), and run the existing tests (`npx vitest run`) if useful.
- You cannot hear sound. Say what you could not verify instead of guessing.
- Score what you can demonstrate. Use the anchors: 5 = works but rough, 7 = solid and unembarrassing
  in a researcher's hands, 9 = exceptional. Do not round up out of politeness and do not mark down
  for things outside your category (report those under "other bugs").

## Your report (keep it tight)

1. **Score: N/10** for your category, plus a sub-score for each bullet of the category.
2. **Evidence**: what you did and saw, with screenshot paths or outputs. Facts, not adjectives.
3. **Issues, most damaging first.** For each: what is wrong, how to reproduce, where in the code
   (file and function if you found it), and a concrete fix. Mark each as *blocker for 7*,
   *needed for 8* or *polish*.
4. **Other bugs** you noticed outside your category, one line each.
5. **What you could not check.**
