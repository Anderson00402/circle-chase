# Circle Chase

A maze game made for a UX design class. Eat every dot and keep away from the ghosts. After a power dot the ghosts turn blue and can be caught for a few seconds; the bar in the top wall shows how long you have.

**Play:** https://anderson00402.github.io/circle-chase/

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

The owner plays your branch, then merges it or leaves a comment on the pull request. For your next idea, switch to `main`, click Fetch origin and then Pull origin to get the latest game, and make a new branch.

## Where things are in index.html

- `MAZES`: the maze layouts, drawn with characters (`#` wall, `.` dot, `o` power dot, space for open floor). Each row is the left half of the maze; the right half is a mirror of it.
- `DIFFICULTY`: lives, ghost speed and how long a power dot lasts.
- `drawGhost`, and the player section of `draw()`: how the ghosts and the circle look and move.
- `sfx`: all the sounds, made in code. (The owner's copy can also play sound files from a `sounds/` folder that isn't shared; without it you hear the built-in sounds.)
- Colors are CSS variables at the top of the file, such as `--maze-wall`, `--you` and the ghost colors.

## Checks

If you have [Node](https://nodejs.org) installed, run `node tools/check.js` before sending a maze change. It checks that every dot can be reached, every lane is one tile wide and there are no dead ends, then plays random games on each difficulty to catch errors.
