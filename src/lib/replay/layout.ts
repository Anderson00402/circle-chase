/**
 * Was a clip recorded on the maze we would draw it on? Mazes changed under the same ids during
 * development, so a clip is never drawn on a layout it was not recorded on.
 *
 * - A clip with a layout fingerprint (`clip.layout`, set from `Maze.layout` since the fingerprint
 *   exists) matches when the fingerprint equals the current maze's.
 * - An older clip without one is tested: a recorded dot, the player or an active ghost on a wall
 *   tile of the current maze means the layout changed.
 */
import { WALL, type Scene } from '../game/types';
import { mazeById } from '../game/engine/mazes';

export const WRONG_MAZE_NOTE = 'Recorded on an earlier version of this maze, so the board cannot be redrawn.';

/** True when the clip may be drawn on the current maze. */
export function clipFitsMaze(clip: { mazeId: string; layout?: string | null }, scenes: Scene[]): boolean {
	if (clip.layout) {
		const now = mazeById(clip.mazeId).layout;
		return !now || now === clip.layout;
	}
	return scenesFitMaze(scenes);
}

/** The simple test for clips without a fingerprint. */
export function scenesFitMaze(scenes: Scene[]): boolean {
	if (!scenes.length) return true;
	const m = scenes[0].maze;
	const wall = (x: number, y: number) => {
		const tx = Math.round(x), ty = Math.round(y); // positions are tile centres at whole numbers
		// Off the board sideways is a tunnel, not a wall.
		if (tx < 0 || tx >= m.W || ty < 0 || ty >= m.H) return false;
		return m.tiles[ty * m.W + tx] === WALL;
	};
	const dots = scenes[0].dots;
	for (let i = 0; i < dots.length && i < m.tiles.length; i++) if (dots[i] && m.tiles[i] === WALL) return false;
	for (const s of scenes) {
		const p = s.frame.player;
		if (wall(p.x, p.y)) return false;
		for (const g of s.frame.ghosts) {
			// Ghosts waiting, leaving through the door or returning as eyes may cross pen tiles.
			if (g.mode !== 'active') continue;
			if (wall(g.x, g.y)) return false;
		}
	}
	return true;
}
