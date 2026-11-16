/**
 * The short scripted situation every cue preview plays: a bot eats a power dot, chases, eats a
 * ghost, and the power runs out with scared ghosts still on the board. Produced once, off screen,
 * by the real engine and bot with a fixed seed, so every cue is shown on exactly the same moment
 * and the previews can be compared side by side. Drawing is a pure function of a scene, so playing
 * these scenes back through any cue shows what a player would have seen with that cue.
 *
 * Cost: about 20-60 s of simulated play at 120 Hz (a few hundred ms of CPU, once per page load),
 * then about 280 scenes of a few hundred bytes each kept in memory and shared by every preview.
 */
import { createGame, STUDY_CONFIG } from '../game/engine/game';
import { createBot } from '../game/engine/bot';
import type { Scene } from '../game/types';

export interface PreviewClip {
	/** Scenes at `fps`, from `lead` s before the power dot to `tail` s after the power ran out. */
	scenes: Scene[];
	fps: number;
	/** Index of the first scene with power, and of the first scene after it ran out. */
	startIndex: number;
	endIndex: number;
	/** Power length in seconds. */
	total: number;
	/** Scared ghosts still out when the power ran out. */
	scaredAtEnd: number;
	/** A representative moment for stills: about 1.5 s before the end. */
	stillIndex: number;
}

const STEP = 1 / 120;
const FPS = 30;
const LEAD = 1.0, TAIL = 2.4, POWER = 6;

/** Seconds of power left at scene `i`: negative after the end, NaN before the power dot. */
export function leftAt(clip: PreviewClip, i: number): number {
	const f = clip.scenes[Math.max(0, Math.min(clip.scenes.length - 1, i))].frame;
	if (i < clip.startIndex) return NaN;
	if (f.power.left > 0) return f.power.left;
	return -(f.t - clip.scenes[clip.endIndex].frame.power.endedAt);
}

function build(seed: number): PreviewClip | null {
	// One fixed power length, so the situation is the same story every time it loops.
	const game = createGame({ ...STUDY_CONFIG, seed, frightRange: [POWER, POWER], powerRespawn: 6 });
	// A cautious bot eats a ghost early and then keeps its distance, so scared ghosts survive to the end.
	const bot = createBot(game, { seed, skill: 1, awarenessNoise: 0, caution: 2.5, reaction: 0.3 });
	const per = Math.round(1 / FPS / STEP);
	const leadN = Math.round(LEAD * FPS), tailN = Math.round(TAIL * FPS);
	const recent: Scene[] = [];
	type Take = { scenes: Scene[]; startIndex: number; endIndex: number; scaredAtEnd: number; eats: number; total: number };
	let cur: Take | null = null, best: Take | null = null, lastScared = 0;
	const score = (t: Take) => t.scaredAtEnd * 2 + Math.min(t.eats, 2);
	for (let i = 0; i < 90 / STEP; i++) {
		bot.step();
		game.update(STEP);
		if (i % per) continue;
		const s = game.scene();
		const f = s.frame;
		const snap: Scene = { maze: s.maze, dots: s.dots.slice(), frame: f };
		if (f.events.some((e) => e.type === 'power')) {
			cur = { scenes: recent.slice(-leadN), startIndex: 0, endIndex: -1, scaredAtEnd: 0, eats: 0, total: f.power.total };
			cur.startIndex = cur.scenes.length;
		}
		recent.push(snap);
		if (recent.length > leadN + 2) recent.shift();
		if (!cur) continue;
		cur.scenes.push(snap);
		cur.eats += f.events.filter((e) => e.type === 'eat').length;
		if (f.events.some((e) => e.type === 'die')) { cur = null; continue; }
		if (f.power.left > 0) lastScared = f.ghosts.filter((g) => g.scared && g.mode === 'active').length;
		else if (cur.endIndex < 0) {
			if (f.power.endReason !== 'expired') { cur = null; continue; }
			cur.endIndex = cur.scenes.length - 1;
			cur.scaredAtEnd = lastScared;
		}
		if (cur.endIndex >= 0 && cur.scenes.length - 1 - cur.endIndex >= tailN) {
			if (!best || score(cur) > score(best)) best = cur;
			cur = null;
			if (best.scaredAtEnd >= 3 && best.eats >= 1) break;
		}
	}
	if (!best) return null;
	return {
		scenes: best.scenes, fps: FPS, startIndex: best.startIndex, endIndex: best.endIndex, total: best.total,
		scaredAtEnd: best.scaredAtEnd, stillIndex: best.scenes.findIndex((s, i) => i >= best!.startIndex && s.frame.power.left > 0 && s.frame.power.left <= 1.5)
	};
}

let cached: PreviewClip | null = null;

/** The shared preview clip, built on first use. Deterministic: the same scenes on every machine. */
export function previewClip(): PreviewClip {
	if (cached) return cached;
	for (const seed of [7, 3, 11, 1, 5]) {
		const c = build(seed);
		if (c && (!cached || c.scaredAtEnd > cached.scaredAtEnd)) cached = c;
		if (cached && cached.scaredAtEnd >= 2) break;
	}
	if (!cached) throw new Error('no preview situation found');
	return cached;
}

/**
 * Index of the scene closest to `left` seconds of power left (negative: after the end). Used by
 * "compare at a moment", which sets every preview to the same time left.
 */
export function indexForLeft(clip: PreviewClip, left: number): number {
	let best = clip.startIndex, err = Infinity;
	for (let i = clip.startIndex; i < clip.scenes.length; i++) {
		const e = Math.abs(leftAt(clip, i) - left);
		if (e < err) { err = e; best = i; }
	}
	return best;
}

/** The moments offered by "compare at a moment", as seconds left (negative: after the end). */
export const MOMENTS: { left: number; label: string }[] = [
	{ left: 3, label: '3 s' },
	{ left: 2, label: '2 s' },
	{ left: 1, label: '1 s' },
	{ left: 0.3, label: '0.3 s' },
	{ left: -0.3, label: 'Just after' }
];
