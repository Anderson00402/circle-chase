import { DOOR, PEN, WALL, type Maze } from '../types';
import { mix, rgba, TAU } from './util';

/**
 * Static parts of the board: maze geometry (pen box, outer perimeter, dot positions) and cached
 * pictures (floor, walls, wall masks). Everything here depends only on the maze, the tile size,
 * the pixel ratio and colours, so it is computed once and reused for every frame.
 */

// ---------- cache ----------
/** Small shared LRU cache, so thumbnails and the live board reuse each other's layers. */
const MAX_LAYERS = 64;
const layers = new Map<string, HTMLCanvasElement>();
export function cached(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
	const hit = layers.get(key);
	if (hit) {
		layers.delete(key);
		layers.set(key, hit);
		return hit;
	}
	const c = make();
	layers.set(key, c);
	if (layers.size > MAX_LAYERS) layers.delete(layers.keys().next().value!);
	return c;
}

/** Off-screen canvas of w x h CSS pixels, its context already scaled so one unit is one CSS pixel. */
export function makeCanvas(w: number, h: number, dpr: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(w * dpr));
	c.height = Math.max(1, Math.round(h * dpr));
	const x = c.getContext('2d')!;
	x.setTransform(dpr, 0, 0, dpr, 0, 0);
	return [c, x];
}

const mkey = (m: Maze, T: number, dpr: number) => `${m.id}:${m.W}x${m.H}:${T}:${dpr}`;

// ---------- line metrics ----------
/** How far the neon line sits from the floor, and how thick it is, at tile size T. */
export function wallMetrics(T: number) {
	const cut = T * 0.16;
	const lw = Math.max(1.1, T * 0.1);
	return { cut, lw };
}

// ---------- geometry ----------
export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
	cx: number;
	cy: number;
}
export interface PerimeterPoint {
	x: number;
	y: number;
	/** Unit direction of travel. */
	tx: number;
	ty: number;
	/** Unit normal pointing into the maze. */
	nx: number;
	ny: number;
}
export interface Perimeter {
	/** The whole loop, clockwise from the top centre and back. */
	path: Path2D;
	length: number;
	/** Point at distance `d` along the loop (clamped to 0..length). */
	pointAt(d: number): PerimeterPoint;
	/** The stretch from distance `from` to `to` as a path, ready to stroke. */
	slice(from: number, to: number): Path2D;
}
export interface DotSpot {
	/** Index into `scene.dots` / `maze.dotsInit`. */
	i: number;
	x: number;
	y: number;
	/** Centre in CSS pixels. */
	cx: number;
	cy: number;
	/** 1 dot, 2 power dot, as laid out at the start. */
	kind: 1 | 2;
}
export interface BoardGeometry {
	/** The whole board in CSS pixels. */
	board: Box;
	/** The pen floor (PEN tiles). */
	pen: Box;
	/** The pen door (DOOR tiles). */
	door: Box;
	/** Centre of the tile eaten ghosts go back to. */
	home: [number, number];
	/** The outermost neon line as a loop. */
	perimeter: Perimeter;
	/** Every tile that starts with a pickup, row by row. */
	dots: DotSpot[];
}

const geoCache = new Map<string, BoardGeometry>();

function boxOf(m: Maze, T: number, kind: number): Box {
	let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
	for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
		if (m.tiles[y * m.W + x] !== kind) continue;
		x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
	}
	if (x0 === Infinity) { x0 = x1 = m.home[0]; y0 = y1 = m.home[1]; }
	const b = { x: x0 * T, y: y0 * T, w: (x1 - x0 + 1) * T, h: (y1 - y0 + 1) * T };
	return { ...b, cx: b.x + b.w / 2, cy: b.y + b.h / 2 };
}

function makePerimeter(m: Maze, T: number): Perimeter {
	const { cut, lw } = wallMetrics(T);
	const W = m.W * T, H = m.H * T, a = cut + lw / 2, r = Math.min(T * 0.5, lw * 2);
	// Rounded rectangle along the outer line, as a polyline (corners split into short steps).
	const pts: [number, number][] = [[W / 2, a]];
	const corner = (cx: number, cy: number, from: number) => {
		for (let s = 0; s <= 6; s++) {
			const ang = from + (s / 6) * (Math.PI / 2);
			pts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
		}
	};
	corner(W - a - r, a + r, -Math.PI / 2);
	corner(W - a - r, H - a - r, 0);
	corner(a + r, H - a - r, Math.PI / 2);
	corner(a + r, a + r, Math.PI);
	pts.push([W / 2, a]);
	const at = [0];
	for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
	const length = at[at.length - 1];
	const path = new Path2D();
	pts.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));

	const seg = (d: number) => {
		let lo = 1, hi = pts.length - 1;
		while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] < d) lo = mid + 1; else hi = mid; }
		return lo;
	};
	const pointAt = (d: number): PerimeterPoint => {
		d = Math.max(0, Math.min(length, d));
		const i = seg(d), [x0, y0] = pts[i - 1], [x1, y1] = pts[i], len = at[i] - at[i - 1] || 1, k = (d - at[i - 1]) / len;
		const tx = (x1 - x0) / len, ty = (y1 - y0) / len;
		// Clockwise on screen, so the inside is to the right of travel: (-ty, tx).
		return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, tx, ty, nx: -ty, ny: tx };
	};
	const slice = (from: number, to: number) => {
		const p = new Path2D();
		from = Math.max(0, Math.min(length, from));
		to = Math.max(from, Math.min(length, to));
		const a0 = pointAt(from);
		p.moveTo(a0.x, a0.y);
		for (let i = seg(from); i < pts.length && at[i] < to; i++) p.lineTo(pts[i][0], pts[i][1]);
		const b = pointAt(to);
		p.lineTo(b.x, b.y);
		return p;
	};
	return { path, length, pointAt, slice };
}

export function geometry(m: Maze, T: number): BoardGeometry {
	const key = `${m.id}:${m.W}x${m.H}:${T}`;
	const hit = geoCache.get(key);
	if (hit) return hit;
	const W = m.W * T, H = m.H * T;
	const dots: DotSpot[] = [];
	for (let y = 0; y < m.H; y++) for (let x = 0; x < m.W; x++) {
		const i = y * m.W + x, k = m.dotsInit[i];
		if (k === 1 || k === 2) dots.push({ i, x, y, cx: (x + 0.5) * T, cy: (y + 0.5) * T, kind: k });
	}
	const g: BoardGeometry = {
		board: { x: 0, y: 0, w: W, h: H, cx: W / 2, cy: H / 2 },
		pen: boxOf(m, T, PEN),
		door: boxOf(m, T, DOOR),
		home: [(m.home[0] + 0.5) * T, (m.home[1] + 0.5) * T],
		perimeter: makePerimeter(m, T),
		dots
	};
	if (geoCache.size > 32) geoCache.clear();
	geoCache.set(key, g);
	return g;
}

// ---------- wall pictures ----------
const isWall = (m: Maze, x: number, y: number) => x >= 0 && y >= 0 && x < m.W && y < m.H && m.tiles[y * m.W + x] === WALL;

/**
 * White where the walls are, shrunk away from the floor by `inset` CSS pixels, with rounded
 * corners. Device pixels, full board. Cached.
 */
export function wallMask(m: Maze, T: number, dpr: number, inset: number): HTMLCanvasElement {
	return cached(`${mkey(m, T, dpr)}:mask:${inset.toFixed(2)}`, () => {
		const [c, x] = makeCanvas(m.W * T, m.H * T, dpr);
		x.fillStyle = '#fff';
		x.beginPath();
		for (let y = 0; y < m.H; y++) for (let i = 0; i < m.W; i++) if (isWall(m, i, y)) x.rect(i * T, y * T, T, T);
		x.fill();
		if (inset > 0) {
			x.globalCompositeOperation = 'destination-out';
			x.beginPath();
			for (let y = -1; y <= m.H; y++) for (let i = -1; i <= m.W; i++) {
				if (!isWall(m, i, y)) x.roundRect(i * T - inset, y * T - inset, T + 2 * inset, T + 2 * inset, inset);
			}
			x.fill();
		}
		return c;
	});
}

/** A ring of the wall shape between two insets, painted in `color`. New canvas each call (callers cache). */
function wallRing(m: Maze, T: number, dpr: number, from: number, to: number, color: string): HTMLCanvasElement {
	const [c, x] = makeCanvas(m.W * T, m.H * T, dpr);
	x.setTransform(1, 0, 0, 1, 0, 0);
	x.drawImage(wallMask(m, T, dpr, from), 0, 0);
	x.globalCompositeOperation = 'destination-out';
	x.drawImage(wallMask(m, T, dpr, to), 0, 0);
	x.globalCompositeOperation = 'source-in';
	x.fillStyle = color;
	x.fillRect(0, 0, c.width, c.height);
	return c;
}

export interface WallStyle {
	/** Glow colour around the line; defaults to the line colour. */
	glow?: string;
	/** Only the outermost line along the board's edge (for fuses and borders). */
	outer?: boolean;
	/** Draw the tinted panel inside each wall block (default true). */
	fill?: boolean;
}

/**
 * The maze walls in one colour, in the game's look: a soft tinted panel, a glowing neon line with
 * a hot core and, on larger tiles, a thin inner line for depth. Device pixels, full board. Cached.
 */
export function wallLayer(m: Maze, T: number, dpr: number, color: string, style: WallStyle = {}): HTMLCanvasElement {
	const glow = style.glow ?? color, fill = style.fill !== false && !style.outer;
	return cached(`${mkey(m, T, dpr)}:walls:${color}:${glow}:${style.outer ? 1 : 0}:${fill ? 1 : 0}`, () => {
		const W = m.W * T, H = m.H * T;
		const { cut, lw } = wallMetrics(T);
		const [c, x] = makeCanvas(W, H, dpr);
		x.setTransform(1, 0, 0, 1, 0, 0);
		const keepOuter = (layer: HTMLCanvasElement) => {
			if (!style.outer) return layer;
			const lx = layer.getContext('2d')!;
			lx.setTransform(dpr, 0, 0, dpr, 0, 0);
			lx.globalCompositeOperation = 'destination-in';
			lx.lineWidth = T * 0.62;
			const a = cut + lw / 2;
			lx.strokeRect(a, a, W - 2 * a, H - 2 * a);
			return layer;
		};
		if (fill) {
			// Panel: tinted inside, a little brighter towards the line so blocks read as raised.
			x.drawImage(wallRing(m, T, dpr, cut, cut + lw + T * 0.2, rgba(color, 0.2)), 0, 0);
			x.drawImage(wallRing(m, T, dpr, cut + lw + T * 0.2, 1e3, rgba(color, 0.09)), 0, 0);
		}
		const line = keepOuter(wallRing(m, T, dpr, cut, cut + lw, color));
		// Glow: two soft passes, wide and tight.
		x.shadowColor = glow;
		x.shadowBlur = Math.max(2, T * 0.45) * dpr;
		x.globalAlpha = 0.85;
		x.drawImage(line, 0, 0);
		x.shadowBlur = Math.max(1, T * 0.15) * dpr;
		x.globalAlpha = 1;
		x.drawImage(line, 0, 0);
		x.shadowBlur = 0;
		x.shadowColor = 'transparent';
		if (T >= 12) {
			// Hot core down the middle of the line.
			const core = Math.max(0.5, lw * 0.34);
			x.drawImage(keepOuter(wallRing(m, T, dpr, cut + (lw - core) / 2, cut + (lw + core) / 2, mix(color, '#ffffff', 0.55))), 0, 0);
		}
		if (T >= 16 && !style.outer) {
			// A faint second line inside the block for depth.
			const gap = cut + lw + Math.max(1.5, T * 0.09), hair = Math.max(0.75, T * 0.035);
			x.globalAlpha = 0.45;
			x.drawImage(wallRing(m, T, dpr, gap, gap + hair, color), 0, 0);
			x.globalAlpha = 1;
		}
		return c;
	});
}

/**
 * The floor under everything: background colour, a soft light in the middle and a faint grid of
 * specks so the empty board has some texture. Device pixels, full board. Cached.
 */
export function floorLayer(m: Maze, T: number, dpr: number, bg: string, tint: string): HTMLCanvasElement {
	return cached(`${mkey(m, T, dpr)}:floor:${bg}:${tint}`, () => {
		const W = m.W * T, H = m.H * T;
		const [c, x] = makeCanvas(W, H, dpr);
		x.fillStyle = bg;
		x.fillRect(0, 0, W, H);
		const g = x.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.7);
		g.addColorStop(0, rgba(tint, 0.09));
		g.addColorStop(0.6, rgba(tint, 0.03));
		g.addColorStop(1, 'rgba(0,0,0,0.25)');
		x.fillStyle = g;
		x.fillRect(0, 0, W, H);
		if (T >= 12) {
			// Specks at tile corners on the floor only.
			x.fillStyle = rgba(tint, 0.13);
			const s = Math.max(0.6, T * 0.035);
			x.beginPath();
			for (let y = 1; y < m.H; y++) for (let i = 1; i < m.W; i++) {
				if (isWall(m, i, y) || isWall(m, i - 1, y) || isWall(m, i, y - 1) || isWall(m, i - 1, y - 1)) continue;
				x.moveTo(i * T + s, y * T);
				x.arc(i * T, y * T, s, 0, TAU);
			}
			x.fill();
		}
		// A soft glow inside the pen.
		const pen = boxOf(m, T, PEN);
		const pg = x.createRadialGradient(pen.cx, pen.cy, 0, pen.cx, pen.cy, Math.max(pen.w, pen.h) * 0.75);
		pg.addColorStop(0, rgba(tint, 0.16));
		pg.addColorStop(1, rgba(tint, 0));
		x.fillStyle = pg;
		x.fillRect(pen.x - pen.w, pen.y - pen.h, pen.w * 3, pen.h * 3);
		return c;
	});
}

/** The pen door: a glowing bar across each DOOR tile. Drawn in CSS units on `x`. */
export function drawDoor(x: CanvasRenderingContext2D, m: Maze, T: number, color: string) {
	const h = Math.max(1.5, T * 0.14);
	x.save();
	x.fillStyle = color;
	x.shadowColor = color;
	x.shadowBlur = T * 0.3;
	for (let y = 0; y < m.H; y++) for (let i = 0; i < m.W; i++) {
		if (m.tiles[y * m.W + i] !== DOOR) continue;
		x.beginPath();
		x.roundRect(i * T - T * 0.08, (y + 0.5) * T - h / 2, T * 1.16, h, h / 2);
		x.fill();
	}
	x.restore();
}

/**
 * The whole static board (floor, walls, door) in one picture, so a frame starts with one
 * `drawImage`. Device pixels. Cached per maze, size and colours.
 */
export function boardLayer(m: Maze, T: number, dpr: number, bg: string, wall: string, glow: string, door: string): HTMLCanvasElement {
	return cached(`${mkey(m, T, dpr)}:board:${bg}:${wall}:${glow}:${door}`, () => {
		const [c, x] = makeCanvas(m.W * T, m.H * T, dpr);
		x.setTransform(1, 0, 0, 1, 0, 0);
		x.drawImage(floorLayer(m, T, dpr, bg, glow), 0, 0);
		x.drawImage(wallLayer(m, T, dpr, wall, { glow }), 0, 0);
		x.setTransform(dpr, 0, 0, dpr, 0, 0);
		drawDoor(x, m, T, door);
		return c;
	});
}
