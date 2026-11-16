# Writing a countdown cue

A cue tells the player how much power is left, in one way of its own. It is a plain object
(`Cue` in `src/lib/game/types.ts`) with a few optional drawing hooks and an optional sound hook.
The renderer calls the hooks while it draws each frame and hands them a `CueContext` (`k`).

To add one: write `src/lib/game/cues/<id>.ts` exporting a `Cue`, then list it in
`src/lib/game/cues/index.ts`. `timer-bar.ts` is the model to copy.

## Four rules

1. **Pure.** A hook draws from `k` and nothing else: same scene, same picture. No module
   variables that remember earlier frames, no `Date.now()`, no `performance.now()`, no
   `Math.random()`. Replays, scrubbing backwards and re-drawing a recorded moment with another cue
   all depend on this. Animate from `k.now` (game time). Effects after something happened use the
   timestamps in the frame: `k.power.startedAt`, `k.power.endedAt`, `k.power.sinceExpired`,
   `g.revertedAt`, `g.eatenAt`. Random-looking particles come from `k.hash(i, k.power.serial)`.
   Caching *static* pictures is fine: use `k.layer(key, draw)`.
2. **One signal only.** The study compares one cue at a time, so a cue shows its own signal and
   nothing else. Keep `baseFlash: false` (only `classic-blink` sets it); never re-create the white
   ghost blink. `k.baseFlash()` is there to borrow its *rhythm* (the last 2 s, five beats ending
   with the power), not its look.
3. **The base game never hints.** Scared wisps look the same from the first moment to the last,
   and the power-up sound bed never changes. Your cue is the only thing that changes with time
   left. Do not rely on anything else to carry the message.
4. **Reduced motion.** When `k.reduceMotion` is true, keep the information but drop motion that
   is not the information: no shaking, no orbiting, no flashing faster than about 2 per second.
   A bar that drains or a number that changes is fine; a pulse can become a steady change of
   brightness. `k.pulse()` already returns a constant 0.5 then.

Leave the 2D context as you found it. The renderer also wraps every hook in `save()`/`restore()`.

## Hook order

The renderer draws one frame in this order:

| Step | What is drawn | Hook |
| --- | --- | --- |
| 1 | floor, walls, pen door (one cached picture) | `walls(k)` right after |
| 2 | dots, power dots | `dots(k, drawDefault)` replaces them; call `drawDefault()` to keep the normal ones |
| 3 | bonus item | |
| 4 | | `under(k)`: above maze and dots, below the characters |
| 5 | each visible wisp (and each tunnel copy) | `ghost(k, g, index, cx, cy, drawDefault)` replaces or decorates |
| 6 | the hero | `player(k, cx, cy, drawDefault)` replaces or decorates |
| 7 | | `over(k)`: above everything on the board |
| 8 | power-up ripple, eat bursts, score popups, banners | |

`ghost` and `player` are called once per visible copy, so a character crossing a tunnel is
called twice with two `cx` values. Wisps that are not drawn (after a death, at a maze clear) do not
get a `ghost` call.

`sound(prev, frame, sfx)` runs once per live frame while the game plays (not during replays),
after the stock sounds.

## What a hook gets: `k`

### The moment

| Field | Meaning |
| --- | --- |
| `k.ctx` | 2D context, scaled so one unit is one CSS pixel. |
| `k.T` | Tile size in CSS pixels (8 in a thumbnail, 20-34 in play). Size everything from it. |
| `k.dpr` | Device pixel ratio. `shadowBlur` ignores the transform: `ctx.shadowBlur = k.T * 0.5 * k.dpr`. |
| `k.scene`, `k.frame`, `k.maze` | The scene being drawn. `k.frame.phase` is `'ready'`, `'playing'`, `'dying'`, `'clear'` or `'over'`. |
| `k.now` | Game time in seconds. Stops while paused and in the short freeze after eating a wisp. |
| `k.reduceMotion` | The player asked for less motion. |
| `k.colors` | The palette: maze theme (`bg wall wallGlow dot power`), `player`, `scared` (light ink of scared wisps), `scaredFill` (their body), `ghost[id]`, `ink`, `inkDim`, `accent`, `door`, `flash`, `flashInk`. |
| `k.fonts` | `{ display, body, mono }` font stacks from the app's design tokens. |

### Power

| Field | Meaning |
| --- | --- |
| `k.power.active` | A power-up is running. |
| `k.power.left`, `.total` | Seconds left and the length of this power-up (random 4-8 s in study mode). |
| `k.power.frac` | 1 at the start, 0 at the end. `if (!k.power.active) return;` before using it. |
| `k.power.elapsed` | Seconds since this power-up began. |
| `k.power.sinceExpired` | Seconds since the last power-up ran out by itself; `Infinity` otherwise. Use it for a short "it ended" effect: `if (k.power.sinceExpired < 0.5) ...` |
| `k.power.sinceEnd`, `.endReason` | Same for any end (`'expired' 'died' 'cleared' 'refreshed'`). |
| `k.power.startedAt`, `.endedAt` | Game times. |
| `k.power.serial` | 1, 2, 3... per power-up: seed for `hash`. |
| `k.power.chain` | Wisps eaten in this power-up. |
| `k.baseFlash()` | True during each of the five blinks in the last 2 s (0.2 s on, 0.25 s off, the first at 2 s left, the last ending with the power). With reduced motion, steadily true for the last 2 s. |

### Positions and geometry (CSS pixels)

```ts
const [x, y] = k.px(g.x, g.y);                 // centre of a tile position
k.eachWrap(f.player.x, (cx) => draw(cx));      // once per visible copy (twice in a tunnel)
const [px, py] = k.playerPos();                 // the hero's centre
const [gx, gy] = k.ghostPos(g);                 // a wisp's centre (with its pen bob)
const look = k.ghostLook(g);                    // 'normal' | 'scared' | 'scared-flash' | 'eyes'

k.geo.board                                     // { x, y, w, h, cx, cy } of the whole board
k.geo.pen                                       // box of the pen floor (an hourglass fits here)
k.geo.door                                      // box of the pen door
k.geo.home                                      // [x, y] where eaten wisps return
k.geo.dots                                      // [{ i, x, y, cx, cy, kind }] every tile that starts with a pickup
k.scene.dots[d.i]                               // 0 eaten, 1 dot, 2 power dot, right now

const P = k.geo.perimeter;                      // the outermost neon line, clockwise from top centre
P.length                                        // in CSS pixels
const p = P.pointAt(d);                         // { x, y, tx, ty (direction), nx, ny (into the maze) }
ctx.stroke(P.slice(d, P.length));               // the stretch still ahead of a fuse spark
ctx.stroke(P.path);                             // the whole loop
```

### Walls and layers

All layers are full-board pictures in device pixels, cached per maze, size and colour. Draw them
with `k.drawLayer`, never with a bare `drawImage` (the board may be offset by a screen shake).

```ts
k.drawLayer(k.wallLayer(k.colors.scared));                    // the walls redrawn in another colour
k.drawLayer(k.wallLayer('#ff9a3c', '#ff6a00', { outer: true }), 0.8);  // only the outer border line, 80%
k.masked(k.wallMask(), (c) => { c.fillStyle = tint; c.fillRect(...box); });  // paint, keep only what is on walls
k.masked(k.wallMask(k.T * 0.4), draw);                        // inset deeper into the walls (the inner panels)
k.clip(k.geo.perimeter.path, () => { ... });                  // save, clip, draw, restore
const art = k.layer('dial', (c) => drawDial(c));              // your own static picture, built once
k.drawLayer(art, 0.5, 'lighter');                             // alpha and composite mode
```

### Characters

```ts
drawDefault();                                                // the normal drawing (inside a ghost/player hook)
k.drawGhost(g, i, 'scared', cx, cy);                          // any look
k.drawGhost(g, i, 'scared', cx, cy, { scale: 1.2, color: '#222', ink: '#fff', eyes: 'closed', alpha: 0.8 });
k.drawGhost(g, i, 'normal', cx, cy, { lookAt: k.playerPos() });  // eyes on the player
k.ghostPath(g, i, cx, cy, { look: k.ghostLook(g) });          // traces the body as the current path
k.clip(() => k.ghostPath(g, i, cx, cy, { look }), () => fillFromBottom(level));  // fill a wisp's body
k.drawPlayer(cx, cy);                                         // the hero
k.drawPlayer(cx, cy, 1.3, { color: '#fff6c0', open: 0, mood: 'happy', alpha: 0.9 });
```

Eye styles: `'normal'` (own eyes and lids), `'pale'`, `'dark'`, `'closed'`, `'none'`.
Moods: `'normal'`, `'happy'`, `'dizzy'`.

### Drawing helpers

```ts
k.glow(x, y, k.T, '#ffcc66', 0.8);                            // soft radial glow
k.ring(x, y, k.T * 0.7, 2, color);                            // circle
k.ring(x, y, k.T * 0.7, 2, color, { from: 0, to: Math.PI * 2 * k.power.frac, alpha: 0.9 });  // arc, 0 = 12 o'clock, clockwise
k.text('3', k.geo.board.cx, k.geo.board.cy, { size: k.T * 6, font: 'display', weight: 800,
	fill: k.rgba(k.colors.ink, 0.3), stroke: k.colors.bg, glow: k.colors.accent, scale: 1.2, alpha: 0.9 });
```

### Maths and colour

```ts
k.ease.outBack(u)        // also linear inQuad outQuad inOutQuad inCubic outCubic inOutCubic outElastic bump
k.clamp(x, 0, 1)
k.lerp(a, b, u)
k.smoothstep(2, 0, k.power.left)       // 0 above 2 s left, 1 at the end
k.hash(i, k.power.serial)              // 0..1, the same every time for the same inputs
k.noise(k.now * 3, i)                  // smooth 0..1 wander
k.mix(k.colors.scared, k.colors.ghost[g.id], u)  // blend two colours
k.rgba(k.colors.accent, 0.4)           // colour with alpha
k.pulse(0.5)                           // 0..1 cosine on game time, period 0.5 s (constant 0.5 with reduced motion)
```

### Stateless particles

Particles are not simulated; each one is a function of time. Spawn them on a fixed clock and
compute each living one from its birth time:

```ts
const RATE = 30, LIFE = 0.5;                       // per second, seconds
for (let n = Math.floor((k.now - LIFE) * RATE); n <= Math.floor(k.now * RATE); n++) {
	const born = n / RATE, age = k.now - born;
	if (age < 0 || age > LIFE) continue;
	const a = k.hash(n, 1) * Math.PI * 2, v = k.T * (1 + k.hash(n, 2));
	ctx.globalAlpha = 1 - age / LIFE;
	ctx.fillRect(x + Math.cos(a) * v * age, y + Math.sin(a) * v * age, 2, 2);
}
```

## Sound

`sound(prev, frame, sfx)` fires sounds on thresholds, by comparing the previous frame with this one:

```ts
sound(prev, f, sfx) {
	if (prev.power.left > 1 && f.power.left <= 1) sfx.tone(sfx.note('A5'), 0.08, { type: 'square', vol: 0.04 });
	const ended = f.events.some((e) => e.type === 'powerEnd' && e.reason === 'expired');
	if (ended) sfx.noise(0.2, { vol: 0.06, freq: 300 });
}
```

| Call | Example |
| --- | --- |
| `sfx.tone(freq, dur, { type, vol, to, delay })` | `sfx.tone(880, 0.1, { to: 440 })`: a short falling blip |
| `sfx.noise(dur, { vol, freq, q, delay })` | `sfx.noise(0.15, { freq: 200, q: 0.7 })`: a thump |
| `sfx.arp(freqs, gap, { dur, type, vol })` | `sfx.arp([660, 880, 1320], 0.05)` |
| `sfx.note(name)` | `sfx.note('C#5')` is 554.4 |
| `sfx.enabled` | false while muted (calls are ignored then anyway) |

Keep volumes at or below 0.06. The stock game already plays a steady bed during every power-up;
it starts with the power-up and stops when it ends, and never changes in between. Do not try to
change it. Sound is an extra channel for your one signal, not a second signal: a tick that follows
your own visual beat is fine, a separate warning siren is not.

## A complete small cue

A ring that shrinks around the hero as the power runs out, with a soft tick each whole second
and a short pop when the power expires:

```ts
import type { Cue } from '../types';

export const shrinkingRing: Cue = {
	id: 'shrinking-ring' as Cue['id'],     // add the id to CueId in types.ts
	role: 'idea',
	code: '11',
	name: 'Shrinking ring',
	tagline: 'A ring around you shrinks as the power runs out.',
	description: 'A ring circles the hero during a power-up and tightens towards it. It is gone when the power ends.',
	channel: 'player',
	baseFlash: false,

	player(k, cx, cy, drawDefault) {
		drawDefault();
		const { power, T, colors } = k;
		if (power.active && k.frame.phase === 'playing') {
			k.ring(cx, cy, T * (0.7 + 1.6 * power.frac), Math.max(1.5, T * 0.08), colors.scared, { alpha: 0.85 });
		}
		// Pop when it ran out: a quick ring that grows and fades, from the frame's own timestamp.
		const u = power.sinceExpired / 0.4;
		if (u < 1 && !k.reduceMotion) k.ring(cx, cy, T * (0.7 + u), 2, colors.ink, { alpha: 1 - u });
	},

	sound(prev, f, sfx) {
		if (f.power.left > 0 && Math.ceil(prev.power.left) !== Math.ceil(f.power.left)) sfx.tone(1200, 0.03, { vol: 0.02 });
		if (f.events.some((e) => e.type === 'powerEnd' && e.reason === 'expired')) sfx.tone(600, 0.12, { to: 300, vol: 0.04 });
	}
};
```

## Checking your cue

- `/play/<id>` plays it. In the browser console, `window.__cc.game` is the live game.
- Look at it at play size and at thumbnail size (tile 8-14): the gallery and replays use the same
  code at small sizes. `SceneView` (`#lib/game/render/SceneView.svelte`) or
  `renderScene(canvas, scene, { cue, tile })` from `#lib/game/render/index.ts` draw any scene.
- Turn on "reduce motion" in the system settings and check that the information is still there.
- Draw the same scene twice and compare: if the pictures differ, the cue keeps state somewhere.
