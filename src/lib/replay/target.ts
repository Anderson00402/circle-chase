/**
 * Which ghost the player is up against at each moment of a clip, measured like the tracker does
 * (docs/STUDY.md): path distance through the maze to the nearest target ghost that is out of the
 * pen. During the power the targets are the scared ghosts; after it, the ghosts that were scared
 * when it ran out (they are now the danger).
 */
import { distanceField } from '../telemetry/distance';
import type { GhostView, Scene } from '../game/types';

export interface Target {
	/** Index into `frame.ghosts`, or -1 when there is no target. */
	ghost: number;
	/** Path distance in tiles; null without a target. */
	dist: number | null;
	/** True when the target is dangerous (after the power ended). */
	danger: boolean;
}

const NONE: Target = { ghost: -1, dist: null, danger: false };

function isTarget(g: GhostView, powerOn: boolean, endT: number | null): boolean {
	if (g.mode !== 'active') return false;
	if (powerOn) return g.scared;
	return endT !== null && g.revertedAt >= 0 && Math.abs(g.revertedAt - endT) < 0.06;
}

/** Target of one scene. `endT` is the game time the power ran out (null if it never did in the clip). */
export function targetOf(scene: Scene, endT: number | null): Target {
	const f = scene.frame;
	const powerOn = f.power.left > 0;
	const cands = f.ghosts.map((g, i) => [g, i] as const).filter(([g]) => isTarget(g, powerOn, endT));
	if (!cands.length || f.phase !== 'playing') return NONE;
	const field = distanceField(scene.maze, f.player.x, f.player.y);
	let best = NONE;
	for (const [g, i] of cands) {
		const d = field.to(g.x, g.y);
		if (Number.isFinite(d) && (best.dist === null || d < best.dist)) best = { ghost: i, dist: d, danger: !powerOn };
	}
	return best;
}

/** Targets for every stored scene, computed lazily and cached (a flood fill per scene). */
export function targetCache(scenes: Scene[], endT: number | null): (i: number) => Target {
	const cache = new Map<number, Target>();
	return (i) => {
		let v = cache.get(i);
		if (!v) cache.set(i, (v = scenes[i] ? targetOf(scenes[i], endT) : NONE));
		return v;
	};
}
