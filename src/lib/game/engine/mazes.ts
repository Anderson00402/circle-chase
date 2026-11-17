import { DOOR, PATH, PEN, WALL, DIRS, type Maze, type MazeTheme } from '../types';

/**
 * Maze definitions. All five are original designs for this game.
 *
 * Each maze is drawn as text, one string per row:
 *   #  wall          .  dot           o  power dot      ,  open floor without a dot
 *   -  pen door      _  pen floor     S  player start   B  bonus tile (open floor, also the banner row)
 * A row whose edge tiles are open is a tunnel row: it wraps around the left and right edges.
 * The door sits in the top or bottom wall of the pen; the tile outside it is where ghosts leave.
 * The pen's slots and home are worked out from the door (see `buildMaze`). `engine/validate.ts`
 * checks every maze against the genre's rules (symmetric, no dead ends, corridors one tile
 * wide...) and against our own (no two mazes share the classic middle) and runs in the tests.
 */
export interface MazeDef {
	id: string;
	name: string;
	/** One line on the maze's character, for menus and docs. */
	about: string;
	rows: string[];
	theme: MazeTheme;
}

/**
 * Every maze has the look of the first version of the game: neon blue outlines on black, pale
 * blue dots, white power dots. (Mirrored by `BOARD_COLORS` in render/renderer.ts.)
 */
export const ORIGINAL_THEME: MazeTheme = { bg: '#000000', wall: '#1c6cfc', wallGlow: '#1c6cfc', dot: '#b9cdf6', power: '#ffffff' };

export const MAZE_DEFS: MazeDef[] = [
	{
		id: 'plaza',
		name: 'Plaza',
		about: 'Big city blocks and long straights, the pen tucked under the top edge: the calm first board.',
		theme: ORIGINAL_THEME,
		rows: [
			'#########################',
			'#o.....................o#',
			'#.####.###########.####.#',
			'#.####.###_____###.####.#',
			'#.####.###_____###.####.#',
			'#.####.#####-#####.####.#',
			'#.......................#',
			'#.####.#####.#####.####.#',
			'#.####.#####.#####.####.#',
			',.......................,',
			'#.####.##.#####.##.####.#',
			'#.####.##.#####.##.####.#',
			'#.####.##.#####.##.####.#',
			'#...........B...........#',
			'#.######.#######.######.#',
			'#.######.#######.######.#',
			'#.######.#######.######.#',
			'#.......................#',
			'#.####.#####.#####.####.#',
			'#.####.#####.#####.####.#',
			'#o..........S..........o#',
			'#.##########.##########.#',
			'#.##########.##########.#',
			'#.......................#',
			'#########################',
		]
	},
	{
		id: 'rings',
		name: 'Rings',
		about: 'Four loops round a deep pen, joined by a few spokes; easy to get boxed in on the outer ring.',
		theme: ORIGINAL_THEME,
		rows: [
			'#######################',
			'#o.........S.........o#',
			'#.#########.#########.#',
			'#.#.................#.#',
			'#.#.###.#######.###.#.#',
			'#.#.#.............#.#.#',
			'#.#.#.#####.#####.#.#.#',
			',.#.#.#.........#.#.#.,',
			'#.#.#.#.#######.#.#.#.#',
			'#.#.#.#....B....#.#.#.#',
			'#.#.#.#.#######.#.#.#.#',
			'#.#.#.#.#######.#.#.#.#',
			'#.......#######.......#',
			'#.#.#.#.#_____#.#.#.#.#',
			'#.#.#.#.#_____#.#.#.#.#',
			'#.#.#.#.#_____#.#.#.#.#',
			'#.#.#.#.###-###.#.#.#.#',
			',.#.#.#.........#.#.#.,',
			'#.#.#.##.#####.##.#.#.#',
			'#.#.#.............#.#.#',
			'#.#.#######.#######.#.#',
			'#.#.................#.#',
			'#.###.###########.###.#',
			'#o...................o#',
			'#######################',
		]
	},
	{
		id: 'canyon',
		name: 'Canyon',
		about: 'Tall channels with short bridges, a mesa in the middle and the pen sunk low; tunnels high and low.',
		theme: ORIGINAL_THEME,
		rows: [
			'#########################',
			'#o...###.........###...o#',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			',....###....S....###....,',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			'#.##.....###.###.....##.#',
			'#.##.###.###.###.###.##.#',
			'#.##.###.###.###.###.##.#',
			'#....###.........###....#',
			'#.##.###.#######.###.##.#',
			'#.##.###.#######.###.##.#',
			'#B##.....#######.....##,#',
			'#.##.###.#######.###.##.#',
			'#....###.........###....#',
			'#.##.###.###-###.###.##.#',
			'#.##.###.#_____#.###.##.#',
			'#....###.#_____#.###....#',
			'#.##.###.#_____#.###.##.#',
			'#.##.###.#######.###.##.#',
			'#.##.................##.#',
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
		about: 'A tight grid of short lanes with many crossings; the ghosts come out at the top edge.',
		theme: ORIGINAL_THEME,
		rows: [
			'#######################',
			'#o.........,.........o#',
			'#.##.######-######.##.#',
			'#.##.###_______###.##.#',
			'#.##.###_______###.##.#',
			'#.##.#############.##.#',
			'#.....................#',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			',.....................,',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			'#.##...............##.#',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			'#..........B..........#',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			',.......###.###.......,',
			'#.##.##.###.###.##.##.#',
			'#.##.##.###.###.##.##.#',
			'#......S.......,......#',
			'#.#####.###.###.#####.#',
			'#o...................o#',
			'#######################',
		]
	},
	{
		id: 'hedges',
		name: 'Hedges',
		about: 'A garden of long hedges with staggered gaps: straight runs, many T-crossings, tunnels high and low.',
		theme: ORIGINAL_THEME,
		rows: [
			'#######################',
			'#o...................o#',
			'#.##.######.######.##.#',
			'#.##.######.######.##.#',
			',..........B..........,',
			'#.#####.#######.#####.#',
			'#.#####.#######.#####.#',
			'#.....................#',
			'#.###.#####-#####.###.#',
			'#.###.##_______##.###.#',
			'#.....##_______##.....#',
			'#.##.#############.##.#',
			'#.##.#############.##.#',
			'#.....................#',
			'#.##.######.######.##.#',
			'#.##.######.######.##.#',
			'#.....................#',
			'#.#####.#######.#####.#',
			'#.#####.#######.#####.#',
			',..........S..........,',
			'#.##.######.######.##.#',
			'#.##.######.######.##.#',
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
	const isPen = (x: number, y: number) => y >= 0 && y < H && tiles[y * W + x] === PEN;
	// The door opens on one side of the pen (above or below); ghosts leave through the other side.
	const inward = isPen(dx, dy + 1) ? 1 : isPen(dx, dy - 1) ? -1 : 0;
	if (!inward) throw new Error(`maze ${def.id}: the door has no pen above or below it`);
	// Home: the pen tile in the door's column farthest from the door. The two other waiting ghosts
	// sit on the same row, two tiles to each side (one tile in a narrow pen).
	let hy = dy + inward;
	while (isPen(dx, hy + inward)) hy += inward;
	const side = (s: number): [number, number] => (isPen(dx + 2 * s, hy) ? [dx + 2 * s, hy] : [dx + s, hy]);
	const penSlots: [number, number][] = [[dx, hy], side(-1), side(1)];
	const tunnelRows: number[] = [];
	for (let y = 0; y < H; y++) if (tiles[y * W] !== WALL) tunnelRows.push(y);
	const b = bonus as [number, number];
	return {
		id: def.id, name: def.name, W, H, tiles, dotsInit, dotTotal,
		start: start as [number, number], exit: [dx, dy - inward], home: [dx, hy], penSlots,
		tunnelRows, bannerRow: b[1], bonusTile: b, theme: def.theme,
		layout: layoutFingerprint(W, H, tiles)
	};
}

/**
 * A short, stable text for a tile grid: its size plus a 32-bit FNV-1a hash of the tile kinds.
 * Only the walls, paths, pen and door count (not dots, start or colours), because those are what
 * a recorded replay must be drawn on.
 */
export function layoutFingerprint(W: number, H: number, tiles: Uint8Array): string {
	let h = 0x811c9dc5;
	const add = (b: number) => {
		h ^= b & 0xff;
		h = Math.imul(h, 0x01000193);
	};
	add(W);
	add(H);
	for (let i = 0; i < tiles.length; i++) add(tiles[i]);
	return `w${W}h${H}-${(h >>> 0).toString(16).padStart(8, '0')}`;
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
