import { describe, expect, it } from 'vitest';
import { MAZE_DEFS, allMazes, buildMaze, flood, mazeById, mazeForLevel } from './mazes';
import { checkMaze, drawMaze, penLayout } from './validate';
import { pathDistance, pathDistances } from './paths';
import { tunnelTiles } from './game';
import { PATH } from '../types';

describe('mazes', () => {
	it('has five mazes with their own ids, names and colours', () => {
		expect(MAZE_DEFS).toHaveLength(5);
		expect(new Set(MAZE_DEFS.map((d) => d.id)).size).toBe(5);
		expect(new Set(MAZE_DEFS.map((d) => d.name)).size).toBe(5);
		expect(new Set(MAZE_DEFS.map((d) => d.theme.wall)).size).toBe(5);
	});

	for (const def of MAZE_DEFS) {
		it(`${def.id} follows the rules`, () => {
			const m = buildMaze(def);
			const problems = checkMaze(m);
			expect(problems, problems.join('\n') + '\n' + drawMaze(m)).toEqual([]);
		});

		it(`${def.id}: tunnels are slow zones that wrap`, () => {
			const m = buildMaze(def);
			const tube = tunnelTiles(m);
			for (const y of m.tunnelRows) {
				expect(tube[y * m.W]).toBe(1);
				expect(tube[y * m.W + m.W - 1]).toBe(1);
				expect(pathDistance(m, [0, y], [m.W - 1, y])).toBe(1);
			}
		});
	}

	it('levels walk through the mazes in order and then repeat', () => {
		expect(mazeForLevel(1).id).toBe(MAZE_DEFS[0].id);
		expect(mazeForLevel(5).id).toBe(MAZE_DEFS[4].id);
		expect(mazeForLevel(6).id).toBe(MAZE_DEFS[0].id);
		expect(mazeById('rings').name).toBe('Rings');
		expect(mazeById('nope').id).toBe(MAZE_DEFS[0].id);
		expect(allMazes().map((m) => m.id)).toEqual(MAZE_DEFS.map((d) => d.id));
	});

	it('the validator catches broken mazes', () => {
		const def = MAZE_DEFS[0];
		const rows = def.rows.slice();
		// Close one tile of a corridor: makes two dead ends and breaks the symmetry.
		rows[1] = rows[1].slice(0, 3) + '#' + rows[1].slice(4);
		const problems = checkMaze(buildMaze({ ...def, rows }));
		expect(problems.some((p) => p.includes('dead end'))).toBe(true);
		expect(problems.some((p) => p.includes('symmetric'))).toBe(true);
	});
});

describe('our own layouts', () => {
	// The middle every board used to share: a pen in the centre with the door on top, an empty ring
	// round it, a side tunnel at pen height between solid wings, the bonus right under the pen and
	// the start right under that.
	const CLASSIC_MIDDLE = [
		'#######################',
		'#o...................o#',
		'#.####.####.####.####.#',
		'#.####.####.####.####.#',
		'#.....................#',
		'#.#######.###.#######.#',
		'#.#######.###.#######.#',
		'#.....................#',
		'#####.#.#######.#.#####',
		'#####.#,,,,,,,,,#.#####',
		'#####.#,###-###,#.#####',
		',,,,,.,,#_____#,,.,,,,,',
		'#####.#,#_____#,#.#####',
		'#####.#,#######,#.#####',
		'#####.#,,,,B,,,,#.#####',
		'#####.#.#######.#.#####',
		'#.....................#',
		'#.####.####.####.####.#',
		'#.####.####.####.####.#',
		'#..........S..........#',
		'#.#######.###.#######.#',
		'#.#######.###.#######.#',
		'#o...................o#',
		'#######################',
	];

	it('the validator rejects the classic middle', () => {
		const problems = checkMaze(buildMaze({ ...MAZE_DEFS[4], rows: CLASSIC_MIDDLE }));
		expect(problems.some((p) => p.includes('runs past the pen'))).toBe(true);
		expect(problems.some((p) => p.includes('right below the pen'))).toBe(true);
		expect(problems.some((p) => p.includes('round the pen have dots'))).toBe(true);
	});

	it('pens, bonus tiles and starts differ from maze to maze', () => {
		const ms = allMazes();
		const pens = ms.map((m) => { const p = penLayout(m); return { mid: (p.top + p.bottom) / 2 / m.H, below: p.doorBelow, size: `${p.right - p.left}x${p.bottom - p.top}` }; });
		// Pens sit at clearly different heights, both door sides are used, and there is more than one pen shape.
		const heights = pens.map((p) => p.mid).sort((a, b) => a - b);
		expect(heights.at(-1)! - heights[0]).toBeGreaterThan(0.4);
		expect(new Set(pens.map((p) => p.below)).size).toBe(2);
		expect(new Set(pens.map((p) => p.size)).size).toBeGreaterThanOrEqual(3);
		const key = (p: [number, number], m: { W: number; H: number }) => `${Math.round((p[0] / m.W) * 10)},${Math.round((p[1] / m.H) * 10)}`;
		expect(new Set(ms.map((m) => key(m.bonusTile, m))).size).toBe(ms.length);
		expect(new Set(ms.map((m) => key(m.start, m))).size).toBeGreaterThanOrEqual(4);
	});
});

describe('pathDistances', () => {
	it('matches a plain flood over open floor and handles fractional positions', () => {
		for (const m of allMazes()) {
			const a = pathDistances(m, m.start), b = flood(m, m.start, false);
			for (let i = 0; i < a.length; i++) if (m.tiles[i] === PATH) expect(a[i]).toBe(b[i]);
			expect(pathDistances(m, [m.start[0] + 0.3, m.start[1] - 0.2])[m.start[1] * m.W + m.start[0]]).toBe(0);
		}
	});

	it('gives -1 from a wall', () => {
		const m = mazeForLevel(1);
		expect(Math.max(...pathDistances(m, [0, 0]))).toBe(-1);
	});
});
