import { DOOR, PATH, PEN, WALL, DIRS, type Maze, type MazeTheme } from '../types';

/**
 * Maze definitions. All five are original designs for this game.
 *
 * Each maze is drawn as text, one string per row:
 *   #  wall          .  dot           o  power dot      ,  open floor without a dot
 *   -  pen door      _  pen floor     S  player start   B  bonus tile (open floor, also the banner row)
 * A row whose edge tiles are open is a tunnel row: it wraps around the left and right edges.
 * The tile above the door is where ghosts leave the pen; the pen's slots and home are worked out
 * from the door (see `buildMaze`). `engine/validate.ts` checks every maze against the genre's
 * rules (symmetric, no dead ends, corridors one tile wide...) and runs in the tests.
 */
export interface MazeDef {
	id: string;
	name: string;
	/** One line on the maze's character, for menus and docs. */
	about: string;
	rows: string[];
	theme: MazeTheme;
}

export const MAZE_DEFS: MazeDef[] = [
	{
		id: 'plaza',
		name: 'Plaza',
		about: 'Big open blocks and long straights: easy to read, the calm first board.',
		theme: { bg: '#0b0905', wall: '#e0a526', wallGlow: '#e0a526', dot: '#ffe9b8', power: '#ffffff' },
		rows: [
			'#########################',
			'#o.....................o#',
			'#.####.#####.#####.####.#',
			'#.####.#####.#####.####.#',
			'#.####.#####.#####.####.#',
			'#.......................#',
			'#.####.###########.####.#',
			'#.####.###########.####.#',
			'#.####.###########.####.#',
			'#.####..,,,,,,,,,..####.#',
			'#.####.#,###-###,#.####.#',
			',,,,,,.#,#_____#,#.,,,,,,',
			'#.####.#,#_____#,#.####.#',
			'#.####.#,#######,#.####.#',
			'#.####..,,,,B,,,,..####.#',
			'#.####.###########.####.#',
			'#...........S...........#',
			'#.####.#####.#####.####.#',
			'#.####.#####.#####.####.#',
			'#.####.#####.#####.####.#',
			'#o.....................o#',
			'#.##########.##########.#',
			'#.##########.##########.#',
			'#.......................#',
			'#########################',
		]
	},
	{
		id: 'rings',
		name: 'Rings',
		about: 'Loops inside loops joined by a few spokes; easy to get boxed in on the outer ring.',
		theme: { bg: '#07040f', wall: '#a05bff', wallGlow: '#a05bff', dot: '#e3d4ff', power: '#ffffff' },
		rows: [
			'#######################',
			'#o.........#.........o#',
			'#.########.#.########.#',
			'#.#........#........#.#',
			'#.#.#####.###.#####.#.#',
			'#.#.#.............#.#.#',
			'#.#.#.###########.#.#.#',
			',.#.#..,,,,,,,,,..#.#.,',
			'#.#.#.#,###-###,#.#.#.#',
			'#.#.#.#,#_____#,#.#.#.#',
			'#.#.#.#,#_____#,#.#.#.#',
			'#.#.#.#,#######,#.#.#.#',
			'#...#..,,,,B,,,,..#...#',
			'#.#.#.###.###.###.#.#.#',
			'#.#.#.............#.#.#',
			'#.#.#.#####.#####.#.#.#',
			'#.#........S........#.#',
			',.#.#.###########.#.#.,',
			'#.#.#.###########.#.#.#',
			'#.#.#.............#.#.#',
			'#.#.#####.###.#####.#.#',
			'#.#o.......#.......o#.#',
			'#.########.#.########.#',
			'#..........#..........#',
			'#######################',
		]
	},
	{
		id: 'canyon',
		name: 'Canyon',
		about: 'Tall vertical channels with short bridges, tunnels high and low.',
		theme: { bg: '#0d0507', wall: '#e0465e', wallGlow: '#e0465e', dot: '#ffd6dc', power: '#ffffff' },
		rows: [
			'#########################',
			'#o...###.........###...o#',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			',....###.........###....,',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			'#.##.....###.###.....##.#',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			'#....###,,,,,,,,,###....#',
			'#.##.###,###-###,###.##.#',
			'#.##.###,#_____#,###.##.#',
			'#....###,#_____#,###....#',
			'#.##.###,#######,###.##.#',
			'#.##.###,,,,B,,,,###.##.#',
			'#.##.###.###.###.###.##.#',
			'#....###.###.###.###....#',
			'#.##.###.###.###.###.##.#',
			'#.##.###....S....###.##.#',
			'#.##.###.###.###.###.##.#',
			'#.##.....###.###.....##.#',
			',....###.###.###.###....,',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			'#o.....................o#',
			'#########################',
		]
	},
	{
		id: 'circuit',
		name: 'Circuit',
		about: 'A tight grid of short lanes with many crossings, tunnels high and low.',
		theme: { bg: '#030a0c', wall: '#19c2a6', wallGlow: '#19c2a6', dot: '#c8f5ec', power: '#ffffff' },
		rows: [
			'#######################',
			'#o......#######......o#',
			'#.##.##.#######.##.##.#',
			'#.##.##.#######.##.##.#',
			',.....................,',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			'#.##...............##.#',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			'#......,,,,,,,,,......#',
			'#.##.##,###-###,##.##.#',
			'#.##.##,#_____#,##.##.#',
			'#.##.##,#_____#,##.##.#',
			'#.##.##,#######,##.##.#',
			'#......,,,,B,,,,......#',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			',.......###.###.......,',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			'#..........S..........#',
			'#.#####.###.###.#####.#',
			'#o...................o#',
			'#######################',
		]
	},
	{
		id: 'hedges',
		name: 'Hedges',
		about: 'Long rows of hedges with staggered gaps: straight runs, many T-crossings, a crowded field.',
		theme: { bg: '#05070f', wall: '#2f6bff', wallGlow: '#2f6bff', dot: '#c9d6ff', power: '#ffffff' },
		rows: [
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
		]
	}
];

export function buildMaze(def: MazeDef): Maze {
	const rows = def.rows;
	const H = rows.length, W = rows[0].length;
	const tiles = new Uint8Array(W * H), dotsInit = new Uint8Array(W * H);
	let dotTotal = 0;
	let start: [number, number] | null = null, bonus: [number, number] | null = null, door: [number, number] | null = null;
	rows.forEach((row, y) => {
		if (row.length !== W) throw new Error(`maze ${def.id}: row ${y} is ${row.length} wide, expected ${W}`);
		[...row].forEach((c, x) => {
			const i = y * W + x;
			tiles[i] = c === '#' ? WALL : c === '-' ? DOOR : c === '_' ? PEN : PATH;
			if (c === '.' || c === 'o') {
				dotsInit[i] = c === 'o' ? 2 : 1;
				dotTotal++;
			}
			if (c === 'S') start = [x, y];
			if (c === 'B') bonus = [x, y];
			if (c === '-') door = [x, y];
		});
	});
	if (!start || !bonus || !door) throw new Error(`maze ${def.id}: needs S, B and a door`);
	const [dx, dy] = door as [number, number];
	// Pen: the lower inside row holds the three waiting ghosts, two tiles apart; the middle one is home.
	const slotRow = tiles[(dy + 2) * W + dx] === PEN ? dy + 2 : dy + 1;
	const penSlots: [number, number][] = [[dx, slotRow], [dx - 2, slotRow], [dx + 2, slotRow]];
	const tunnelRows: number[] = [];
	for (let y = 0; y < H; y++) if (tiles[y * W] !== WALL) tunnelRows.push(y);
	const b = bonus as [number, number];
	return {
		id: def.id, name: def.name, W, H, tiles, dotsInit, dotTotal,
		start: start as [number, number], exit: [dx, dy - 1], home: [dx, slotRow], penSlots,
		tunnelRows, bannerRow: b[1], bonusTile: b, theme: def.theme
	};
}

const cache = new Map<string, Maze>();
function built(def: MazeDef): Maze {
	let m = cache.get(def.id);
	if (!m) cache.set(def.id, (m = buildMaze(def)));
	return m;
}

/** The maze for a level: one maze per level, in order, then round again. Mazes are immutable and shared. */
export function mazeForLevel(level: number): Maze {
	const n = MAZE_DEFS.length;
	return built(MAZE_DEFS[(((Math.max(1, level) - 1) % n) + n) % n]);
}

/** A maze by id; falls back to the first maze for an unknown id (old recordings, typos). */
export function mazeById(id: string): Maze {
	return built(MAZE_DEFS.find((d) => d.id === id) ?? MAZE_DEFS[0]);
}

/** Every maze, in level order. */
export function allMazes(): Maze[] {
	return MAZE_DEFS.map(built);
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
