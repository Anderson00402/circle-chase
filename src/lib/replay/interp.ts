/**
 * Smooth playback of a stored clip. Clips keep one scene every 1/20 s of game time; drawing only
 * those would look choppy, so `sceneAt(scenes, t)` builds the scene at any game time in between:
 *
 * - Positions are interpolated along the maze, not in a straight line: across a tunnel the shorter
 *   way round is taken, and when an actor turns a corner between two samples it goes through the
 *   corner instead of cutting it. Jumps longer than a few tiles (a respawn) snap.
 * - Continuous numbers (game time, power left, phase time, bonus time) are interpolated, so a cue
 *   drawn from them animates smoothly.
 * - Discrete fields (phase, modes, scared flags, dots, score...) are taken from one of the two
 *   samples. They switch at the exact moment when the data says when (power end, power start, a
 *   ghost being eaten or turning dangerous) and halfway between the samples otherwise.
 *
 * Pure: the same scenes and time always give the same scene, so scrubbing in any direction works.
 */
import type { Frame, GhostView, Scene } from '../game/types';

/** Index of the last stored scene at or before `t` (0 when `t` is before the first). */
export function indexAt(scenes: Scene[], t: number): number {
	let lo = 0, hi = scenes.length - 1;
	if (hi < 0 || t <= scenes[0].frame.t) return 0;
	if (t >= scenes[hi].frame.t) return hi;
	while (hi - lo > 1) {
		const mid = (lo + hi) >> 1;
		if (scenes[mid].frame.t <= t) lo = mid;
		else hi = mid;
	}
	return lo;
}

/** Game time of the next / previous stored scene, for frame stepping. */
export function stepTime(scenes: Scene[], t: number, dir: 1 | -1): number {
	if (!scenes.length) return t;
	if (dir > 0) {
		for (let i = indexAt(scenes, t); i < scenes.length; i++) if (scenes[i].frame.t > t + 1e-4) return scenes[i].frame.t;
		return scenes[scenes.length - 1].frame.t;
	}
	for (let i = Math.min(indexAt(scenes, t) + 1, scenes.length - 1); i >= 0; i--) if (scenes[i].frame.t < t - 1e-4) return scenes[i].frame.t;
	return scenes[0].frame.t;
}

const SNAP = 3; // tiles: anything further between two samples is a jump, not a move
const within = (x: number, a: number, b: number) => x > a + 1e-9 && x <= b + 1e-9;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const onGrid = (v: number) => Math.abs(v - Math.round(v)) < 0.02;

/**
 * Position between two samples at fraction `k`, through the maze: shorter way round a tunnel,
 * through the corner when the actor turned. `null` means "too far apart, snap".
 */
export function movePos(ax: number, ay: number, bx: number, by: number, k: number, W: number): [number, number] | null {
	let dx = bx - ax;
	if (dx > W / 2) dx -= W;
	else if (dx < -W / 2) dx += W;
	const dy = by - ay;
	if (Math.abs(dx) + Math.abs(dy) > SNAP) return null;
	const ex = ax + dx; // b, unwrapped next to a
	let x: number, y: number;
	if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) {
		// Turned a corner: actors only turn at tile centres, so go a -> corner -> b.
		let cx: number, cy: number;
		if (onGrid(ay) && onGrid(ex)) { cx = Math.round(ex); cy = Math.round(ay); }
		else if (onGrid(ax) && onGrid(by)) { cx = Math.round(ax); cy = Math.round(by); }
		else { cx = NaN; cy = NaN; }
		if (Number.isFinite(cx)) {
			const l1 = Math.abs(cx - ax) + Math.abs(cy - ay), l2 = Math.abs(ex - cx) + Math.abs(by - cy);
			const d = (l1 + l2) * k;
			if (d <= l1 && l1 > 0) { const f = d / l1; x = lerp(ax, cx, f); y = lerp(ay, cy, f); }
			else { const f = l2 > 0 ? (d - l1) / l2 : 1; x = lerp(cx, ex, f); y = lerp(cy, by, f); }
		} else { x = ax + dx * k; y = ay + dy * k; }
	} else { x = ax + dx * k; y = ay + dy * k; }
	// Keep x in the range the engine uses (just outside 0..W-1 in a tunnel is fine).
	if (x < -1) x += W;
	else if (x > W) x -= W;
	return [x, y];
}

/** When the board's discrete state switches from sample `a` to sample `b`. */
function switchAt(a: Frame, b: Frame): number {
	const pb = b.power, pa = a.power;
	if (pb.endedAt !== pa.endedAt && within(pb.endedAt, a.t, b.t)) return pb.endedAt;
	if (pb.startedAt !== pa.startedAt && within(pb.startedAt, a.t, b.t)) return pb.startedAt;
	return (a.t + b.t) / 2;
}

function ghostSwitchAt(a: GhostView, b: GhostView, fa: Frame, fb: Frame, fallback: number): number {
	if (b.eatenAt !== a.eatenAt && within(b.eatenAt, fa.t, fb.t)) return b.eatenAt;
	if (b.revertedAt !== a.revertedAt && within(b.revertedAt, fa.t, fb.t)) return b.revertedAt;
	return fallback;
}

/** Power left at `t`, continuous through starts and ends that fall between the samples. */
function powerLeft(a: Frame, b: Frame, t: number, k: number): number {
	const la = a.power.left, lb = b.power.left;
	if (la > 0 && lb > 0 && b.power.serial === a.power.serial) return lerp(la, lb, k);
	if (la > 0 && lb <= 0) return Math.max(0, la - (t - a.t));
	if (lb > 0) {
		const start = b.power.startedAt;
		if (start >= 0 && t < start) return la > 0 ? Math.max(0, la - (t - a.t)) : 0;
		return Math.min(b.power.total || Infinity, lb + (b.t - t));
	}
	return 0;
}

/** The scene at game time `t`, between the stored scenes (clamped to the clip). */
export function sceneAt(scenes: Scene[], t: number): Scene {
	const i = indexAt(scenes, t);
	const A = scenes[i], B = scenes[i + 1];
	if (!B || t <= A.frame.t) return A;
	const fa = A.frame, fb = B.frame;
	const span = fb.t - fa.t;
	if (span <= 1e-9) return B;
	const k = Math.min(1, (t - fa.t) / span);
	const sw = switchAt(fa, fb);
	const D = t >= sw ? B : A;
	const fd = D.frame;
	// A different maze (level change): nothing to interpolate.
	if (A.maze !== B.maze) return { maze: D.maze, dots: D.dots, frame: { ...fd, t, events: [] } };
	const W = A.maze.W;

	const pos = movePos(fa.player.x, fa.player.y, fb.player.x, fb.player.y, k, W);
	const player = { ...fd.player, x: pos ? pos[0] : fd.player.x, y: pos ? pos[1] : fd.player.y };

	const ghosts = fd.ghosts.map((g, gi) => {
		const ga = fa.ghosts[gi], gb = fb.ghosts[gi];
		if (!ga || !gb || ga.id !== gb.id) return g;
		const gsw = ghostSwitchAt(ga, gb, fa, fb, sw);
		const src = t >= gsw ? gb : ga;
		const p = movePos(ga.x, ga.y, gb.x, gb.y, k, W);
		return { ...src, x: p ? p[0] : src.x, y: p ? p[1] : src.y };
	});

	const samePhase = fa.phase === fb.phase && fb.phaseTime >= fa.phaseTime;
	const phaseTime = samePhase
		? lerp(fa.phaseTime, fb.phaseTime, k)
		: D === A ? fa.phaseTime + (t - fa.t) : Math.max(0, fb.phaseTime - (fb.t - t));

	const bonus = fd.bonus && fa.bonus && fb.bonus && fa.bonus.kind === fb.bonus.kind
		? { ...fd.bonus, left: lerp(fa.bonus.left, fb.bonus.left, k) }
		: fd.bonus;

	const frame: Frame = {
		...fd,
		t,
		phaseTime,
		player,
		ghosts,
		power: { ...fd.power, left: powerLeft(fa, fb, t, k) },
		bonus,
		popups: fd.popups.map((p) => ({ ...p, age: Math.max(0, p.age + (t - fd.t)) })),
		events: []
	};
	return { maze: D.maze, dots: D.dots, frame };
}
