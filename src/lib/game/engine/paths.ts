import { DIRS, PATH, type Maze } from '../types';

/**
 * Path distance in tiles from one tile to every other tile, walking only on open floor (the
 * player's view of the maze: no pen, no door) and wrapping through the tunnels.
 * Returns a W*H array; -1 where a tile cannot be reached or is not floor.
 *
 * Pure and cheap (one breadth-first search). Telemetry uses it for "distance to the nearest
 * scared ghost"; the bot uses it to plan. Fractional positions should be rounded to a tile first
 * (see `tileOf`).
 */
export function pathDistances(maze: Maze, from: readonly [number, number]): Int16Array {
	const { W, H, tiles } = maze;
	const dist = new Int16Array(W * H).fill(-1);
	const sx = ((Math.round(from[0]) % W) + W) % W, sy = Math.round(from[1]);
	if (sy < 0 || sy >= H || tiles[sy * W + sx] !== PATH) return dist;
	const queue = new Int32Array(W * H);
	let head = 0, tail = 0;
	queue[tail++] = sy * W + sx;
	dist[sy * W + sx] = 0;
	while (head < tail) {
		const i = queue[head++], x = i % W, y = (i / W) | 0, nd = dist[i] + 1;
		for (let d = 0; d < 4; d++) {
			const ny = y + DIRS[d].y;
			if (ny < 0 || ny >= H) continue;
			const j = ny * W + (x + DIRS[d].x + W) % W;
			if (dist[j] >= 0 || tiles[j] !== PATH) continue;
			dist[j] = nd;
			queue[tail++] = j;
		}
	}
	return dist;
}

/** The tile a (possibly fractional, possibly just-outside-the-edge) position stands on. */
export function tileOf(maze: Maze, x: number, y: number): [number, number] {
	return [((Math.round(x) % maze.W) + maze.W) % maze.W, Math.round(y)];
}

/** Path distance between two positions in tiles; -1 when no path. Runs one search, so cache when calling often. */
export function pathDistance(maze: Maze, a: readonly [number, number], b: readonly [number, number]): number {
	const [bx, by] = tileOf(maze, b[0], b[1]);
	if (by < 0 || by >= maze.H) return -1;
	return pathDistances(maze, a)[by * maze.W + bx];
}
