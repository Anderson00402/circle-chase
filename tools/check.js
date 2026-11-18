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
  const ok = paces.every(p => p === Core.GHOST_PACE) && Core.YOU_PACE < 1;
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

// The power running out: in the last 3 s the scared ghosts blink to their own color and back,
// more often every second, and never outside those 3 s.
{
  const counts = [0, 0, 0, 0]; // blinks with 4-3, 3-2, 2-1 and 1-0 s of power left
  let on = false, firstAt = null;
  for (let i = 4000; i > 0; i--) {
    const left = i / 1000, now = Core.blinkOn(left);
    if (now && !on) { counts[Math.min(3, Math.floor(4 - left))]++; if (firstAt === null) firstAt = left; }
    on = now;
  }
  const ok = counts[0] === 0 && counts[1] > 0 && counts[1] < counts[2] && counts[2] < counts[3] && firstAt === 3 &&
    !Core.blinkOn(0) && !Core.blinkOn(3.01) && !Core.blinkOn(6);
  if (!ok) fail++;
  console.log(`power running out: blinks with 4-3, 3-2, 2-1, 1-0 s left: ${counts.join(', ')} (first at ${firstAt} s) -> ${ok ? 'OK' : 'FAIL'}`);
}

// A power dot scares every ghost, even those still in the pen: they come out scared and stay scared
// until the power runs out. A ghost eaten during the power-up comes back out normal.
{
  let x = 7;
  const rng = () => (x = (x * 16807) % 2147483647) / 2147483647;
  const g = Core.createGame('normal', () => {}, rng);
  g.state = 'playing';
  const m = g.maze, [px, py] = m.start;
  m.dots[py * m.W + px] = 2; // under the computer's circle, eaten on the first step
  for (let i = 0; i < 120 && g.fright <= 0; i++) g.update(1 / 120);
  const inPen = g.enemies.filter(e => e.state === 'waiting').length, allScared = g.enemies.every(e => e.scared);
  // Open the pen at once, send the first ghost home as if just eaten, and keep the circle still.
  g.enemies.forEach(e => { e.releaseAt = 0; });
  Object.assign(g.enemies[0], { state: 'returning', scared: false, x: m.home[0], y: m.home[1], t: 0, dir: -1 });
  const out = new Map();
  for (let i = 0; i < 120 * 12 && g.fright > 0 && g.state === 'playing'; i++) {
    Object.assign(g.player, { t: 0, dir: -1 }); // parked on its tile
    g.want = -1;
    g.update(1 / 120);
    g.enemies.forEach((e, k) => { if (e.state === 'active' && !out.has(k)) out.set(k, e.scared); });
  }
  const ok = inPen === 3 && allScared && out.get(0) === false && [1, 2, 3].every(k => out.get(k) === true) &&
    g.fright === 0 && !g.enemies.some(e => e.scared);
  if (!ok) fail++;
  console.log(`power dot with ${inPen} ghosts in the pen: all scared ${allScared}; came out scared: ` +
    `${[1, 2, 3].map(k => out.get(k)).join(', ')}; eaten one came out scared: ${out.get(0)}; ` +
    `scared after the power ran out: ${g.enemies.some(e => e.scared)} -> ${ok ? 'OK' : 'FAIL'}`);
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

// Skins: every skin draws on a fake canvas without errors, at every size, mouth and time, keeps
// save/restore balanced, and stays within 1.4 radii of the center (so it doesn't paint over the maze).
{
  const skinSrc = html.match(/<script id="skins">([\s\S]*?)<\/script>/)[1];
  const Skins = new Function(skinSrc + '; return Skins;')();
  const ids = Skins.LIST.map(s => s.id);
  const bad = [];
  if (new Set(ids).size !== ids.length) bad.push('two skins share an id');
  if (Skins.byId('nope') !== Skins.LIST[0]) bad.push('an unknown id must give the first skin');
  for (const skin of Skins.LIST) {
    if (!/^#[0-9a-f]{6}$/i.test(skin.color)) bad.push(`${skin.id}: color ${skin.color}`);
    for (const r of [8, 14, 40]) for (const mouth of [0, Skins.MOUTH]) for (const time of [0, 0.37, 123.4]) {
      let depth = 0, far = 0;
      const m = [[1, 0, 0, 1, 0, 0]], top = () => m[m.length - 1];
      const pt = (x, y) => { const t = top(); far = Math.max(far, Math.hypot(t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5])); };
      const grad = { addColorStop() {} };
      const known = {
        save() { depth++; m.push(top().slice()); }, restore() { depth--; if (m.length > 1) m.pop(); },
        moveTo: pt, lineTo: pt, quadraticCurveTo: (a, b, x, y) => pt(x, y), bezierCurveTo: (a, b, c, d, x, y) => pt(x, y),
        arc: (x, y, rr) => { pt(x + rr, y); pt(x - rr, y); pt(x, y + rr); pt(x, y - rr); },
        ellipse: (x, y, rx, ry) => { pt(x + rx, y); pt(x - rx, y); pt(x, y + ry); pt(x, y - ry); },
        rect: (x, y, w, h) => { pt(x, y); pt(x + w, y + h); }, fillRect: (x, y, w, h) => { pt(x, y); pt(x + w, y + h); },
        translate(x, y) { const t = top(); t[4] += t[0] * x + t[2] * y; t[5] += t[1] * x + t[3] * y; },
        scale(a, b) { const t = top(); t[0] *= a; t[1] *= a; t[2] *= b; t[3] *= b; },
        rotate(q) { const t = top(), c = Math.cos(q), s = Math.sin(q), [a, b, cc, d] = t; t[0] = a * c + cc * s; t[1] = b * c + d * s; t[2] = -a * s + cc * c; t[3] = -b * s + d * c; },
        createLinearGradient: () => grad, createRadialGradient: () => grad,
      };
      const ctx = new Proxy({}, {
        get: (o, k) => known[k] ? (...a) => {
          if (a.some(n => typeof n === 'number' && !Number.isFinite(n))) bad.push(`${skin.id}: ${String(k)} got a bad number`);
          return known[k](...a);
        } : k in o ? o[k] : () => {},
        set: (o, k, v) => { o[k] = v; return true; },
      });
      try { skin.draw(ctx, r, mouth, time); } catch (e) { bad.push(`${skin.id} r=${r} time=${time}: ${e.message}`); continue; }
      if (depth) bad.push(`${skin.id}: save/restore off by ${depth}`);
      if (far > r * 1.4) bad.push(`${skin.id}: reaches ${(far / r).toFixed(2)} radii out`);
    }
  }
  stat('skins', !bad.length, `${ids.length} skins (${ids.join(', ')})${bad.length ? '; ' + [...new Set(bad)].slice(0, 5).join('; ') : ''}`);
}

process.exit(fail ? 1 : 0);
