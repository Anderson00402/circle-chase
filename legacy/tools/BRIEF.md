# Power countdown variant: shared brief

You are building ONE variant of a power-up countdown cue for "Circle Chase", a single-file canvas maze
game (`index.html` at the root of your checkout). The player eats a power dot, ghosts become
"scared" for `g.fright` seconds (out of `g.frightTotal`), and then turn dangerous again. **The
problem: players get no useful feel for when the power will run out.** Your job is to give one
thoughtful, distinct cue for that, described in your task.

## Rules for every variant
1. **Remove the existing timer bar** drawn over the top wall (the block commented
   `// Power timer: a bar in the top wall...` in `draw()`). That bar was "idea 1" and must not
   appear in your variant. No other progress bar or digital seconds readout may replace it unless
   your task explicitly says so.
2. The existing white ghost flash in the last 2 s (`powerFlash`) may be kept, changed or removed,
   whichever serves your idea best. Your idea must be the main signal, readable on its own.
3. Do not change game rules in the `<script id="core">` block (durations, speeds, scoring).
   Reading `g.fright`, `g.frightTotal`, `g.enemies`, `g.time` etc. from the drawing code is fine.
4. Drive all animation from game time (`game.time` / `g.fright`) or `performance.now()`, never CSS
   animations or `setTimeout`: the recorder uses a virtual clock, and pausing must freeze the cue.
5. Respect `prefers-reduced-motion` (the code already has `reduce`): keep the cue readable without
   motion (for example a static version), just less animated.
6. Follow the existing code style: same colour tokens in `C` / `:root`, short comments explaining
   the intent, no new libraries. If you add a sound, add it through the existing `sfx` object and
   honour `settings.sound`.
7. The cue must make sense the moment you see it: early in the power it should feel calm and full,
   the last ~2 s must clearly say "about to end", and the moment it ends must be obvious.
8. It should still look good at the end of a power-up when ghosts are mid-return (eyes),
   still in the pen, or just eaten.

## Recording the GIF
A deterministic recorder exists in the main checkout. Run it against YOUR checkout's file:

    node /Users/development/Code/MazeGame/tools/record-gif.mjs \
      --html "$PWD/index.html" --out "$PWD/media/<slug>.gif"

It plays a scripted run (eats the power dot, eats one ghost, then dodges until the power ends,
plus ~1.6 s afterwards) at 1448x1590. Takes ~40 s. Inspect the result by extracting frames, e.g.

    ffmpeg -v error -y -i media/<slug>.gif -vf "select='not(mod(n\,20))',scale=360:-1,tile=4x3" -frames:v 1 /tmp/<slug>-sheet.png

and look at the sheet (Read the png). Iterate until the cue reads well across the whole power-up,
especially the last 2 s. Delete `media/baseline.gif` from your checkout if it is there so only your
GIF remains in `media/`.

## Finish
- Commit `index.html` and `media/<slug>.gif` in your checkout on its branch (message: short summary;
  end the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). Do not push.
- Final reply, in this order: the absolute path to the GIF; a 2-3 sentence description of what the
  player sees from start to end of the power-up; any trade-offs. Keep it short.
