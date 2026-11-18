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

// Play stats. Scenes are posed by hand on level 1 (Neon), whose row 1 is a straight lane from x=1 to x=17.
// The scene's maze has dots only where a scene puts them.
const near = (a, b) => a != null && Math.abs(a - b) < 0.011;
function scene(dotsAt = [2]) {
  const g = Core.createGame('normal');
  const s = Core.createStats(g);
  const m = g.maze;
  m.dots.fill(0);
  for (const x of dotsAt) m.dots[1 * m.W + x] = 1;
  m.left = dotsAt.length;
  g.state = 'playing';
  g.time = 10;
  const ghost = g.enemies[0];
  // A power-up with one scared ghost parked at (16, 1) and the circle at (3, 1).
  const power = () => {
    g.fright = g.frightTotal = 6;
    Object.assign(ghost, { x: 16, y: 1, t: 0, dir: -1, state: 'active', scared: true });
    s.event('power');
  };
  // One tile per step, as fast as the circle really moves, eating any dot it lands on.
  const walk = (...xs) => xs.forEach(x => {
    const dt = 1 / Core.PLAYER_SPEED;
    Object.assign(g.player, { x, y: 1, t: 0, dir: -1 });
    g.time += dt;
    g.fright = Math.max(0, g.fright - dt);
    const i = 1 * m.W + x;
    if (m.dots[i]) { m.dots[i] = 0; m.left--; s.event('dot'); }
    s.step(dt);
  });
  const runOut = () => { g.time += g.fright; g.fright = 0; ghost.scared = false; s.step(1 / 120); };
  Object.assign(g.player, { x: 3, y: 1, t: 0, dir: -1 });
  return { g, s, ghost, power, walk, runOut };
}
const stat = (name, ok, detail) => {
  if (!ok) fail++;
  console.log(`stats, ${name}: ${detail} -> ${ok ? 'OK' : 'FAIL'}`);
};

{
  // The only dot is behind the circle. Close in for 3 tiles, turn back, let the power run out,
  // then eat the next power dot 4 s later.
  const { g, s, power, walk, runOut } = scene();
  power();
  walk(4, 5, 6);
  const leftAtStop = g.fright, stopAt = g.time;
  walk(5, 4, 3, 2);
  runOut();
  const nextAt = g.time + 4;
  g.time = nextAt;
  power();
  const u = s.finish('quit').powers[0];
  stat('chase then turn back', u.chased && near(u.stopped_left_s, leftAtStop) && u.ended === 'ran_out' &&
    near(u.to_next_power_s, nextAt - stopAt) && u.length_s === 6,
  `stopped with ${u.stopped_left_s}s of power left, next power ${u.to_next_power_s}s later, ended ${u.ended}`);
}
{
  const { s, power, walk, runOut } = scene();
  power();
  walk(2);
  runOut();
  const u = s.finish('quit').powers[0];
  stat('never chased', !u.chased && u.stopped_left_s === null && u.to_next_power_s === null, `chased ${u.chased}, stopped ${u.stopped_left_s}`);
}
{
  const { s, power, walk, runOut } = scene();
  power();
  walk(4, 3);
  runOut();
  const u = s.finish('quit').powers[0];
  stat('one step toward a ghost is not a chase', !u.chased, `chased ${u.chased}`);
}
{
  // A lane of dots leads to the ghost: eating them looks the same as chasing, so it is not counted.
  const { s, power, walk, runOut } = scene([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  power();
  walk(4, 5, 6, 7, 8, 9, 10, 11, 12);
  runOut();
  const u = s.finish('quit').powers[0];
  stat('eating dots toward a ghost is not a chase', !u.chased, `chased ${u.chased}`);
}
{
  // Off the dots, a chase continues through a lane of dots for as long as the circle keeps closing in.
  const { g, s, power, walk, runOut } = scene([2, 7, 8, 9]);
  power();
  walk(4, 5, 6, 7, 8, 9);
  const leftAtStop = g.fright;
  walk(8, 7);
  runOut();
  const u = s.finish('quit').powers[0];
  stat('a chase keeps going through dots', u.chased && near(u.stopped_left_s, leftAtStop), `stopped with ${u.stopped_left_s}s left`);
}
{
  // Eating a ghost counts as chasing even without the steps; with no scared ghost left the power-up is over.
  const { g, s, ghost, power, walk } = scene();
  power();
  walk(4);
  g.fright = 3.25;
  ghost.scared = false;
  ghost.state = 'returning';
  s.event('eat');
  walk(5);
  const u = s.finish('quit').powers[0];
  stat('eating a ghost', u.chased && u.ghosts_eaten === 1 && near(u.stopped_left_s, 3.25) && u.ended === 'no_ghosts_left',
    `ate ${u.ghosts_eaten} with ${u.stopped_left_s}s left, ended ${u.ended}`);
}
{
  // Survival: Start to the last death; each life counts only time the circle could move.
  const { g, s, power, walk } = scene();
  g.time = 0;
  g.state = 'ready';
  while (g.state === 'ready') { g.update(1 / 120); s.step(1 / 120); } // the READY wait: not part of a life
  const readyEnd = g.time;
  for (let i = 0; i < 120 * 5; i++) { g.time += 1 / 120; s.step(1 / 120); }  // 5 s of play
  power();
  walk(4, 5, 6);
  g.state = 'dying';
  g.lives = 1;
  s.event('die');
  const firstDeath = g.time;
  g.time += 20;                       // dying, READY, and a second life of 20 s
  const between = s.survival();       // the clock keeps running after a life is lost
  g.state = 'playing';
  for (let i = 0; i < 120 * 10; i++) { g.time += 1 / 120; s.step(1 / 120); }
  g.lives = 0;
  s.event('die');
  const lastDeath = g.time;
  g.time += 1.6;                      // the death animation before GAME OVER
  const shown = s.survival();         // the clock on screen stops at the last death
  const { play, powers } = s.finish('game_over');
  stat('survival', near(play.survival_s, lastDeath) && play.life_s.length === 2 && near(play.life_s[0], firstDeath - readyEnd) && readyEnd >= 1.8 &&
    near(play.life_s[1], 10) && powers[0].ended === 'died' && play.ended === 'game_over',
  `survived ${play.survival_s}s, lives ${play.life_s.join(' + ')}s, power-up ended ${powers[0].ended}`);
  stat('survival clock', near(between, firstDeath + 20) && near(shown, lastDeath) && near(s.survival(), play.survival_s),
    `${between.toFixed(2)}s between lives, stopped at ${shown.toFixed(2)}s through the death animation, same as saved`);
  stat('finish only once', s.finish('quit') === null && Core.createStats(Core.createGame()).finish('quit') === null,
    'a second finish, and a game that never started, give nothing');
}

// Random games with stats attached: the numbers always make sense.
{
  let games = 0, ups = 0, chased = 0, bad = [];
  for (const key of Object.keys(Core.DIFFICULTY)) {
    for (let run = 0; run < 4; run++) {
      let s;
      const g = Core.createGame(key, type => s.event(type));
      s = Core.createStats(g);
      // A circle that heads for the nearest scared ghost about half the time.
      for (let i = 0; i < 120 * 900 && g.state !== 'over'; i++) {
        if (i % 30 === 0) {
          const target = g.fright > 0 && Math.random() < 0.5 && g.enemies.find(e => e.scared);
          if (target) {
            const dx = target.x - g.player.x, dy = target.y - g.player.y;
            g.steer(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : (dy > 0 ? 2 : 0));
          } else g.steer(Math.floor(Math.random() * 4));
        }
        g.update(1 / 120);
        s.step(1 / 120);
      }
      const { play, powers } = s.finish(g.state === 'over' ? 'game_over' : 'quit');
      games++;
      ups += powers.length;
      chased += powers.filter(u => u.chased).length;
      const lifeSum = play.life_s.reduce((a, b) => a + b, 0);
      if (play.survival_s < lifeSum - 0.05 || play.survival_s > g.time + 0.01) bad.push(`survival ${play.survival_s} vs lives ${lifeSum}`);
      if (Math.abs(play.survival_s - s.survival()) > 0.006) bad.push(`clock ${s.survival()} vs saved ${play.survival_s}`);
      if (play.ended === 'game_over' && play.life_s.length < g.diff.lives) bad.push(`${play.life_s.length} lives recorded`);
      powers.forEach((u, i) => {
        if (!u.ended) bad.push(`power-up ${u.n} never ended`);
        if (u.n !== i + 1) bad.push(`power-up numbered ${u.n} at ${i + 1}`);
        if (u.chased !== (u.stopped_left_s !== null)) bad.push(`power-up ${u.n}: chased ${u.chased} but stop ${u.stopped_left_s}`);
        if (u.stopped_left_s !== null && (u.stopped_left_s < 0 || u.stopped_left_s > u.length_s)) bad.push(`stop ${u.stopped_left_s} of ${u.length_s}`);
        if (u.to_next_power_s !== null && (u.to_next_power_s < 0 || i === powers.length - 1)) bad.push(`to next ${u.to_next_power_s}`);
      });
    }
  }
  stat('random games', !bad.length && ups > 0 && chased > 0,
    `${games} games, ${ups} power-ups, ${chased} chased${bad.length ? '; ' + bad.slice(0, 5).join('; ') : ''}`);
}

process.exit(fail ? 1 : 0);
