import {
	DIRS, DOOR, WALL,
	type Cue, type CueContext, type GhostLook, type GhostView, type Maze, type Palette, type Scene
} from '../types';

/**
 * Draws a Scene on a canvas with one countdown cue plugged in.
 * Pure: the same scene always gives the same picture, so replays match what the player saw.
 */

const TAU = Math.PI * 2;
const FONT_MONO = '"Atkinson Hyperlegible Mono", ui-monospace, Menlo, monospace';

export const BASE_COLORS = {
	player: '#ffd84a',
	scared: '#8fd3ff',
	scaredFill: 'rgba(143, 211, 255, 0.12)',
	ink: '#eef3ff',
	inkDim: '#a3b6de',
	accent: '#ff8a4c',
	ghost: { hunter: '#ff6f91', ambusher: '#ff8a3d', guard: '#3fe0b0', drifter: '#b9a2ff' }
} as const;

export function paletteFor(maze: Maze): Palette {
	return { ...maze.theme, ...BASE_COLORS, ghost: { ...BASE_COLORS.ghost } };
}

/** Default "about to end" blink: five blinks over the last 2 s, the last one ending with the power. */
const FLASHES = 5, FLASH_PERIOD = 0.4;
export function powerFlash(left: number): boolean {
	const warn = FLASHES * FLASH_PERIOD;
	if (left <= 0 || left > warn) return false;
	return (warn - left) % FLASH_PERIOD < FLASH_PERIOD / 2;
}

export interface RenderOptions {
	cue: Cue;
	reduceMotion?: boolean;
	/** Text for the banner during READY (for example "LEVEL 2"). */
	readyLabel?: string;
}

export interface Renderer {
	/** Size the canvas for a maze at `tile` CSS pixels per tile. */
	resize(maze: Maze, tile: number, dpr: number): void;
	draw(scene: Scene, opts: RenderOptions): void;
	readonly tile: number;
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
	const ctx = canvas.getContext('2d')!;
	let T = 0, dpr = 1;
	let layers = new Map<string, HTMLCanvasElement>();

	function resize(maze: Maze, tile: number, ratio: number) {
		const w = Math.round(tile * maze.W * ratio), h = Math.round(tile * maze.H * ratio);
		if (tile === T && ratio === dpr && canvas.width === w && canvas.height === h) return;
		T = tile;
		dpr = ratio;
		layers = new Map();
		canvas.style.width = T * maze.W + 'px';
		canvas.style.height = T * maze.H + 'px';
		canvas.width = w;
		canvas.height = h;
	}

	function makeLayer(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
		const c = document.createElement('canvas');
		c.width = Math.round(w * dpr);
		c.height = Math.round(h * dpr);
		const x = c.getContext('2d')!;
		x.setTransform(dpr, 0, 0, dpr, 0, 0);
		return [c, x];
	}

	/** Wall outlines: every wall block becomes a rounded outline with a soft glow. Cached per colour. */
	function wallLayer(m: Maze, color: string, glow = color): HTMLCanvasElement {
		const key = `${m.id}:${color}:${glow}`;
		const hit = layers.get(key);
		if (hit) return hit;
		const W = m.W * T, H = m.H * T;
		const isWall = (x: number, y: number) => x >= 0 && y >= 0 && x < m.W && y < m.H && m.tiles[y * m.W + x] === WALL;
		const [layer, lx] = makeLayer(W, H);
		const cut = T * 0.17, lw = Math.max(2, T * 0.1);
		const shape = (inset: number) => {
			const [c, x] = makeLayer(W, H);
			x.fillStyle = '#fff';
			x.beginPath();
			for (let y = 0; y < m.H; y++) for (let i = 0; i < m.W; i++) if (isWall(i, y)) x.rect(i * T, y * T, T, T);
			x.fill();
			x.globalCompositeOperation = 'destination-out';
			x.beginPath();
			for (let y = -1; y <= m.H; y++) for (let i = -1; i <= m.W; i++) {
				if (!isWall(i, y)) x.roundRect(i * T - inset, y * T - inset, T + 2 * inset, T + 2 * inset, inset);
			}
			x.fill();
			return c;
		};
		const outer = shape(cut), inner = shape(cut + lw);
		const ox = outer.getContext('2d')!;
		ox.setTransform(1, 0, 0, 1, 0, 0);
		ox.globalCompositeOperation = 'destination-out';
		ox.drawImage(inner, 0, 0);
		ox.globalCompositeOperation = 'source-in';
		ox.fillStyle = color;
		ox.fillRect(0, 0, outer.width, outer.height);

		lx.setTransform(1, 0, 0, 1, 0, 0);
		lx.shadowColor = glow;
		lx.shadowBlur = Math.max(3, T * 0.3) * dpr;
		lx.drawImage(outer, 0, 0);
		layers.set(key, layer);
		return layer;
	}

	function ghostPath(c: CanvasRenderingContext2D, g: GhostView, index: number, cx: number, cy: number, time: number): number {
		const t = T, R = t * 0.37, hy = -t * 0.1;
		const d = g.dir >= 0 ? DIRS[g.dir] : { x: 0, y: 0 };
		const side = d.x ? -d.x : index % 2 ? 1 : -1;
		const tx = t * 0.22 + Math.sin(time * 5 + index * 1.7) * t * 0.06, ty = t * 0.47;
		c.save();
		c.translate(cx, cy);
		c.scale(side, 1);
		c.beginPath();
		c.moveTo(-R, hy);
		c.arc(0, hy, R, Math.PI, 0);
		c.bezierCurveTo(R, hy + R, tx + t * 0.12, ty - t * 0.1, tx, ty);
		c.bezierCurveTo(tx - t * 0.1, ty - t * 0.05, -R * 0.9, hy + R * 0.9, -R, hy);
		c.closePath();
		c.restore();
		return cy + hy;
	}

	function ghostEyes(c: CanvasRenderingContext2D, g: GhostView, cx: number, hy: number, color: string, glint: string | null) {
		const t = T, d = g.dir >= 0 ? DIRS[g.dir] : { x: 0, y: 0 };
		for (const side of [-1, 1]) {
			const x = cx + side * t * 0.13 + d.x * t * 0.06, y = hy + d.y * t * 0.05;
			c.fillStyle = color;
			c.beginPath();
			c.ellipse(x, y, t * 0.06, t * 0.09, 0, 0, TAU);
			c.fill();
			if (glint) {
				c.fillStyle = glint;
				c.beginPath();
				c.arc(x + t * 0.018, y - t * 0.035, t * 0.022, 0, TAU);
				c.fill();
			}
		}
	}

	function drawGhost(c: CanvasRenderingContext2D, pal: Palette, g: GhostView, index: number, look: GhostLook, cx: number, cy: number, time: number) {
		const color = pal.ghost[g.id], lw = Math.max(1.5, T * 0.07);
		const hy = ghostPath(c, g, index, cx, cy, time);
		if (look === 'eyes') {
			c.globalAlpha = 0.55;
			c.setLineDash([T * 0.07, T * 0.07]);
			c.lineWidth = lw;
			c.strokeStyle = color;
			c.stroke();
			c.setLineDash([]);
			ghostEyes(c, g, cx, hy, color, null);
			c.globalAlpha = 1;
			return;
		}
		if (look === 'scared' || look === 'scared-flash') {
			const ink = look === 'scared-flash' ? '#ffffff' : pal.scared;
			c.fillStyle = pal.scaredFill;
			c.fill();
			c.setLineDash([T * 0.14, T * 0.09]);
			c.lineWidth = lw;
			c.strokeStyle = ink;
			c.stroke();
			c.setLineDash([]);
			ghostEyes(c, g, cx, hy, ink, null);
			return;
		}
		c.fillStyle = color;
		c.fill();
		ghostEyes(c, g, cx, hy, pal.bg, '#ffffff');
	}

	function drawPlayerShape(c: CanvasRenderingContext2D, pal: Palette, scene: Scene, cx: number, cy: number, scale: number) {
		const f = scene.frame, face = DIRS[f.player.face];
		let r = T * 0.4 * scale;
		if (f.phase === 'dying') r *= 1 - Math.min(1, f.phaseTime / 1.1);
		if (r < 0.5) return;
		// The mouth opens and closes with distance travelled, and rests half open when standing still.
		const travel = f.player.x + f.player.y;
		const open = f.player.moving ? Math.abs(Math.sin(travel * Math.PI)) : 0.5;
		const mouth = (Math.PI / 4.5) * open;
		c.save();
		c.translate(cx, cy);
		c.rotate(Math.atan2(face.y, face.x));
		c.fillStyle = pal.player;
		c.beginPath();
		c.moveTo(0, 0);
		c.arc(0, 0, r, mouth, TAU - mouth);
		c.closePath();
		c.fill();
		c.restore();
	}

	function draw(scene: Scene, opts: RenderOptions) {
		const { maze: m, dots, frame: f } = scene;
		const reduce = !!opts.reduceMotion, cue = opts.cue, now = f.t;
		const pal = paletteFor(m);
		const px = (x: number, y: number): [number, number] => [(x + 0.5) * T, (y + 0.5) * T];
		const eachWrap = (x: number, fn: (cx: number) => void) => {
			for (const off of [-m.W, 0, m.W]) { const q = x + off; if (q > -1 && q < m.W) fn((q + 0.5) * T); }
		};
		const p = f.power;
		const k: CueContext = {
			ctx, T, dpr, scene, frame: f, maze: m, now, reduceMotion: reduce, colors: pal,
			power: {
				active: p.left > 0, left: p.left, total: p.total,
				frac: p.total > 0 ? Math.min(1, p.left / p.total) : 0,
				elapsed: p.left > 0 ? p.total - p.left : 0,
				sinceExpired: p.left <= 0 && p.endReason === 'expired' && p.endedAt >= 0 ? now - p.endedAt : Infinity
			},
			px, eachWrap,
			baseFlash: () => powerFlash(p.left),
			drawGhost: (g, i, look, cx, cy) => drawGhost(ctx, pal, g, i, look, cx, cy, reduce ? 0 : now),
			ghostPath: (g, i, cx, cy) => ghostPath(ctx, g, i, cx, cy, reduce ? 0 : now),
			drawPlayer: (cx, cy, scale = 1) => drawPlayerShape(ctx, pal, scene, cx, cy, scale),
			wallLayer: (color, glow) => wallLayer(m, color, glow)
		};

		// maze
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.fillStyle = pal.bg;
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		const clearFlash = f.phase === 'clear' && !reduce && Math.floor(f.phaseTime * 4) % 2 === 1;
		ctx.drawImage(wallLayer(m, clearFlash ? pal.accent : pal.wall, clearFlash ? pal.accent : pal.wallGlow), 0, 0);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		// pen door
		ctx.strokeStyle = pal.ink;
		ctx.globalAlpha = 0.6;
		ctx.lineWidth = Math.max(2, T * 0.1);
		ctx.setLineDash([T * 0.12, T * 0.1]);
		ctx.beginPath();
		for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
			if (m.tiles[y * m.W + x] === DOOR) { ctx.moveTo(x * T, (y + 0.5) * T); ctx.lineTo((x + 1) * T, (y + 0.5) * T); }
		}
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 1;
		cue.walls?.(k);

		// pickups
		const drawDots = () => {
			ctx.fillStyle = pal.dot;
			ctx.beginPath();
			const r = Math.max(1.4, T * 0.09);
			for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
				if (dots[y * m.W + x] !== 1) continue;
				const [cx, cy] = px(x, y);
				ctx.moveTo(cx + r, cy);
				ctx.arc(cx, cy, r, 0, TAU);
			}
			ctx.fill();
			const pulse = reduce ? 1 : 1 + 0.12 * Math.sin(now * 6);
			ctx.fillStyle = pal.power;
			for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
				if (dots[y * m.W + x] !== 2) continue;
				const [cx, cy] = px(x, y);
				ctx.beginPath();
				ctx.arc(cx, cy, T * 0.27 * pulse, 0, TAU);
				ctx.fill();
			}
		};
		if (cue.dots) cue.dots(k, drawDots); else drawDots();
		if (f.bonus) {
			const [cx, cy] = px(f.bonus.x, f.bonus.y);
			ctx.fillStyle = pal.accent;
			ctx.beginPath();
			ctx.moveTo(cx, cy - T * 0.3); ctx.lineTo(cx + T * 0.26, cy); ctx.lineTo(cx, cy + T * 0.3); ctx.lineTo(cx - T * 0.26, cy);
			ctx.closePath();
			ctx.fill();
		}

		cue.under?.(k);

		// ghosts
		const showGhosts = f.phase !== 'clear' && !(f.phase === 'dying' && f.phaseTime > 0.35);
		if (showGhosts) {
			f.ghosts.forEach((g, i) => {
				let y = g.y;
				if (g.mode === 'waiting' && !reduce) y += Math.sin(now * 4 + i * 2) * 0.16;
				const look: GhostLook = g.mode === 'returning' ? 'eyes'
					: g.scared ? (cue.baseFlash && powerFlash(p.left) ? 'scared-flash' : 'scared')
					: 'normal';
				eachWrap(g.x, (cx) => {
					const cy = (y + 0.5) * T;
					const def = () => k.drawGhost(g, i, look, cx, cy);
					if (cue.ghost) cue.ghost(k, g, i, cx, cy, def); else def();
				});
			});
		}

		// player
		if (f.phase !== 'over') {
			eachWrap(f.player.x, (cx) => {
				const cy = (f.player.y + 0.5) * T;
				const def = () => k.drawPlayer(cx, cy);
				if (cue.player) cue.player(k, cx, cy, def); else def();
			});
		}

		cue.over?.(k);

		// floating points
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = `600 ${Math.round(T * 0.5)}px ${FONT_MONO}`;
		ctx.lineWidth = 3;
		for (const pop of f.popups) {
			const [x, y0] = px(pop.x, pop.y), y = y0 - pop.age * 0.8 * T;
			ctx.globalAlpha = 1 - pop.age;
			ctx.strokeStyle = pal.bg;
			ctx.strokeText(pop.text, x, y);
			ctx.fillStyle = pal.ink;
			ctx.fillText(pop.text, x, y);
		}
		ctx.globalAlpha = 1;

		// banner
		const text = f.phase === 'ready' ? (opts.readyLabel ?? 'READY') : f.phase === 'clear' ? 'MAZE CLEAR' : null;
		if (text) {
			const fs = Math.round(T * 0.62);
			ctx.font = `600 ${fs}px ${FONT_MONO}`;
			const w = ctx.measureText(text).width + fs * 1.2, h = fs * 1.7;
			const cx = (m.W * T) / 2, cy = (m.bannerRow + 0.5) * T;
			ctx.fillStyle = pal.bg;
			ctx.strokeStyle = pal.ink;
			ctx.lineWidth = 1;
			ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
			ctx.strokeRect(cx - w / 2 + 0.5, cy - h / 2 + 0.5, w - 1, h - 1);
			ctx.fillStyle = pal.ink;
			ctx.fillText(text, cx, cy + 1);
		}
	}

	return { resize, draw, get tile() { return T; } };
}
