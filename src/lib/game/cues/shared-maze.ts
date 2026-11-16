import { PATH, WALL, type CueContext, type GeoBox, type Maze } from '../types';

/**
 * Helpers shared by the cues whose signal lives in the maze itself (burning fuse, wall tide,
 * pen hourglass, dot sweep). Everything here depends only on the maze and the tile size, so it
 * is worked out once and cached; nothing remembers earlier frames.
 */

const mkey = (m: Maze, T: number) => `${m.id}:${m.W}x${m.H}:${T}`;

function memo<V>(cache: Map<string, V>, key: string, make: () => V): V {
	const hit = cache.get(key);
	if (hit) return hit;
	const v = make();
	if (cache.size > 24) cache.clear();
	cache.set(key, v);
	return v;
}

export const tileAt = (m: Maze, x: number, y: number) =>
	x >= 0 && y >= 0 && x < m.W && y < m.H ? m.tiles[y * m.W + x] : WALL;

/** Width of the neon wall line at tile size T (same formula as the renderer). */
export const lineWidth = (T: number) => Math.max(1.1, T * 0.1);

// ---------- the outer wall as a fuse ----------
export interface Loop {
	length: number;
	pointAt(d: number): { x: number; y: number; tx: number; ty: number; nx: number; ny: number };
	slice(from: number, to: number): Path2D;
}

export interface FuseSpans {
	/** The loop down the middle of the outer wall, clockwise from the top centre. */
	loop: Loop;
	/** Stretches of the loop (distances along it) that run over wall; gaps are tunnel mouths. */
	spans: [number, number][];
	/** Total length of wall along the loop. */
	length: number;
}

/** A rounded rectangle `inset` in from the board edge, as a polyline loop clockwise from the top centre. */
function makeLoop(W: number, H: number, inset: number, r: number): Loop {
	const a = inset;
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
	const seg = (d: number) => {
		let lo = 1, hi = pts.length - 1;
		while (lo < hi) { const mid = (lo + hi) >> 1; if (at[mid] < d) lo = mid + 1; else hi = mid; }
		return lo;
	};
	const pointAt = (d: number) => {
		d = Math.max(0, Math.min(length, d));
		const i = seg(d), [x0, y0] = pts[i - 1], [x1, y1] = pts[i], len = at[i] - at[i - 1] || 1, k = (d - at[i - 1]) / len;
		const tx = (x1 - x0) / len, ty = (y1 - y0) / len;
		return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, tx, ty, nx: -ty, ny: tx };
	};
	const slice = (from: number, to: number) => {
		const p = new Path2D();
		from = Math.max(0, Math.min(length, from));
		to = Math.max(from, Math.min(length, to));
		const s0 = pointAt(from);
		p.moveTo(s0.x, s0.y);
		for (let i = seg(from); i < pts.length && at[i] < to; i++) p.lineTo(pts[i][0], pts[i][1]);
		const e = pointAt(to);
		p.lineTo(e.x, e.y);
		return p;
	};
	return { length, pointAt, slice };
}

const fuseCache = new Map<string, FuseSpans>();

/**
 * The fuse: a loop down the middle of the outer wall (one tile wide, so there is room for a thick
 * cord), split where tunnels open so the fuse never runs across a tunnel mouth.
 */
export function fuseSpans(k: CueContext): FuseSpans {
	const { maze: m, T } = k;
	return memo(fuseCache, mkey(m, T), () => {
		const loop = makeLoop(m.W * T, m.H * T, T * 0.5, T * 0.5), step = Math.max(0.5, T / 8);
		const spans: [number, number][] = [];
		let open = -1;
		for (let d = 0; d <= loop.length + step / 2; d += step) {
			const dd = Math.min(d, loop.length), p = loop.pointAt(dd);
			// Look a little to each side along the loop, so a gap covers the whole tunnel mouth and its rounded ends.
			const wall = [-0.3, 0, 0.3].every((o) => {
				const x = p.x + p.tx * o * T, y = p.y + p.ty * o * T;
				return tileAt(m, Math.min(m.W - 1, Math.max(0, Math.floor(x / T))), Math.min(m.H - 1, Math.max(0, Math.floor(y / T)))) === WALL;
			});
			if (wall && open < 0) open = dd;
			if (!wall && open >= 0) { spans.push([open, dd]); open = -1; }
		}
		if (open >= 0) spans.push([open, loop.length]);
		return { loop, spans, length: spans.reduce((s, [a, b]) => s + b - a, 0) };
	});
}

/** Loop distance reached after burning `burnt` of fuse length (jumps over gaps). */
export function fuseToPerimeter(f: FuseSpans, burnt: number): number {
	let acc = 0;
	for (const [a, b] of f.spans) {
		if (burnt <= acc + (b - a)) return a + Math.max(0, burnt - acc);
		acc += b - a;
	}
	return f.spans.length ? f.spans[f.spans.length - 1][1] : 0;
}

/** One path of the fuse between two loop distances, without the gaps. */
export function fusePath(f: FuseSpans, from: number, to: number): Path2D {
	const path = new Path2D();
	for (const [a, b] of f.spans) {
		const lo = Math.max(a, from), hi = Math.min(b, to);
		if (hi > lo) path.addPath(f.loop.slice(lo, hi));
	}
	return path;
}

// ---------- corridors ----------
const floorCache = new Map<string, Path2D>();

/** The corridors (open floor tiles, not the pen or door) as one path, for clipping. */
export function corridorPath(k: CueContext): Path2D {
	const { maze: m, T } = k;
	return memo(floorCache, mkey(m, T), () => {
		const p = new Path2D();
		// One rectangle per horizontal run keeps the path short.
		for (let y = 0; y < m.H; y++) {
			let x0 = -1;
			for (let x = 0; x <= m.W; x++) {
				const open = x < m.W && tileAt(m, x, y) === PATH;
				if (open && x0 < 0) x0 = x;
				if (!open && x0 >= 0) { p.rect(x0 * T, y * T, (x - x0) * T, T); x0 = -1; }
			}
		}
		return p;
	});
}

// ---------- the pen block ----------
/** The pen floor together with the ring of wall around it (pens are a block of wall with a hollow). */
export function penBlock(k: CueContext): GeoBox {
	const { pen } = k.geo, T = k.T;
	const x = pen.x - T, y = pen.y - T, w = pen.w + 2 * T, h = pen.h + 2 * T;
	return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

/**
 * The shared "about to end" beat for the last 2 s: 0..1, peaking five times and landing on 0 at
 * the end, so every cue in this group warns on the same clock. With reduced motion it becomes a
 * steady glow that grows over the last 2 s instead.
 */
export function finalBeat(k: CueContext): number {
	const left = k.power.left;
	if (!k.power.active || left > 2) return 0;
	if (k.reduceMotion) return 0.35 + 0.4 * (1 - left / 2);
	const u = (2 - left) / 0.4; // five beats of 0.4 s
	return Math.pow(0.5 - 0.5 * Math.cos(u * Math.PI * 2), 1.5);
}

/** 0 before the last 2 s, 1 from shortly after; the switch into the final warning. */
export const hotness = (k: CueContext) => (k.power.active ? k.smoothstep(2.08, 1.88, k.power.left) : 0);

/** True on the frame the final beat peaks (1.8, 1.4, 1.0, 0.6 and 0.2 s left), for a matching sound. */
export function beatPeakCrossed(prevLeft: number, left: number): boolean {
	if (left <= 0 || left >= prevLeft) return false;
	const n = (l: number) => (l > 2 ? 5 : Math.ceil((l - 0.2) / 0.4));
	return n(left) !== n(prevLeft);
}
