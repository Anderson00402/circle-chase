/**
 * Continuous path distance through the maze, in tiles, with tunnel wrap.
 *
 * Actors move between tile centres, so a position like x = 12.4 sits on the edge between tiles 12
 * and 13. The engine's `pathDistances` works tile to tile; here a position is expressed as one or
 * two "anchor" tiles with the cost of reaching each (0.4 to tile 12, 0.6 to tile 13), so the
 * distance shrinks smoothly every frame instead of in whole-tile steps. That smoothness matters:
 * "chasing" compares distances 0.3 s apart.
 */
import { pathDistances } from '../game/engine/paths';
import type { Maze } from '../game/types';

interface Anchor { i: number; cost: number }

const EPS = 1e-6;

function anchors(maze: Maze, x: number, y: number): Anchor[] {
	const { W } = maze;
	const wrap = (v: number) => ((v % W) + W) % W;
	const fx = x - Math.floor(x), fy = y - Math.floor(y);
	if (fx > EPS && fx < 1 - EPS) {
		const x0 = Math.floor(x), ry = Math.round(y);
		return [{ i: ry * W + wrap(x0), cost: fx }, { i: ry * W + wrap(x0 + 1), cost: 1 - fx }];
	}
	if (fy > EPS && fy < 1 - EPS) {
		const y0 = Math.floor(y), rx = wrap(Math.round(x));
		return [{ i: y0 * W + rx, cost: fy }, { i: (y0 + 1) * W + rx, cost: 1 - fy }];
	}
	return [{ i: Math.round(y) * W + wrap(Math.round(x)), cost: 0 }];
}

/** Distances from one position to anywhere. Build once per frame for the player, query per ghost. */
export interface DistanceField {
	/** Path distance from the field's origin to (x, y); Infinity when unreachable. */
	to(x: number, y: number): number;
}

export function distanceField(maze: Maze, x: number, y: number): DistanceField {
	const { W, H } = maze;
	const from = anchors(maze, x, y).filter((a) => a.i >= 0 && a.i < W * H);
	const floods = from.map((a) => pathDistances(maze, [a.i % W, (a.i / W) | 0]));
	const toTile = (i: number) => {
		let best = Infinity;
		for (let k = 0; k < from.length; k++) {
			const d = floods[k][i];
			if (d >= 0 && from[k].cost + d < best) best = from[k].cost + d;
		}
		return best;
	};
	const fromKey = from.map((a) => a.i).sort((a, b) => a - b).join(',');
	return {
		to(gx, gy) {
			const target = anchors(maze, gx, gy).filter((a) => a.i >= 0 && a.i < W * H);
			let best = Infinity;
			for (const a of target) best = Math.min(best, a.cost + toTile(a.i));
			// Both on the same edge between two tiles: the straight gap is shorter than going via either end.
			if (from.length === 2 && target.length === 2 && fromKey === target.map((a) => a.i).sort((a, b) => a - b).join(',')) {
				let dx = Math.abs(gx - x);
				dx = Math.min(dx, W - dx);
				best = Math.min(best, dx + Math.abs(gy - y));
			}
			return best;
		}
	};
}
