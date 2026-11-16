import { DOOR, PATH, PEN, WALL, DIRS, type Maze, type MazeTheme } from '../types';

/**
 * Maze definitions.
 *
 * Each maze is drawn as text. `half` holds the left half (the right half mirrors it, sharing the
 * middle column); `rows` holds a full maze when it is not symmetric.
 *   #  wall      .  dot      o  power dot      -  pen door      _  pen floor      (space) open floor
 * A row whose first tile is open is a tunnel row: it wraps around the left and right edges.
 */
export interface MazeDef {
	id: string;
	name: string;
	half?: string[];
	rows?: string[];
	start: [number, number];
	exit: [number, number];
	home: [number, number];
	pen: [number, number][];
	bannerRow: number;
	bonusTile: [number, number];
	theme: MazeTheme;
}

export const MAZE_DEFS: MazeDef[] = [
	{
		id: 'neon',
		name: 'Neon',
		start: [9, 15],
		exit: [9, 7],
		home: [9, 9],
		pen: [[8, 9], [9, 9], [10, 9]],
		bannerRow: 11,
		bonusTile: [9, 11],
		theme: { bg: '#05060f', wall: '#2f6bff', wallGlow: '#2f6bff', dot: '#c9d6ff', power: '#ffffff' },
		half: [
			'##########',
			'#o........',
			'#.##.#####',
			'#........#',
			'###.#.##.#',
			'###.#.##..',
			'###.#.###.',
			' ...#.....',
			'#####.###-',
			' .....##__',
			'#####.####',
			' ...#.....',
			'###.#.####',
			'###.#....#',
			'###.#.##.#',
			'#.....##..',
			'#.##.#####',
			'#o........',
			'##########'
		]
	},
	{
		id: 'rings',
		name: 'Rings',
		start: [9, 15],
		exit: [9, 7],
		home: [9, 10],
		pen: [[9, 9], [9, 10], [9, 11]],
		bannerRow: 13,
		bonusTile: [9, 13],
		theme: { bg: '#07040f', wall: '#a05bff', wallGlow: '#a05bff', dot: '#e3d4ff', power: '#ffffff' },
		half: [
			'##########',
			'#o........',
			'#.###.####',
			'#.#.......',
			'#.#.#####.',
			'#.#.#.....',
			'#.#.#.#.##',
			'#.#...#...',
			'#.#.#.#.#-',
			'#.#.#.#.#_',
			' ...#...#_',
			'#.#.#.#.#_',
			'#.#.#.#.##',
			'#.#...#...',
			'#.#.#.###.',
			'#.#.#.....',
			'#.#.##.###',
			'#.#.......',
			'#.#######.',
			'#o........',
			'##########'
		]
	},
	{
		id: 'blocks',
		name: 'Blocks',
		start: [9, 16],
		exit: [9, 7],
		home: [9, 10],
		pen: [[9, 9], [9, 10], [9, 11]],
		bannerRow: 13,
		bonusTile: [9, 13],
		theme: { bg: '#030a0c', wall: '#19c2a6', wallGlow: '#19c2a6', dot: '#c8f5ec', power: '#ffffff' },
		half: [
			'##########',
			'#o........',
			'#.##.#####',
			'#.##.#####',
			'#.........',
			'#.##.##.##',
			'#.##.##.##',
			'#.##......',
			'#.##.##.#-',
			'#.##.##.#_',
			' ....##.#_',
			'#.##.##.#_',
			'#.##.##.##',
			'#.##......',
			'#.##.##.##',
			'#.##.##.##',
			'#.........',
			'#.##.#####',
			'#.##.#####',
			'#o........',
			'##########'
		]
	}
];

export function buildMaze(def: MazeDef): Maze {
	const rows = def.rows ?? def.half!.map((h) => h + [...h.slice(0, -1)].reverse().join(''));
	const H = rows.length, W = rows[0].length;
	const tiles = new Uint8Array(W * H), dotsInit = new Uint8Array(W * H);
	let dotTotal = 0;
	rows.forEach((row, y) => {
		if (row.length !== W) throw new Error(`maze ${def.id}: row ${y} is ${row.length} wide, expected ${W}`);
		[...row].forEach((c, x) => {
			const i = y * W + x;
			tiles[i] = c === '#' ? WALL : c === '-' ? DOOR : c === '_' ? PEN : PATH;
			if (c === '.' || c === 'o') {
				dotsInit[i] = c === 'o' ? 2 : 1;
				dotTotal++;
			}
		});
	});
	const s = def.start[1] * W + def.start[0];
	if (dotsInit[s]) {
		dotsInit[s] = 0;
		dotTotal--;
	}
	const tunnelRows: number[] = [];
	for (let y = 0; y < H; y++) if (tiles[y * W] !== WALL) tunnelRows.push(y);
	return {
		id: def.id, name: def.name, W, H, tiles, dotsInit, dotTotal,
		start: def.start, exit: def.exit, home: def.home, penSlots: def.pen,
		tunnelRows, bannerRow: def.bannerRow, bonusTile: def.bonusTile, theme: def.theme
	};
}

const cache = new Map<string, Maze>();
/** The maze for a level (levels cycle through the mazes). Mazes are immutable, so they are shared. */
export function mazeForLevel(level: number): Maze {
	const def = MAZE_DEFS[(level - 1) % MAZE_DEFS.length];
	let m = cache.get(def.id);
	if (!m) cache.set(def.id, (m = buildMaze(def)));
	return m;
}
export function mazeById(id: string): Maze {
	const def = MAZE_DEFS.find((d) => d.id === id) ?? MAZE_DEFS[0];
	let m = cache.get(def.id);
	if (!m) cache.set(def.id, (m = buildMaze(def)));
	return m;
}

/** Steps from every walkable tile to (sx, sy), walking through the pen door. -1 where unreachable. */
export function flood(m: Maze, [sx, sy]: [number, number], throughPen = true): Int16Array {
	const dist = new Int16Array(m.W * m.H).fill(-1);
	const queue = [sy * m.W + sx];
	dist[queue[0]] = 0;
	for (let q = 0; q < queue.length; q++) {
		const x = queue[q] % m.W, y = (queue[q] / m.W) | 0;
		for (const d of DIRS) {
			const nx = (x + d.x + m.W) % m.W, ny = y + d.y;
			if (ny < 0 || ny >= m.H) continue;
			const i = ny * m.W + nx, t = m.tiles[i];
			if (t === WALL || dist[i] >= 0) continue;
			if (!throughPen && t !== PATH) continue;
			dist[i] = dist[queue[q]] + 1;
			queue.push(i);
		}
	}
	return dist;
}
