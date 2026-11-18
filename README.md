# Circle Chase

A maze game made for a UX design class. Eat every dot and keep away from the ghosts. After a power dot the ghosts turn blue and can be caught for a few seconds; the bar in the top wall shows how long you have.

**Play:** https://anderson00402.github.io/circle-chase/ (the main game, with a tab for every other version)

Controls: arrow keys or WASD to move, P to pause, M to turn sound on or off. On a phone, swipe on the board.

## Make your own version

You change your own copy of the game and send it back as a pull request. Only the owner (Anderson00402) merges into `main`, which is the live game, so trying things can't break it.

You need a free GitHub account and [GitHub Desktop](https://desktop.github.com).

1. **Get a copy.** In GitHub Desktop: File → Clone Repository → URL → type `Anderson00402/circle-chase` → Clone.
2. **Make a branch for your idea.** Current Branch → New Branch, named after the idea (for example `faster-ghosts`).
3. **Play it on your computer.** Double-click `Play on localhost (Mac).command` or `Play on localhost (Windows).bat` (Windows needs [Python](https://www.python.org/downloads/)). Or just open `index.html` in your browser. Refresh after every change.
4. **Change the game.** Everything is in `index.html`; see the map below. Save, refresh, repeat.
5. **Commit.** In GitHub Desktop, write a short summary of what you changed and click Commit.
6. **Send it.** Click Publish branch. GitHub Desktop asks whether to fork the repository: choose **To contribute to the parent project**. Then click **Create Pull Request** and say in a sentence or two what you changed and why.

Your version then shows up as a tab on the [home page](https://anderson00402.github.io/circle-chase/) within a few minutes, so anyone can play it. The owner plays it too, then merges it or leaves a comment on the pull request. For your next idea, switch to `main`, click Fetch origin and then Pull origin to get the latest game, and make a new branch.

## Play every version

**https://anderson00402.github.io/circle-chase/** opens the main game with tabs and dropdowns above it for every version branch and every open pull request; pick one to play that version right there. The address changes to `?v=<name>`, so you can send someone a link to one version. Pull requests run sandboxed there, because nobody has reviewed their code yet, so their best scores aren't saved.

The versions come in two dropdowns in the tab row. **Prototypes** are ideas for fixing the main game, such as `maze-blink` (the maze walls blink red as the power runs out). **Fun modes**, on the right, change the game just for fun (playing as a ghost, two players, dash, fog, Scream, fortnite). The main game stays the basic version, without any fun-mode extras. A branch counts as a prototype unless its name is in `FUN_MODES` (or `CONTROL`) in `tools/build_site.py` on `main`; when you send a pull request, say which kind your idea is.

The **control** tab, next to the main game, is for the class study: the same game with the default rules instead of our fixes (no power timer, ghosts that just flash white as the power runs out instead of blinking back to their own color, power that runs out sooner on later levels, and one ghost the same yellow as you). Comparing its play stats with main's shows whether the fixes help. It is listed in `CONTROL` in `tools/build_site.py`.

Each version also has its own page (`/v/<branch>/` or `/pr/<number>/`) with a label in the corner, and [/versions/](https://anderson00402.github.io/circle-chase/versions/) lists them all. To give a branch a one-line description on the home page, add it to `NOTES` in `tools/build_site.py` on `main`; otherwise the home page shows the branch's latest commit message.

## Where things are in index.html

- `MAZES`: the maze layouts, drawn with characters (`#` wall, `.` dot, `o` power dot, space for open floor). Each row is the left half of the maze; the right half is a mirror of it.
- `GHOST_PACE` and `SCARED_PACE`: how fast the ghosts move, as a share of your speed (60% and 35% when scared).
- `DIFFICULTY`: lives and how long a power dot lasts.
- `drawGhost`, and the player section of `draw()`: how the ghosts and the circle look and move.
- `blinkOn`: how the scared ghosts blink back to their own color, faster and faster, as a power-up runs out (the one fix this version adds to the default game).
- `sfx`: all the sounds, made in code.
- Colors are CSS variables at the top of the file, such as `--maze-wall`, `--you` and the ghost colors.
- `createStats` and `STATS_URL`: the play stats below.

## Play stats

For the class study, every game played on the website is saved to a free [Supabase](https://supabase.com) database (Postgres). Nothing personal is saved, and the title screen says that play times are recorded. Each game saves:

- **which version** was played (`main`, a branch name, `pr-<number>`, or `localhost`);
- **survival**: seconds from Start to the last death, and how long each life lasted. Pauses never count, because the game clock stops while paused. The **Time** box above the board shows it as you play, and the game-over card gives it to a tenth of a second;
- for **every power dot**: whether the player chased the scared ghosts, **how much power was left when they stopped chasing** (the number on the timer bar), and **how long from then until they ate the next power dot**.

*Stopped chasing* is worked out from the moves. A step toward the nearest scared ghost that doesn't lead toward any dot only makes sense if you're after the ghost; two of those without turning away start a chase, and the chase lasts while the circle keeps closing in. The last step of the chase (or the last ghost eaten) is the stop. Following a lane of dots that happens to lead to a ghost doesn't count, since eating dots looks the same.

Set-up: make a Supabase project, paste `tools/stats.sql` into its SQL Editor and run it, then put the project's URL and publishable key into `STATS_URL` and `STATS_KEY` in `index.html`. `tools/stats-queries.sql` has ready-made questions, such as survival per version and when players stop chasing. Nothing is sent while `STATS_URL` is empty, from a file opened on your computer, or from automated test browsers.

## Checks

If you have [Node](https://nodejs.org) installed, run `node tools/check.js` before sending a maze change. It checks that every dot can be reached, every lane is one tile wide and there are no dead ends, plays random games on each difficulty to catch errors, and checks the play stats on posed scenes.
