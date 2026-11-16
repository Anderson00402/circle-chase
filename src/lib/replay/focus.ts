/**
 * Where to look on a small picture of the board: a square window around the player and the ghost
 * that matters (the nearest scared one, or the one that just turned back), so cues drawn on the
 * characters stay readable in thumbnails and replay stills. Pure; positions in tiles.
 */
import type { Frame, Maze, Scene } from '../game/types';

export interface FocusWindow {
	/** Centre of the window, in tiles. */
	cx: number;
	cy: number;
	/** Side of the square window, in tiles. */
	size: number;
}

export interface FocusOptions {
	/** Smallest window side in tiles (default 9). */
	min?: number;
	/** Tiles of room around the pair (default 5). */
	pad?: number;
	/** Largest window side in tiles (default: the board). */
	max?: number;
	/** What to keep in view when the pair does not fit in `max`: the ghost, or the player (default). */
	subject?: 'ghost' | 'player';
	/** Prefer this ghost (by id) when it is on the board. */
	ghost?: string | null;
}

/** The ghost worth watching: a preferred one, else the nearest scared one, else the nearest that just turned back, else the nearest. */
export function focusGhost(f: Frame, prefer?: string | null) {
	const px = f.player.x, py = f.player.y;
	const out = f.ghosts.filter((g) => g.mode === 'active' || g.mode === 'leaving');
	if (prefer) {
		const g = out.find((x) => x.id === prefer);
		if (g) return g;
	}
	const d = (g: { x: number; y: number }) => Math.hypot(g.x - px, g.y - py);
	const near = (list: typeof out) => list.reduce<(typeof out)[number] | null>((b, g) => (!b || d(g) < d(b) ? g : b), null);
	return near(out.filter((g) => g.scared)) ?? near(out.filter((g) => g.revertedAt >= 0 && f.t - g.revertedAt < 3)) ?? near(out);
}

export function focusWindow(f: Frame, maze: Pick<Maze, 'W' | 'H'>, o: FocusOptions = {}): FocusWindow {
	const min = o.min ?? 9, pad = o.pad ?? 5;
	const W = maze.W, H = maze.H;
	const px = wrap(f.player.x, W), py = f.player.y;
	const g = focusGhost(f, o.ghost);
	let gx = g ? wrap(g.x, W) : px, gy = g ? g.y : py;
	// A ghost on the far side of a tunnel is not near: look at the player alone.
	if (Math.abs(gx - px) > W / 2) { gx = px; gy = py; }
	const max = Math.min(o.max ?? Infinity, W, H);
	const span = Math.max(Math.abs(gx - px), Math.abs(gy - py)) + pad;
	if (span > max) {
		// Too far apart for one close-up: keep the subject in the middle.
		const [sx, sy] = o.subject === 'ghost' ? [gx, gy] : [px, py];
		return clampWindow({ cx: sx + 0.5, cy: sy + 0.5, size: max }, maze);
	}
	const size = Math.max(Math.min(min, max), span);
	return clampWindow({ cx: (px + gx) / 2 + 0.5, cy: (py + gy) / 2 + 0.5, size }, maze);
}

/** Keep a window inside the board. */
export function clampWindow(w: FocusWindow, maze: Pick<Maze, 'W' | 'H'>): FocusWindow {
	const h = w.size / 2;
	return {
		size: w.size,
		cx: Math.min(Math.max(w.cx, h), maze.W - h),
		cy: Math.min(Math.max(w.cy, h), maze.H - h)
	};
}

/**
 * Windows for a whole clip, smoothed forwards and backwards so the camera glides instead of
 * jumping when the nearest ghost changes. Same input, same output: safe for scrubbing.
 */
export function focusPath(scenes: Scene[], o: FocusOptions = {}, smooth = 0.12): FocusWindow[] {
	if (!scenes.length) return [];
	const raw = scenes.map((s) => focusWindow(s.frame, s.maze, o));
	const pass = (list: FocusWindow[]) => {
		const out: FocusWindow[] = [];
		let p = list[0];
		for (const w of list) {
			p = { cx: p.cx + (w.cx - p.cx) * smooth, cy: p.cy + (w.cy - p.cy) * smooth, size: p.size + (w.size - p.size) * smooth };
			out.push(p);
		}
		return out;
	};
	const there = pass(raw);
	const back = pass([...there].reverse()).reverse();
	return back.map((w, i) => clampWindow(w, scenes[i].maze));
}

const wrap = (x: number, W: number) => ((x % W) + W) % W;
