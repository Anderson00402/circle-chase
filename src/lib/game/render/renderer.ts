import {
	DIRS, type Cue, type CueContext, type Dir, type GhostLook, type GhostView, type Maze, type Palette, type Scene, type TextOptions
} from '../types';
import { drawHero, drawWisp, heroRadius, softGlow, wispPath } from './actors';
import { boardLayer, cached, geometry, makeCanvas, wallMask, wallLayer, wallMetrics } from './board';
import { drawBonus, drawPowerDot } from './items';
import { ORIGINAL_THEME } from '../engine/mazes';
import { appFonts, clamp, ease, hash, lerp, mix, noise, rgba, smoothstep, TAU } from './util';

/**
 * Draws a Scene on a canvas with one countdown cue plugged in.
 *
 * Pure: the same scene always gives the same picture, so replays match what the player saw.
 * Every effect (the gulp, the death, the clear flash, banners) is worked out from game time,
 * positions and timestamps in the frame, never from earlier draws. Only static pictures are cached.
 *
 * The look is the first version of the game: neon outline walls on black, a plain yellow circle,
 * teardrop ghosts that turn into dashed outlines when scared.
 *
 * The base game never hints at the time left: scared ghosts look the same from the first moment
 * to the last. The only exception is the white blink, and only when the cue asks for it
 * (`cue.baseFlash`, used by the classic-blink condition).
 */

/** The board of the original game, the same on every maze. */
export const BOARD_COLORS = ORIGINAL_THEME;

export const BASE_COLORS = {
	player: '#ffd84a',
	// Scared ghosts: a faint pale blue fill inside a dashed outline, eyes in the same ink.
	scared: '#8fd3ff',
	scaredFill: 'rgba(143, 211, 255, 0.12)',
	scaredInk: '#8fd3ff',
	ink: '#eef3ff',
	inkDim: '#a3b6de',
	/** The pale drafting line: the pen door, banner borders, bonus marks. */
	line: '#dbe7ff',
	accent: '#ff8a4c',
	// The white blink keeps the scared body and turns its outline and eyes white.
	flash: '#ffffff',
	flashInk: '#ffffff',
	// The original four: rose, orange, mint and lavender.
	ghost: { hunter: '#ff6f91', ambusher: '#ff8a3d', guard: '#3fe0b0', drifter: '#b9a2ff' }
} as const;

export function paletteFor(maze: Maze): Palette {
	const t = maze.theme;
	return {
		...t,
		...BASE_COLORS,
		door: BASE_COLORS.line,
		ghost: { ...BASE_COLORS.ghost }
	};
}

/**
 * Default "about to end" blink: five white blinks over the last 2 s. The first starts at 2 s left
 * and the last ends exactly as the power runs out (0.2 s on, 0.25 s off). With reduced motion it
 * does not blink (that would be over 2 flashes a second): it is steadily on for the last 2 s.
 */
const FLASH_WARN = 2, FLASH_ON = 0.2, FLASH_PERIOD = 0.45;
export function powerFlash(left: number, reduceMotion = false): boolean {
	if (left <= 0 || left > FLASH_WARN) return false;
	if (reduceMotion) return true;
	return (FLASH_WARN - left) % FLASH_PERIOD < FLASH_ON;
}

/** The look the renderer gives a ghost in this scene with this cue. */
export function lookOf(g: GhostView, left: number, cue: Pick<Cue, 'baseFlash'>, reduceMotion = false): GhostLook {
	if (g.mode === 'returning') return 'eyes';
	if (g.scared) return cue.baseFlash && powerFlash(left, reduceMotion) ? 'scared-flash' : 'scared';
	return 'normal';
}

export interface RenderOptions {
	cue: Cue;
	reduceMotion?: boolean;
	/** Text for the banner during READY (for example "LEVEL 2"). */
	readyLabel?: string;
	/** Draw READY / CLEAR / GAME OVER banners (default true). */
	banners?: boolean;
}

export interface Renderer {
	/** Size the canvas for a maze at `tile` CSS pixels per tile. */
	resize(maze: Maze, tile: number, dpr: number): void;
	draw(scene: Scene, opts: RenderOptions): void;
	readonly tile: number;
	readonly dpr: number;
}

// Phase timings (seconds into the phase): ghosts vanish after the freeze; the hero shrinks away
// while a ring goes out from it, as in the original.
const DEATH_FREEZE = 0.35, DEATH_SHRINK = 1.1;
// The ring that goes out from the hero when it eats a power dot.
const POWER_RING = 0.35;
/**
 * The gulp, in tiles walked toward the next dot (the original's 0.16 s at its walking speed):
 * the circle reaches for the dot over the first part and settles back as it goes down.
 */
const GULP_REACH = 0.9, GULP_OUT = 0.625;

/**
 * Gulp stretch for this scene, from positions only: if a dot lies ahead within reach of the
 * moving hero, how far along the gulp it is. A dot on the board has not been eaten, so this never
 * gulps on an empty tile, and it needs no memory of earlier frames.
 */
export function gulpOf(scene: Scene, reduceMotion = false): number {
	const { maze: m, dots, frame: f } = scene;
	if (reduceMotion || f.phase !== 'playing' || !f.player.moving) return 0;
	const d = DIRS[f.player.face as Exclude<Dir, -1>];
	if (!d) return 0;
	const along = d.x ? f.player.x : f.player.y, sign = d.x || d.y;
	const ahead = sign > 0 ? Math.ceil(along - 1e-6) : Math.floor(along + 1e-6);
	const dist = Math.abs(ahead - along);
	if (dist <= 1e-6 || dist >= GULP_REACH) return 0;
	const tx = d.x ? ahead : Math.round(f.player.x), ty = d.x ? Math.round(f.player.y) : ahead;
	if (ty < 0 || ty >= m.H) return 0;
	const kind = dots[ty * m.W + (((tx % m.W) + m.W) % m.W)];
	if (kind !== 1 && kind !== 2) return 0;
	const amp = kind === 2 ? 0.24 : 0.14, u = 1 - dist / GULP_REACH;
	return u < GULP_OUT ? amp * Math.sin((Math.PI * u) / GULP_OUT) : -0.45 * amp * Math.sin((Math.PI * (u - GULP_OUT)) / (1 - GULP_OUT));
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
	const ctx = canvas.getContext('2d')!;
	let T = 0, dpr = 1;
	let scratch: [HTMLCanvasElement, CanvasRenderingContext2D] | null = null;

	function resize(maze: Maze, tile: number, ratio: number) {
		const w = Math.round(tile * maze.W * ratio), h = Math.round(tile * maze.H * ratio);
		if (tile === T && ratio === dpr && canvas.width === w && canvas.height === h) return;
		T = tile;
		dpr = ratio;
		scratch = null;
		canvas.style.width = T * maze.W + 'px';
		canvas.style.height = T * maze.H + 'px';
		canvas.width = w;
		canvas.height = h;
	}

	function draw(scene: Scene, opts: RenderOptions) {
		const { maze: m, dots, frame: f } = scene;
		if (!T) resize(m, 16, 1);
		const reduce = !!opts.reduceMotion, cue = opts.cue, now = f.t;
		const time = reduce ? 0 : now; // idle motion stops with reduced motion
		const pal = paletteFor(m);
		const geo = geometry(m, T);
		const fonts = appFonts();
		const p = f.power;

		// The board never shakes (the offset stays for the layer helpers, always 0).
		const sx = 0, sy = 0;
		const gulp = gulpOf(scene, reduce);
		const base = () => ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);

		const px = (x: number, y: number): [number, number] => [(x + 0.5) * T, (y + 0.5) * T];
		const eachWrap = (x: number, fn: (cx: number) => void) => {
			for (const off of [-m.W, 0, m.W]) { const q = x + off; if (q > -1 && q < m.W) fn((q + 0.5) * T); }
		};
		const wrapX = (x: number) => ((x % m.W) + m.W) % m.W;
		const ghostY = (g: GhostView, i: number) => g.mode === 'waiting' && !reduce ? g.y + Math.sin(now * 4 + i * 2) * 0.16 : g.y;
		const travel = f.player.x + f.player.y;
		const drawLayer = (img: CanvasImageSource, alpha = 1, composite?: GlobalCompositeOperation) => {
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, sx * dpr, sy * dpr);
			ctx.globalAlpha *= alpha;
			if (composite) ctx.globalCompositeOperation = composite;
			ctx.drawImage(img, 0, 0);
			ctx.restore();
		};
		const text = (str: string, x: number, y: number, o: TextOptions = {}) => {
			const size = o.size ?? T * 0.5;
			ctx.save();
			ctx.translate(x, y);
			if (o.scale !== undefined && o.scale !== 1) ctx.scale(o.scale, o.scale);
			if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
			ctx.font = `${o.weight ?? 700} ${size}px ${fonts[o.font ?? 'display']}`;
			ctx.textAlign = o.align ?? 'center';
			ctx.textBaseline = o.baseline ?? 'middle';
			if ('letterSpacing' in ctx) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${o.spacing ?? 0}px`;
			if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = size * 0.6 * dpr; }
			if (o.stroke) {
				ctx.lineJoin = 'round';
				ctx.lineWidth = o.strokeWidth ?? Math.max(2, Math.min(size * 0.18, 6));
				ctx.strokeStyle = o.stroke;
				ctx.strokeText(str, 0, 0);
				ctx.shadowBlur = 0;
			}
			ctx.fillStyle = o.fill ?? pal.ink;
			ctx.fillText(str, 0, 0);
			ctx.restore();
		};

		const k: CueContext = {
			ctx, T, dpr, scene, frame: f, maze: m, now, reduceMotion: reduce, colors: pal,
			power: {
				active: p.left > 0, left: p.left, total: p.total,
				frac: p.total > 0 ? Math.min(1, p.left / p.total) : 0,
				elapsed: p.left > 0 ? p.total - p.left : 0,
				sinceExpired: p.left <= 0 && p.endReason === 'expired' && p.endedAt >= 0 ? now - p.endedAt : Infinity,
				sinceEnd: p.left <= 0 && p.endedAt >= 0 ? now - p.endedAt : Infinity,
				startedAt: p.startedAt, endedAt: p.endedAt, endReason: p.endReason, serial: p.serial, chain: p.chain
			},
			px, eachWrap,
			baseFlash: () => powerFlash(p.left, reduce),
			drawGhost: (g, i, look, cx, cy, o) => drawWisp(ctx, pal, T, g, i, look, cx, cy, time, o),
			// Every look shares one body, so `look` no longer changes the outline.
			ghostPath: (g, i, cx, cy, o) => wispPath(ctx, T, g, i, cx, cy, time, o?.scale ?? 1),
			drawPlayer: (cx, cy, scale = 1, o = {}) => drawHero(ctx, pal, T, cx, cy, f.player.face, travel, f.player.moving && f.phase === 'playing', time, { gulp, ...o, scale }),
			wallLayer: (color, glow, o) => wallLayer(m, T, dpr, color, { glow, ...o }),
			fonts,
			geo,
			ghostLook: (g) => lookOf(g, p.left, cue, reduce),
			ghostPos: (g) => {
				const i = f.ghosts.indexOf(g);
				return px(wrapX(g.x), i >= 0 ? ghostY(g, i) : g.y);
			},
			playerPos: () => px(wrapX(f.player.x), f.player.y),
			wallMask: (inset) => wallMask(m, T, dpr, inset ?? wallMetrics(T).cut),
			drawLayer,
			masked(mask, fn, alpha = 1) {
				if (!scratch || scratch[0].width !== canvas.width || scratch[0].height !== canvas.height) {
					scratch = makeCanvas(canvas.width / dpr, canvas.height / dpr, dpr);
				}
				const [sc, sx2] = scratch;
				sx2.setTransform(1, 0, 0, 1, 0, 0);
				sx2.globalCompositeOperation = 'source-over';
				sx2.globalAlpha = 1;
				sx2.clearRect(0, 0, sc.width, sc.height);
				sx2.setTransform(dpr, 0, 0, dpr, 0, 0);
				sx2.save();
				fn(sx2);
				sx2.restore();
				sx2.setTransform(1, 0, 0, 1, 0, 0);
				sx2.globalCompositeOperation = 'destination-in';
				sx2.drawImage(mask, 0, 0);
				sx2.globalCompositeOperation = 'source-over';
				drawLayer(sc, alpha);
			},
			clip(path, fn) {
				ctx.save();
				if (typeof path === 'function') { path(); ctx.clip(); } else ctx.clip(path);
				fn();
				ctx.restore();
			},
			layer: (key, fn) => cached(`cue:${m.id}:${m.W}x${m.H}:${T}:${dpr}:${key}`, () => {
				const [c, x] = makeCanvas(m.W * T, m.H * T, dpr);
				fn(x);
				return c;
			}),
			glow: (x, y, r, color, alpha = 1) => softGlow(ctx, x, y, r, color, alpha),
			ring(x, y, r, width, color, o = {}) {
				if (r <= 0) return;
				ctx.save();
				if (o.alpha !== undefined) ctx.globalAlpha *= clamp(o.alpha);
				ctx.strokeStyle = color;
				ctx.lineWidth = width;
				ctx.beginPath();
				const a0 = (o.from ?? 0) - Math.PI / 2, a1 = (o.to ?? TAU) - Math.PI / 2;
				ctx.arc(x, y, r, a0, a1);
				ctx.stroke();
				ctx.restore();
			},
			text,
			ease, clamp, lerp, smoothstep, hash, noise, mix, rgba,
			pulse: (period, offset = 0) => reduce ? 0.5 : 0.5 - 0.5 * Math.cos(((now + offset) / period) * TAU)
		};
		/** Runs a cue hook with the context state saved around it, so a careless cue cannot leak state. */
		const hook = (fn: () => void) => { ctx.save(); try { fn(); } finally { ctx.restore(); } };

		// ---- 1. board: floor, walls, door (one cached picture) ----
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
		ctx.globalCompositeOperation = 'source-over';
		ctx.fillStyle = pal.bg;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		// Maze clear: the walls flash to the accent orange four times a second (not with reduced motion).
		const clearFlash = f.phase === 'clear' && !reduce && Math.floor(f.phaseTime * 4) % 2 === 1;
		drawLayer(clearFlash
			? boardLayer(m, T, dpr, pal.bg, pal.accent, pal.accent, pal.door)
			: boardLayer(m, T, dpr, pal.bg, pal.wall, pal.wallGlow, pal.door));
		base();
		if (cue.walls) hook(() => cue.walls!(k));

		// ---- 2. pickups ----
		const drawDots = () => {
			const r = Math.max(Math.min(1.4, T * 0.14), T * 0.09);
			ctx.fillStyle = pal.dot;
			ctx.beginPath();
			for (const d of geo.dots) {
				if (dots[d.i] !== 1) continue;
				ctx.moveTo(d.cx + r, d.cy);
				ctx.arc(d.cx, d.cy, r, 0, TAU);
			}
			ctx.fill();
			// Power dots can grow back anywhere they started, so scan the whole board.
			for (let i = 0; i < dots.length; i++) {
				if (dots[i] !== 2) continue;
				const [cx, cy] = px(i % m.W, (i / m.W) | 0);
				drawPowerDot(ctx, cx, cy, T, pal.power, reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * 6.25));
			}
		};
		if (cue.dots) hook(() => cue.dots!(k, drawDots)); else drawDots();
		if (f.bonus) {
			const [cx, cy] = px(f.bonus.x, f.bonus.y);
			const bob = reduce ? 0 : Math.sin(now * 3) * T * 0.05;
			// Fades in and out over its last two seconds (its own timer, unrelated to the power).
			const vis = f.bonus.left > 2 || reduce ? 1 : 0.45 + 0.55 * Math.abs(Math.cos(f.bonus.left * Math.PI * 2));
			ctx.save();
			ctx.globalAlpha = vis;
			drawBonus(ctx, f.bonus.kind, cx, cy + bob, T * 0.92, time);
			ctx.restore();
		}

		if (cue.under) hook(() => cue.under!(k));

		// ---- 3. ghosts ----
		const showGhosts = f.phase !== 'clear' && f.phase !== 'over' && !(f.phase === 'dying' && f.phaseTime > DEATH_FREEZE);
		if (showGhosts) {
			// Eyes heading home are drawn last so they stay on top.
			const order = f.ghosts.map((g, i) => i).sort((a, b) => +(f.ghosts[a].mode === 'returning') - +(f.ghosts[b].mode === 'returning'));
			for (const i of order) {
				const g = f.ghosts[i], look = lookOf(g, p.left, cue, reduce), y = ghostY(g, i);
				eachWrap(g.x, (cx) => {
					const cy = (y + 0.5) * T;
					const def = () => k.drawGhost(g, i, look, cx, cy);
					if (cue.ghost) hook(() => cue.ghost!(k, g, i, cx, cy, def)); else def();
				});
			}
		}

		// ---- 4. player ----
		if (f.phase !== 'over') {
			const pt = f.phaseTime;
			// Caught: the circle shrinks away while a ring goes out from it.
			const dying = f.phase === 'dying' ? clamp(pt / DEATH_SHRINK) : 0;
			const scale = 1 - dying;
			const sinceStart = now - p.startedAt;
			const ring = f.phase === 'playing' && !reduce && p.startedAt >= 0 && sinceStart >= 0 && sinceStart < POWER_RING ? sinceStart / POWER_RING : -1;
			eachWrap(f.player.x, (cx) => {
				const cy = (f.player.y + 0.5) * T;
				if (f.phase === 'dying' && !reduce && dying < 1) {
					k.ring(cx, cy, T * (0.4 + dying * 1.2), 2, pal.player, { alpha: 1 - dying });
				}
				const def = () => { if (heroRadius(T) * scale > 0.5) k.drawPlayer(cx, cy, scale); };
				if (cue.player) hook(() => cue.player!(k, cx, cy, def)); else def();
				// A power dot sends a ring out from the circle.
				if (ring >= 0) k.ring(cx, cy, heroRadius(T) * (1 + ring), 2, pal.player, { alpha: 1 - ring });
			});
		}

		if (cue.over) hook(() => cue.over!(k));

		// ---- 5. floating points ----
		for (const pop of f.popups) {
			const [x, y0] = px(pop.x, pop.y);
			text(pop.text, x, y0 - pop.age * 0.8 * T, {
				size: Math.max(8, Math.round(T * 0.5)), weight: 600, font: 'mono', fill: '#ffffff', stroke: pal.bg, strokeWidth: 3,
				alpha: 1 - pop.age
			});
		}

		// ---- 6. banners ----
		if (opts.banners !== false) banner();

		ctx.setTransform(1, 0, 0, 1, 0, 0);

		/** READY / LEVEL n / MAZE CLEAR / GAME OVER: boxed mono text, a black box with a thin pale border. */
		function banner() {
			let title: string | null = null, sub: string | null = null;
			if (f.phase === 'ready') { title = opts.readyLabel ?? 'READY'; sub = m.name; }
			else if (f.phase === 'clear') title = 'MAZE CLEAR';
			else if (f.phase === 'over') title = 'GAME OVER';
			if (!title) return;
			const fs = Math.max(7, Math.round(T * 0.62));
			const showSub = !!sub && T >= 12;
			const subFs = Math.max(7, Math.round(fs * 0.55));
			ctx.save();
			ctx.font = `600 ${fs}px ${fonts.mono}`;
			let w = ctx.measureText(title).width + fs * 1.2;
			if (showSub) {
				ctx.font = `600 ${subFs}px ${fonts.mono}`;
				w = Math.max(w, ctx.measureText(sub!.toUpperCase()).width + fs * 1.2);
			}
			const h = fs * 1.7 + (showSub ? subFs * 1.3 : 0);
			const cx = (m.W * T) / 2, cy = (m.bannerRow + 0.5) * T, top = cy - fs * 0.85;
			const x0 = Math.round(cx - w / 2), y0 = Math.round(top);
			ctx.fillStyle = pal.bg;
			ctx.fillRect(x0, y0, Math.round(w), Math.round(h));
			ctx.strokeStyle = BASE_COLORS.line;
			ctx.lineWidth = 1;
			ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.round(w) - 1, Math.round(h) - 1);
			ctx.restore();
			text(title, cx, cy + 1, { size: fs, weight: 600, font: 'mono', fill: '#ffffff' });
			if (showSub) text(sub!.toUpperCase(), cx, cy + fs * 0.85 + subFs * 0.55, { size: subFs, weight: 600, font: 'mono', fill: pal.inkDim });
		}
	}

	return { resize, draw, get tile() { return T; }, get dpr() { return dpr; } };
}

// ---------- drawing any scene anywhere ----------
const renderers = new WeakMap<HTMLCanvasElement, Renderer>();

export interface SceneRenderOptions extends Partial<RenderOptions> {
	cue: Cue;
	/** Tile size in CSS pixels. If left out, the largest tile that fits `width` x `height`. */
	tile?: number;
	width?: number;
	height?: number;
	/** Device pixel ratio; defaults to the screen's (capped at 3). */
	dpr?: number;
}

/**
 * Draws any Scene on any canvas at any size: replays, thumbnails, previews. Keeps one renderer
 * per canvas, so calling it every frame is cheap.
 */
export function renderScene(canvas: HTMLCanvasElement, scene: Scene, o: SceneRenderOptions): Renderer {
	let r = renderers.get(canvas);
	if (!r) renderers.set(canvas, (r = createRenderer(canvas)));
	const m = scene.maze;
	const tile = o.tile ?? Math.max(2, Math.min((o.width ?? m.W * 16) / m.W, (o.height ?? Infinity) / m.H));
	const dpr = o.dpr ?? Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 3);
	r.resize(m, tile, dpr);
	r.draw(scene, { banners: true, ...o, cue: o.cue });
	return r;
}
