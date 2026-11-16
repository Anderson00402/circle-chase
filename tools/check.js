// Checks the game rules in index.html without a browser: node tools/check.js
// For every maze: all dots reachable, pen slots lead to the exit, no dead ends.
// Then plays random games on each difficulty to catch runtime errors.
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

// Dash: about DASH_MULT times the distance over DASH_TIME, refused while recharging, allowed after.
{
  const STEP = 1 / 120;
  // A game with the circle running left along the long bottom corridor and the ghosts kept home.
  const setup = () => {
    const g = Core.createGame('normal');
    g.state = 'playing';
    for (const e of g.enemies) { e.state = 'waiting'; e.releaseAt = Infinity; }
    Object.assign(g.player, { x: 16, y: 17, dir: 1, face: 1, t: 0 });
    return g;
  };
  const travel = useDash => {
    const g = setup();
    const x0 = g.pos(g.player)[0];
    if (useDash && !g.dash()) return NaN;
    for (let i = 0; i < Math.round(Core.DASH_TIME / STEP); i++) g.update(STEP);
    return x0 - g.pos(g.player)[0];
  };
  const plain = travel(false), dashed = travel(true), ratio = dashed / plain;

  const g = setup();
  const first = g.dash(), during = g.dash();
  for (let i = 0; i < Math.round((Core.DASH_COOLDOWN - 0.1) / STEP); i++) g.update(STEP);
  g.steer(3); g.update(STEP);
  const early = g.dash();
  for (let i = 0; i < Math.round(0.2 / STEP); i++) g.update(STEP);
  g.steer(1); g.update(STEP);
  const after = g.dash();
  g.player.dir = -1; g.want = -1; g.dashCool = 0;
  const still = g.dash();

  const ok = Math.abs(ratio - Core.DASH_MULT) < 0.2 && first && !during && !early && after && !still;
  if (!ok) fail++;
  console.log(`dash: ${plain.toFixed(2)} tiles plain vs ${dashed.toFixed(2)} dashing (x${ratio.toFixed(2)}), ` +
    `again at once ${during ? 'allowed' : 'refused'}, just before ${Core.DASH_COOLDOWN}s ${early ? 'allowed' : 'refused'}, ` +
    `after ${after ? 'allowed' : 'refused'}, standing still ${still ? 'allowed' : 'refused'} -> ${ok ? 'OK' : 'FAIL'}`);
}

for (const key of Object.keys(Core.DIFFICULTY)) {
  for (let run = 0; run < 3; run++) {
    const g = Core.createGame(key);
    g.state = 'playing';
    for (let i = 0; i < 120 * 600 && g.state !== 'over'; i++) {
      if (i % 30 === 0) g.steer(Math.floor(Math.random() * 4));
      if (i % 97 === 0) g.dash();
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
