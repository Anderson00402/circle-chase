#!/usr/bin/env node
// Records a deterministic GIF of a power-up countdown in Circle Chase.
//
//   node tools/record-gif.mjs [--html index.html] [--out media/countdown.gif]
//                             [--difficulty normal] [--eat 1] [--fps 50] [--tail 1.6]
//                             [--width 760] [--scale 2]
//
// How it works
// - Copies the page to a temp file and inserts one hook <script> right after the core script.
//   The hook wraps Core.createGame so the recorder can see the game (window.__game) and gives the
//   game its own seeded random numbers, so every variant plays out the same way.
// - Replaces performance.now and requestAnimationFrame with a virtual clock. Each captured frame
//   advances the clock by exactly 1/fps seconds, so the GIF plays at real speed no matter how slow
//   the screenshots are. Anything you animate must therefore be driven by game time or
//   performance.now (both follow the virtual clock), not CSS animations or setTimeout.
// - During READY the player is placed three tiles from the bottom-left power dot. Capture starts
//   when play starts; an autopilot eats the power dot, chases and eats --eat scared ghosts, then
//   grazes dots while keeping clear of ghosts. Capture ends --tail seconds after the power runs out.
// - Frames are element screenshots of the score bar + board (.stack), so canvas and DOM both show.
import { chromium } from 'playwright';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const html = resolve(args.html || join(root, 'index.html'));
const out = resolve(args.out || join(root, 'media', 'countdown.gif'));
const difficulty = args.difficulty || 'normal';
const eatTarget = Number(args.eat ?? 1);
const fps = Number(args.fps || 50); // 50 = 2 cs per GIF frame, the smoothest rate browsers honour
const tail = Number(args.tail || 1.6);
const maxSeconds = Number(args.max || 16);
// Resolution: CSS viewport width (sets the tile size) and device pixel ratio (sharpness).
const width = Number(args.width || 760);
const scale = Number(args.scale || 2);

const work = mkdtempSync(join(tmpdir(), 'cc-rec-'));
const framesDir = join(work, 'frames');
mkdirSync(framesDir);

// ---- page copy with the hook ----
let src = readFileSync(html, 'utf8');
const coreAt = src.indexOf('<script id="core">');
if (coreAt < 0) throw new Error('core script not found');
const coreEnd = src.indexOf('</script>', coreAt) + '</script>'.length;
const hook = `<script>
(() => {
  let s = 0x9e3779b9;
  const rng = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const orig = Core.createGame;
  Core.createGame = (d, emit) => (window.__game = orig(d, emit, rng));
})();
</script>`;
src = src.slice(0, coreEnd) + hook + src.slice(coreEnd);
const pagePath = join(dirname(html), `.rec-${process.pid}.html`); // same folder so relative assets resolve
writeFileSync(pagePath, src);

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width, height: Math.round(width * 1.35) }, deviceScaleFactor: scale });
  await ctx.addInitScript(({ difficulty }) => {
    let now = 0, cbs = [];
    let seed = 12345;
    Math.random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    performance.now = () => now;
    window.requestAnimationFrame = cb => { cbs.push(cb); return cbs.length; };
    window.cancelAnimationFrame = () => {};
    window.__advance = ms => { now += ms; const list = cbs; cbs = []; for (const cb of list) cb(now); };
    try { localStorage.setItem('circle-chase:settings', JSON.stringify({ difficulty, targets: false, sound: true })); } catch {}
  }, { difficulty });
  const page = await ctx.newPage();
  page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exitCode = 1; });
  await page.goto('file://' + pagePath);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__advance(16); });
  await page.click('#ov-primary');

  // Autopilot, installed in the page. Returns a status object each tick.
  await page.evaluate(({ eatTarget }) => {
    const g = window.__game, D = Core.DIRS;
    let eaten = 0;
    const W = () => g.maze.W, H = () => g.maze.H;
    const open = (x, y) => y >= 0 && y < H() && g.maze.tiles[y * W() + ((x % W() + W()) % W())] === Core.PATH;
    const here = () => { const [x, y] = g.pos(g.player); return [((Math.round(x) % W()) + W()) % W(), Math.round(y)]; };
    const ghostTiles = pred => g.enemies.filter(pred).map(e => { const [x, y] = g.pos(e); return [x, y]; });
    function bfs(start, isGoal, blocked = () => false) {
      const [sx, sy] = start, seen = new Map([[sy * W() + sx, -1]]), q = [[sx, sy, -1]];
      for (let i = 0; i < q.length; i++) {
        const [x, y, first] = q[i];
        if (i > 0 && isGoal(x, y)) return first;
        for (let d = 0; d < 4; d++) {
          const nx = ((x + D[d].x) % W() + W()) % W(), ny = y + D[d].y;
          if (!open(nx, ny) || seen.has(ny * W() + nx) || blocked(nx, ny)) continue;
          seen.set(ny * W() + nx, 1);
          q.push([nx, ny, first < 0 ? d : first]);
        }
      }
      return -1;
    }
    const near = (pts, x, y, r) => pts.some(([gx, gy]) => Math.min(Math.abs(gx - x), W() - Math.abs(gx - x)) + Math.abs(gy - y) < r);
    window.__onEat = () => { eaten++; };
    window.__pilot = () => {
      if (g.state !== 'playing') return;
      const p = here();
      const danger = ghostTiles(e => (e.state === 'active' || e.state === 'leaving') && !e.scared);
      const scared = ghostTiles(e => e.scared && e.state === 'active');
      let d = -1;
      if (g.fright <= 0 && !g._powered) {
        d = bfs(p, (x, y) => g.maze.dots[y * W() + x] === 2);
      } else if (g.fright > 0 && eaten < eatTarget && scared.length) {
        d = bfs(p, (x, y) => near(scared, x, y, 1.1));
      } else {
        const avoid = [...danger, ...scared];
        const power = (x, y) => g.maze.dots[y * W() + x] === 2; // one power-up per recording
        d = bfs(p, (x, y) => g.maze.dots[y * W() + x] === 1 && !near(avoid, x, y, 3), (x, y) => power(x, y) || near(avoid, x, y, 2));
        if (d < 0) d = bfs(p, (x, y) => !near(avoid, x, y, 6), power);
      }
      if (g.fright > 0) g._powered = true;
      if (d >= 0) g.steer(d);
    };
  }, { eatTarget });

  // Count ghost eats by watching ghost states.
  const step = 1000 / fps;
  // READY: place the player near the bottom-left power dot, then run out the READY time unrecorded.
  await page.evaluate(() => {
    const g = window.__game, m = g.maze;
    let best = null;
    for (let i = 0; i < m.dots.length; i++) if (m.dots[i] === 2) {
      const x = i % m.W, y = Math.floor(i / m.W);
      if (!best || (y > best[1] || (y === best[1] && x < best[0]))) best = [x, y];
    }
    // three tiles to the right of it if open, else stay put
    const tx = best[0] + 3, ty = best[1];
    if (m.tiles[ty * m.W + tx] === Core.PATH) Object.assign(g.player, { x: tx, y: ty, dir: 1, face: 1, t: 0 });
  });
  for (let i = 0; i < 400; i++) {
    const st = await page.evaluate(() => window.__game.state);
    if (st === 'playing') break;
    await page.evaluate(ms => window.__advance(ms), step);
  }

  const stack = await page.$('.stack');
  let frame = 0, poweredSeen = false, endAt = null, lastStates = null;
  for (; frame < maxSeconds * fps; frame++) {
    const s = await page.evaluate(({ ms }) => {
      const g = window.__game;
      const before = g.enemies.map(e => e.state);
      window.__pilot();
      // advance in small chunks so the pilot can steer at corners
      const chunk = ms / 4;
      for (let k = 0; k < 4; k++) { window.__advance(chunk); window.__pilot(); }
      g.enemies.forEach((e, i) => { if (before[i] !== 'returning' && e.state === 'returning') window.__onEat(); });
      return { state: g.state, fright: g.fright, time: g.time };
    }, { ms: step });
    await stack.screenshot({ path: join(framesDir, `f${String(frame).padStart(4, '0')}.png`) });
    if (s.fright > 0) poweredSeen = true;
    if (poweredSeen && s.fright <= 0 && endAt === null) endAt = frame;
    if (endAt !== null && frame - endAt >= tail * fps) break;
    if (s.state === 'dying' && endAt === null && poweredSeen) { console.warn('player died during power'); }
    if (s.state === 'over') break;
  }
  if (!poweredSeen) console.warn('WARNING: power never started');
  console.log(`captured ${frame + 1} frames (${((frame + 1) / fps).toFixed(1)}s)`);
} finally {
  await browser.close();
  rmSync(pagePath, { force: true });
}

mkdirSync(dirname(out), { recursive: true });
// One palette per frame (stats_mode=single + new=1) so colour shifts, glows and gradients keep their
// own 256 colours; light ordered dithering smooths gradients without noisy speckle.
execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(fps), '-i', join(framesDir, 'f%04d.png'),
  '-lavfi', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=single:reserve_transparent=0[p];[b][p]paletteuse=new=1:dither=bayer:bayer_scale=4',
  '-loop', '0', out]);
rmSync(work, { recursive: true, force: true });
console.log('wrote', out);
