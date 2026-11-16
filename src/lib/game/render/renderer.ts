import {
	type Cue, type CueContext, type GhostLook, type GhostView, type Maze, type Palette, type Scene, type TextOptions
} from '../types';
import { drawHero, drawWisp, softGlow, wispPath } from './actors';
import { boardLayer, cached, geometry, makeCanvas, wallLayer, wallMask, wallMetrics } from './board';
import { drawBonus, drawPowerDot } from './items';
import { appFonts, clamp, ease, hash, lerp, mix, noise, rgba, smoothstep, TAU } from './util';

/**
 * Draws a Scene on a canvas with one countdown cue plugged in.
 *
 * Pure: the same scene always gives the same picture, so replays match what the player saw.
 * Every effect (bursts, the death animation, the clear flash, banners) is worked out from game
 * time and timestamps in the frame, never from earlier draws. Only static pictures are cached.
 *
 * The base game never hints at the time left: scared wisps look the same from the first moment
 * to the last. The only exception is the white blink, and only when the cue asks for it
 * (`cue.baseFlash`, used by the classic-blink condition).
 */

export const BASE_COLORS = {
	player: '#c6f23a',
	scared: '#cfe6ff',
	scaredFill: '#3d4fe6',
	ink: '#f2f5ff',
	inkDim: '#a3b6de',
	accent: '#ff8a4c',
	flash: '#f7f9ff',
	flashInk: '#ff3d6b',
	ghost: { hunter: '#ff4d6d', ambusher: '#ffa133', guard: '#35e0ff', drifter: '#c08cff' }
} as const;

export function paletteFor(maze: Maze): Palette {
	const t = maze.theme;
	return {
		...t,
		...BASE_COLORS,
		door: mix(t.wall, '#ffffff', 0.55),
		ghost: { ...BASE_COLORS.ghost }
	};
}

/** Default "about to end" blink: five blinks over the last 2 s, the last one ending with the power. */
const FLASHES = 5, FLASH_PERIOD = 0.4;
export function powerFlash(left: number): boolean {
	const warn = FLASHES * FLASH_PERIOD;
	if (left <= 0 || left > warn) return false;
	return (warn - left) % FLASH_PERIOD < FLASH_PERIOD / 2;
}

/** The look the renderer gives a ghost in this scene with this cue. */
export function lookOf(g: GhostView, left: number, cue: Pick<Cue, 'baseFlash'>): GhostLook {
	if (g.mode === 'returning') return 'eyes';
	if (g.scared) return cue.baseFlash && powerFlash(left) ? 'scared-flash' : 'scared';
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

// Phase timings from the engine (seconds into the phase).
const DEATH_FREEZE = 0.35, DEATH_SHRINK = 1.05, DEATH_POP = 0.5;

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

		// Small shake when caught (from the phase clock, so it replays exactly).
		let sx = 0, sy = 0;
		if (f.phase === 'dying' && !reduce && f.phaseTime < DEATH_FREEZE) {
			const a = (1 - f.phaseTime / DEATH_FREEZE) * T * 0.12;
			sx = (noise(f.phaseTime * 40, 1) - 0.5) * 2 * a;
			sy = (noise(f.phaseTime * 40, 2) - 0.5) * 2 * a;
		}
		const base = () => ctx.setTransform(dpr, 0, 0, dpr, sx * dpr, sy * dpr);

		const px = (x: number, y: number): [number, number] => [(x + 0.5) * T, (y + 0.5) * T];
		const eachWrap = (x: number, fn: (cx: number) => void) => {
			for (const off of [-m.W, 0, m.W]) { const q = x + off; if (q > -1 && q < m.W) fn((q + 0.5) * T); }
		};
		const wrapX = (x: number) => ((x % m.W) + m.W) % m.W;
		const ghostY = (g: GhostView, i: number) => g.mode === 'waiting' && !reduce ? g.y + Math.sin(now * 4 + i * 2) * 0.14 : g.y;
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
			baseFlash: () => powerFlash(p.left),
			drawGhost: (g, i, look, cx, cy, o) => drawWisp(ctx, pal, T, g, i, look, cx, cy, time, o),
			ghostPath: (g, i, cx, cy, o) => {
				const lk = o?.look ?? 'normal', scared = lk === 'scared' || lk === 'scared-flash';
				return wispPath(ctx, T, g, i, cx, cy, time, o?.scale ?? 1, scared ? 1 : 0, !scared && lk !== 'eyes');
			},
			drawPlayer: (cx, cy, scale = 1, o = {}) => drawHero(ctx, pal, T, cx, cy, f.player.face, travel, f.player.moving && f.phase === 'playing', time, { ...o, scale }),
			wallLayer: (color, glow, o) => wallLayer(m, T, dpr, color, { glow, ...o }),
			fonts,
			geo,
			ghostLook: (g) => lookOf(g, p.left, cue),
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
		drawLayer(boardLayer(m, T, dpr, pal.bg, pal.wall, pal.wallGlow, pal.door));
		if (f.phase === 'clear') {
			// Maze clear: the walls flash white four times (one gentle glow with reduced motion).
			const ct = f.phaseTime;
			const on = reduce ? ease.bump(clamp((ct - 0.3) / 1.6)) * 0.7
				: ct > 0.4 && ct < 1.9 && Math.floor((ct - 0.4) / 0.19) % 2 === 0 ? 1 : 0;
			if (on > 0) drawLayer(wallLayer(m, T, dpr, '#ffffff', { glow: pal.wallGlow }), on);
		}
		base();
		if (cue.walls) hook(() => cue.walls!(k));

		// ---- 2. pickups ----
		const drawDots = () => {
			const r = Math.max(1.1, T * 0.085);
			if (T >= 12) {
				ctx.fillStyle = rgba(pal.dot, 0.16);
				ctx.beginPath();
				for (const d of geo.dots) {
					if (dots[d.i] !== 1) continue;
					ctx.moveTo(d.cx + r * 2.2, d.cy);
					ctx.arc(d.cx, d.cy, r * 2.2, 0, TAU);
				}
				ctx.fill();
			}
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
				drawPowerDot(ctx, cx, cy, T, pal.power, pal.wallGlow, reduce ? 0.5 : 0.5 + 0.5 * Math.sin(now * 5 + i));
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
			softGlow(ctx, cx, cy, T * 0.9, '#ffe9b0', 0.5);
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
				const g = f.ghosts[i], look = lookOf(g, p.left, cue), y = ghostY(g, i);
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
			let scale = 1, spin = 0, lift = 0;
			let mood: 'normal' | 'happy' | 'dizzy' = 'normal';
			if (f.phase === 'dying' && pt > DEATH_FREEZE) {
				const u = clamp((pt - DEATH_FREEZE) / (DEATH_SHRINK - DEATH_FREEZE));
				mood = 'dizzy';
				scale = 1 - ease.inCubic(u);
				spin = reduce ? 0 : ease.inQuad(u) * TAU * 1.5;
				lift = reduce ? 0 : -Math.sin(u * Math.PI) * T * 0.15;
			} else if (f.phase === 'clear') {
				mood = 'happy';
				lift = reduce ? 0 : -Math.abs(Math.sin(pt * 7)) * T * 0.14 * (1 - clamp(pt / 2.2));
			}
			eachWrap(f.player.x, (cx) => {
				const cy = (f.player.y + 0.5) * T + lift;
				const def = () => {
					if (scale <= 0.02) return;
					if (spin) {
						ctx.save();
						ctx.translate(cx, cy);
						ctx.rotate(spin);
						k.drawPlayer(0, 0, scale, { mood });
						ctx.restore();
					} else k.drawPlayer(cx, cy, scale, { mood });
				};
				if (cue.player) hook(() => cue.player!(k, cx, cy, def)); else def();
			});
			if (f.phase === 'dying') deathPop(pt);
		}

		if (cue.over) hook(() => cue.over!(k));

		// ---- 5. effects from timestamps ----
		// Power-up picked up: one ripple from the hero. It says a power-up began, nothing about its end.
		const sinceStart = now - p.startedAt;
		if (p.startedAt >= 0 && sinceStart >= 0 && sinceStart < 0.5 && p.left > 0 && !reduce) {
			const [cx, cy] = k.playerPos(), u = sinceStart / 0.5;
			k.ring(cx, cy, T * (0.5 + 3.5 * ease.outCubic(u)), Math.max(1, T * 0.12 * (1 - u)), pal.power, { alpha: 0.7 * (1 - u) });
		}
		// Ghost eaten / bonus taken: a burst where the points pop up.
		for (const pop of f.popups) {
			if (pop.age > 0.45) continue;
			const [cx, cy] = px(pop.x, pop.y), u = pop.age / 0.45;
			k.ring(cx, cy, T * (0.3 + 0.9 * ease.outCubic(u)), Math.max(1, T * 0.1 * (1 - u)), pal.accent, { alpha: 1 - u });
			if (reduce) continue;
			for (let s = 0; s < 8; s++) {
				const a = (s / 8) * TAU + hash(pop.x, pop.y, s) * 0.6, d = T * (0.35 + 1.1 * ease.outQuad(u) * (0.6 + 0.4 * hash(s, pop.x)));
				ctx.fillStyle = rgba(s % 2 ? pal.ink : pal.accent, 1 - u);
				ctx.beginPath();
				ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(0.7, T * 0.06 * (1 - u)), 0, TAU);
				ctx.fill();
			}
		}

		// ---- 6. floating points ----
		for (const pop of f.popups) {
			const [x, y0] = px(pop.x, pop.y);
			const rise = ease.outCubic(pop.age) * T * 0.9;
			const pop0 = reduce ? 1 : 0.6 + 0.4 * ease.outBack(clamp(pop.age / 0.25));
			text(pop.text, x, y0 - rise, {
				size: Math.max(8, T * 0.58), weight: 800, fill: pal.ink, stroke: pal.bg, strokeWidth: Math.max(2, T * 0.14),
				alpha: 1 - smoothstep(0.6, 1, pop.age), scale: pop0, glow: pal.accent
			});
		}

		// ---- 7. banners ----
		if (opts.banners !== false) banner();

		ctx.setTransform(1, 0, 0, 1, 0, 0);

		function deathPop(pt: number) {
			const u = (pt - DEATH_SHRINK + 0.1) / DEATH_POP;
			if (u <= 0 || u >= 1) return;
			const [cx, cy] = k.playerPos();
			k.ring(cx, cy, T * (0.2 + 1.2 * ease.outCubic(u)), Math.max(1, T * 0.1 * (1 - u)), pal.player, { alpha: 1 - u });
			if (reduce) return;
			for (let s = 0; s < 12; s++) {
				const a = (s / 12) * TAU + 0.3, d = T * (0.2 + 1.4 * ease.outCubic(u) * (0.7 + 0.3 * hash(s, f.level)));
				const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d + u * u * T * 0.4;
				ctx.save();
				ctx.translate(x, y);
				ctx.rotate(a + u * 3);
				ctx.fillStyle = rgba(s % 3 ? pal.player : '#4fae3a', 1 - u);
				ctx.beginPath();
				ctx.ellipse(0, 0, T * 0.11 * (1 - u * 0.5), T * 0.05, 0, 0, TAU);
				ctx.fill();
				ctx.restore();
			}
		}

		function banner() {
			let title: string | null = null, sub: string | null = null, color = pal.ink, t0 = 0;
			if (f.phase === 'ready') { title = opts.readyLabel ?? 'READY'; sub = m.name; t0 = f.phaseTime; color = pal.player; }
			else if (f.phase === 'clear' && f.phaseTime > 0.3) { title = 'MAZE CLEAR'; t0 = f.phaseTime - 0.3; color = pal.ink; }
			else if (f.phase === 'over') { title = 'GAME OVER'; t0 = f.phaseTime; color = BASE_COLORS.ghost.hunter; }
			if (!title) return;
			const cx = (m.W * T) / 2, cy = (m.bannerRow + 0.5) * T;
			const size = Math.max(8, Math.round(T * 0.82));
			const inK = reduce ? 1 : ease.outBack(clamp(t0 / 0.3));
			const fade = reduce ? 1 : clamp(t0 / 0.15);
			// Dark plate behind the words so they read over dots and walls.
			ctx.save();
			ctx.globalAlpha = 0.82 * fade;
			ctx.font = `800 ${size}px ${fonts.display}`;
			const w = ctx.measureText(title).width + size * 1.6 + title.length * size * 0.08;
			const h = size * (sub && T >= 12 ? 2.25 : 1.5);
			const g = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
			g.addColorStop(0, rgba(pal.bg, 0));
			g.addColorStop(0.18, pal.bg);
			g.addColorStop(0.82, pal.bg);
			g.addColorStop(1, rgba(pal.bg, 0));
			ctx.fillStyle = g;
			ctx.fillRect(cx - w / 2, cy - h / 2 + (sub && T >= 12 ? size * 0.3 : 0), w, h);
			ctx.restore();
			text(title, cx, cy, {
				size, weight: 800, fill: color, glow: color, stroke: pal.bg, strokeWidth: Math.max(2, size * 0.16),
				scale: inK, alpha: fade, spacing: size * 0.08
			});
			if (sub && T >= 12) {
				text(sub.toUpperCase(), cx, cy + size * 0.95, {
					size: Math.round(size * 0.42), weight: 600, font: 'mono', fill: pal.inkDim, alpha: fade, spacing: size * 0.12
				});
			}
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
