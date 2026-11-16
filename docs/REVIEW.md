# Review rubric

After the first full build, the app is scored in five categories, 1-10 each, by reviewers who did
not write the code. Work continues in rounds until **every category is at least 7**.

Anchors, the same for every category:

- **3**: present but broken or confusing in normal use.
- **5**: works, but rough; you would have to explain or apologise while demoing it.
- **7**: solid; a professor could use it unaided and nothing embarrassing happens. The bar.
- **9**: exceptional; people ask how it was made.

A reviewer scores what they can demonstrate: every score comes with evidence (what they did, what
they saw, screenshots or query output) and a short, ordered list of the changes that would raise
it most. Bugs found while reviewing are reported even when outside the category.

## 1. Gameplay and feel

Does it play like a good arcade maze-chase game while being an original one?

- Controls: turns register when intended, corners feel smooth, no stuck states, pause works.
- Ghosts: four personalities you can tell apart; fair but threatening; scared/eaten states clear.
- Levels: several mazes with their own look, difficulty ramps, bonus items, lives, score, game over.
- Look and sound: crisp at any size, readable at a glance, original characters and art, good
  feedback for every event, sound that helps and can be muted.
- Runs at 60 fps on a laptop; fits the screen without scrolling.

## 2. Countdown cues

Do the thirteen conditions do their job as stimuli?

- Each of the ten ideas is immediately understandable, clearly different from the others, and
  polished from the first frame of the power-up to just after it ends.
- "Calm and full" early, unmistakably "about to end" in the last 2 s, and the end itself is obvious.
- One signal per condition (only classic blink blinks); the base game never leaks the time left.
- Readable in every maze theme, with several ghosts, when ghosts are eaten, at small sizes, with
  reduced motion; sound cues respect mute.
- The gallery lets someone see and compare all of them in a minute.

## 3. Data collection

Would you trust the numbers?

- Every measure in `docs/STUDY.md` is recorded as defined; outcome classes match what actually
  happened when you watch the replay of the same trial.
- Study mode runs a participant through counterbalanced blocks with random power lengths, collects
  ratings, and cannot lose data on refresh, tab close or a dropped connection.
- Context is complete (cue, order, sound, input, frame rate, version, human vs bot).
- Data arrives in Convex in real time; export works; test coverage on the tracker's edge cases.

## 4. Analytics and visualisation

Does the dashboard answer "which cue works best?" at first glance, honestly?

- A newcomer can read the main finding in ten seconds and find the definition of every number.
- Rates come with sample sizes and uncertainty; thin data is flagged; bots are never mixed in
  silently.
- Depth is there when you look for it: distributions of turn-away time, outcome breakdowns,
  approach curves, learning over trials, ratings, per-participant views, filters.
- Updates live while someone plays; fast; charts are legible and consistent.

## 5. Replays and product experience

Can you watch the moment a player misjudged the timer, and is the whole thing a finished product?

- Replays redraw the real game with the real cue; scrubbing, slow motion and stepping work; the
  timeline marks power start, eats, the turn-away, the end and a death; the distance chart moves
  with the playhead; finding interesting moments is easy (filters, worst and best first).
- From any trial or chart you can jump to its replay.
- Navigation is obvious, pages load without errors, empty states explain themselves, the home page
  says what this is, it works at laptop and phone widths, keyboard accessible, consistent design.
