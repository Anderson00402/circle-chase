// Checks the game rules in index.html without a browser: node tools/check.js
// For every maze: all dots reachable, pen slots lead to the exit, no dead ends.
// Then the two-player rules, and random games on each difficulty to catch runtime errors.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const src = html.match(/<script id="core">([\s\S]*?)<\/script>/)[1];
const Core = new Function(src + '; return Core;')();

let fail = 0;
for (const def of Core.MAZES) {
  const m = Core.buildMaze(def);
  const at = (x, y) => m.tiles[y * m.W + x];
  const step = (x, y, d) => [(x + d.x + m.W) % m.W, y + d.y];

  const seen = new Set([m.start + '']);
  const queue = [m.start];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const d of Core.DIRS) {
      const [nx, ny] = step(x, y, d);
      if (ny < 0 || ny >= m.H || at(nx, ny) !== Core.PATH || seen.has(nx + ',' + ny)) continue;
      seen.add(nx + ',' + ny);
      queue.push([nx, ny]);
    }
  }
  let unreachable = 0;
  for (let i = 0; i < m.W * m.H; i++) if (m.dots[i] && !seen.has((i % m.W) + ',' + Math.floor(i / m.W))) unreachable++;

  let deadEnds = 0;
  for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
    if (at(x, y) !== Core.PATH) continue;
    let open = 0;
    for (const d of Core.DIRS) { const [nx, ny] = step(x, y, d); if (ny >= 0 && ny < m.H && at(nx, ny) !== Core.WALL) open++; }
    if (open < 2) deadEnds++;
  }

  // Lanes are one tile wide: no 2x2 block of open floor anywhere.
  const wide = [];
  for (let y = 0; y < m.H - 1; y++) for (let x = 0; x < m.W - 1; x++) {
    if ([[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]].every(([i, j]) => at(i, j) === Core.PATH)) wide.push(`(${x},${y})`);
  }

  const slots = m.penSlots.every(([x, y]) => at(x, y) === Core.PEN && m.distExit[y * m.W + x] > 0);
  const exit = at(...m.exit) === Core.PATH, start = at(...m.start) === Core.PATH;
  // Both players start on their own open tile.
  const spots = Core.startSpots(m);
  const starts = spots.length === Core.PLAYERS && spots.every(([x, y]) => at(x, y) === Core.PATH) &&
    new Set(spots.map(s => s + '')).size === spots.length;
  const ok = !unreachable && !deadEnds && !wide.length && slots && exit && start && starts;
  if (!ok) fail++;
  console.log(`${def.name}: ${m.W}x${m.H}, ${m.total} dots, unreachable ${unreachable}, dead ends ${deadEnds}, ` +
    `wide spots ${wide.length}${wide.length ? ' ' + wide.join(' ') : ''}, ` +
    `pen ${slots ? 'ok' : 'BROKEN'}, exit ${exit ? 'ok' : 'BROKEN'}, start ${start ? 'ok' : 'BROKEN'}, ` +
    `player starts ${starts ? spots.map(s => '(' + s + ')').join(' ') : 'BROKEN'} -> ${ok ? 'OK' : 'FAIL'}`);
}

// Ghost speed: slower than the player on level 1, faster every level until the cap, never faster
// than the player.
for (const key of Object.keys(Core.DIFFICULTY)) {
  const g = Core.createGame(key);
  const paces = Array.from({ length: 12 }, (_, i) => g.ghostPace(i + 1));
  const rising = paces.every((p, i) => i === 0 || p >= paces[i - 1]) && paces[1] > paces[0];
  const ok = rising && paces[0] < 0.85 && Math.max(...paces) <= 1;
  if (!ok) fail++;
  console.log(`${key} ghost speed by level: ${paces.map(p => Math.round(p * 100) + '%').join(' ')} -> ${ok ? 'OK' : 'FAIL'}`);
}

// Two players: separate scores, a player out of lives is not hit or moved, and the game ends only
// when both are out.
{
  const results = [];
  const check = (name, cond) => { results.push(name + (cond ? ' ok' : ' FAIL')); if (!cond) fail++; };
  // A game with every ghost kept in the pen, so nothing interferes unless a test puts it there.
  const quiet = () => {
    const g = Core.createGame('normal');
    g.state = 'playing';
    for (const e of g.enemies) { e.state = 'waiting'; e.releaseAt = Infinity; }
    return g;
  };
  const run = (g, secs) => { for (let i = 0; i < secs * 120; i++) g.update(1 / 120); };
  const ghostOn = (g, p) => Object.assign(g.enemies[1], { x: p.x, y: p.y, t: 0, dir: -1, state: 'active', scared: false });

  // Player 2 stands still on an empty tile; player 1 eats along the row.
  let g = quiet();
  const [p1, p2] = g.players;
  g.maze.dots[p2.y * g.maze.W + p2.x] = 0;
  Object.assign(p2, { dir: -1, want: -1 });
  run(g, 0.5);
  check('separate scores', p1.score > 0 && p2.score === 0);

  // steer(d, 1) turns player 2 only.
  g = quiet();
  const before = g.players[0].dir;
  g.steer(1, 1);
  check('steer(d, 1) is player 2', g.players[1].want === 1 && g.players[0].want === -1 && g.players[0].dir === before);

  // An out player is not hit and does not move.
  g = quiet();
  Object.assign(g.players[1], { lives: 0, out: true });
  const spot = [g.players[1].x, g.players[1].y];
  ghostOn(g, g.players[1]);
  run(g, 0.05);
  check('out player not hit', g.state === 'playing' && g.players[1].x === spot[0] && g.players[1].y === spot[1]);

  // A catch costs only that player a life, and the round restarts.
  g = quiet();
  ghostOn(g, g.players[1]);
  g.update(1 / 120);
  check('catch costs that player a life', g.state === 'dying' && g.caught === 1 &&
    g.players[1].lives === g.diff.lives - 1 && g.players[0].lives === g.diff.lives);
  run(g, 2);
  check('round restarts after a catch', g.state === 'ready' || g.state === 'playing');

  // Player 2 on their last life is caught: player 2 is out, the game goes on for player 1.
  g = quiet();
  g.players[1].lives = 1;
  ghostOn(g, g.players[1]);
  g.update(1 / 120);
  run(g, 2);
  check('last life puts the player out, game goes on', g.state !== 'over' && g.players[1].out && !g.players[0].out);

  // Player 1 caught on their last life while player 2 is already out: game over.
  for (const e of g.enemies) { e.state = 'waiting'; e.releaseAt = Infinity; }
  g.state = 'playing';
  g.players[0].lives = 1;
  ghostOn(g, g.players[0]);
  g.update(1 / 120);
  run(g, 2);
  check('game over when both are out', g.state === 'over');

  console.log('two players: ' + results.join(', '));
}

for (const key of Object.keys(Core.DIFFICULTY)) {
  for (let run = 0; run < 3; run++) {
    const g = Core.createGame(key);
    g.state = 'playing';
    for (let i = 0; i < 120 * 600 && g.state !== 'over'; i++) {
      if (i % 30 === 0) g.steer(Math.floor(Math.random() * 4));
      if (i % 30 === 15) g.steer(Math.floor(Math.random() * 4), 1);
      g.update(1 / 120);
      // now and then clear most dots so later mazes get played too
      if (g.state === 'playing' && Math.random() < 0.0005) {
        for (let j = 0; j < g.maze.dots.length && g.maze.left > 1; j++) if (g.maze.dots[j]) { g.maze.dots[j] = 0; g.maze.left--; }
      }
    }
  }
  console.log(`${key}: random play ran without errors`);
}

process.exit(fail ? 1 : 0);
