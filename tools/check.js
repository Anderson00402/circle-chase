// Checks the game rules in index.html without a browser: node tools/check.js
// For every maze: all dots reachable, pen slots lead to the exit, no dead ends.
// Then checks the speeds, that the computer's circle can clear every maze and that every level
// ends, and plays random games on each difficulty to catch runtime errors.
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
  const ok = !unreachable && !deadEnds && !wide.length && slots && exit && start;
  if (!ok) fail++;
  console.log(`${def.name}: ${m.W}x${m.H}, ${m.total} dots, unreachable ${unreachable}, dead ends ${deadEnds}, ` +
    `wide spots ${wide.length}${wide.length ? ' ' + wide.join(' ') : ''}, ` +
    `pen ${slots ? 'ok' : 'BROKEN'}, exit ${exit ? 'ok' : 'BROKEN'}, start ${start ? 'ok' : 'BROKEN'} -> ${ok ? 'OK' : 'FAIL'}`);
}

// Speeds: the computer ghosts keep one speed every level (a sharper circle makes later levels
// harder instead), and the circle is a little faster than your ghost.
for (const key of Object.keys(Core.DIFFICULTY)) {
  const g = Core.createGame(key);
  const paces = Array.from({ length: 12 }, (_, i) => g.ghostPace(i + 1));
  const ok = paces.every(p => p === paces[0]) && paces[0] < 1 && Core.YOU_PACE < 1;
  if (!ok) fail++;
  console.log(`${key} teammate speed by level: ${paces.map(p => Math.round(p * 100) + '%').join(' ')}, ` +
    `yours ${Math.round(Core.YOU_PACE * 100)}% -> ${ok ? 'OK' : 'FAIL'}`);
}

// With every ghost held in the pen, the computer's circle must clear each maze on its own
// (it never gets stuck going back and forth).
for (let level = 1; level <= Core.MAZES.length; level++) {
  const g = Core.createGame('normal');
  g.startLevel(level);
  for (const e of g.enemies) { e.state = 'waiting'; e.releaseAt = Infinity; }
  g.state = 'playing';
  let i = 0;
  for (; i < 120 * 180 && g.state === 'playing'; i++) g.update(1 / 120);
  const ok = g.state === 'escaped' && g.maze.left === 0;
  if (!ok) fail++;
  console.log(`${g.maze.name}: the circle alone ${ok ? `cleared it in ${(i / 120).toFixed(0)} s` : `left ${g.maze.left} dots`} -> ${ok ? 'OK' : 'FAIL'}`);
}

// After a power dot your ghost is scared like the rest; if the circle eats it, it floats home on
// its own and comes back under your control.
{
  const g = Core.createGame('normal');
  for (const e of g.enemies.slice(1)) { e.state = 'waiting'; e.releaseAt = Infinity; }
  const m = g.maze, you = g.enemies[0];
  const power = m.dots.findIndex(d => d === 2);
  Object.assign(g.player, { x: power % m.W, y: Math.floor(power / m.W), dir: -1, t: 0 });
  g.state = 'playing';
  g.update(1 / 120);
  const scared = g.fright > 0 && you.scared;
  // Put your ghost right on the circle while it is scared.
  Object.assign(you, { x: g.player.x, y: g.player.y, t: 0, dir: -1 });
  let i = 0, eaten = false, back = false;
  for (; i < 120 * 30 && !back; i++) {
    g.update(1 / 120);
    if (you.state === 'returning') eaten = true;
    if (eaten && you.state === 'active') back = true;
  }
  // Once back, a key press turns it.
  const before = you.dir;
  for (let d = 0; d < 4; d++) if (d !== before) { g.steer(d); break; }
  for (let k = 0; k < 120 && you.dir === before; k++) g.update(1 / 120);
  const steers = you.dir !== before;
  const ok = scared && eaten && back && steers;
  if (!ok) fail++;
  console.log(`your ghost: scared by a power dot ${scared ? 'yes' : 'NO'}, eaten ${eaten ? 'yes' : 'NO'}, ` +
    `back in ${(i / 120).toFixed(1)} s ${back ? 'yes' : 'NO'}, steers again ${steers ? 'yes' : 'NO'} -> ${ok ? 'OK' : 'FAIL'}`);
}

// Every level ends one way or the other: the circle is caught 3 times or eats every dot.
const LEVEL_LIMIT = 600; // seconds; an idle player's level can run a few minutes, a stuck one forever
for (const [name, steer] of [['idle', () => {}], ['random', (g, i) => { if (i % 30 === 0) g.steer(Math.floor(Math.random() * 4)); }]]) {
  let longest = 0, levels = 0, ok = true;
  for (let run = 0; run < 6; run++) {
    const g = Core.createGame('normal');
    let since = 0;
    for (let i = 0; i < 120 * 900 && g.state !== 'over'; i++) {
      const was = g.state;
      steer(g, i);
      g.update(1 / 120);
      if (g.state === 'playing' || g.state === 'dying' || g.state === 'ready') since += 1 / 120;
      if (was !== g.state && (g.state === 'clear' || g.state === 'escaped')) { longest = Math.max(longest, since); since = 0; levels++; }
      if (since > LEVEL_LIMIT) { ok = false; break; }
    }
  }
  if (!ok) fail++;
  console.log(`${name} player: ${levels} levels ended, longest ${longest.toFixed(0)} s (limit ${LEVEL_LIMIT} s) -> ${ok ? 'OK' : 'FAIL'}`);
}

for (const key of Object.keys(Core.DIFFICULTY)) {
  for (let run = 0; run < 3; run++) {
    const g = Core.createGame(key);
    g.state = 'playing';
    for (let i = 0; i < 120 * 600 && g.state !== 'over'; i++) {
      if (i % 30 === 0) g.steer(Math.floor(Math.random() * 4));
      g.update(1 / 120);
      // now and then skip ahead a level so later mazes get played too
      if (g.state === 'playing' && Math.random() < 0.0005) g.startLevel(g.level + 1);
    }
  }
  console.log(`${key}: random play (your ghost steered at random) ran without errors`);
}

// Play stats, playing as the ghost: survival runs from Start until the circle eats its last dot.
// Catching it (even winning a level) doesn't stop the clock, and no power-ups or lives are saved.
const near = (a, b) => a != null && Math.abs(a - b) < 0.011;
const stat = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`stats, ${name}: ${detail} -> ${ok ? 'OK' : 'FAIL'}`);
};
{
  const g = Core.createGame('normal');
  const s = Core.createStats(g);
  g.time = 30;
  ['die', 'die', 'die', 'clear', 'level', 'power', 'eat'].forEach(t => s.event(t));
  const afterWin = s.survival();
  g.time = 50;
  s.event('escaped');
  g.time = 52.2; // GOT AWAY, then GAME OVER
  const shown = s.survival();
  const { play, powers } = s.finish('game_over');
  stat('ghost: survival stops when the circle escapes', near(afterWin, 30) && near(shown, 50) && near(play.survival_s, 50) &&
    powers.length === 0 && play.life_s.length === 0 && play.ended === 'game_over' && s.finish('quit') === null,
  `${afterWin}s after a won level, ${shown}s after the escape, saved ${play.survival_s}s, ${powers.length} power-ups`);
}
{
  // Real games: the clock stops at the moment the circle eats its last dot.
  const bad = [];
  let games = 0;
  for (const key of Object.keys(Core.DIFFICULTY)) {
    let s, escapedAt = null;
    const g = Core.createGame(key, type => { s.event(type); if (type === 'escaped') escapedAt = g.time; });
    s = Core.createStats(g);
    for (let i = 0; i < 120 * 900 && g.state !== 'over'; i++) {
      if (i % 30 === 0) g.steer(Math.floor(Math.random() * 4));
      // after a minute, leave the circle one dot so the game ends
      if (i === 120 * 60 && g.state === 'playing') {
        for (let j = 0; j < g.maze.dots.length && g.maze.left > 1; j++) if (g.maze.dots[j]) { g.maze.dots[j] = 0; g.maze.left--; }
      }
      g.update(1 / 120);
      s.step(1 / 120);
    }
    games++;
    const data = s.finish(g.state === 'over' ? 'game_over' : 'quit');
    if (g.state === 'over' && !(escapedAt && near(data.play.survival_s, escapedAt) && g.time > escapedAt + 1)) bad.push(`${key}: saved ${data.play.survival_s} vs escape ${escapedAt}`);
    if (g.state !== 'over' && !near(data.play.survival_s, g.time)) bad.push(`${key}: quit at ${g.time} saved ${data.play.survival_s}`);
  }
  stat('ghost: real games', !bad.length, `${games} games${bad.length ? '; ' + bad.join('; ') : ''}`);
}

process.exit(fail ? 1 : 0);
