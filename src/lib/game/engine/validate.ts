import { DIRS, DOOR, PATH, PEN, WALL, type Maze } from '../types';
import { pathDistances } from './paths';

/**
 * Checks a maze against the genre's conventions and the rules the engine relies on.
 * Returns a list of problems in plain words; an empty list means the maze is fine.
 */
export function checkMaze(m: Maze): string[] {
	const problems: string[] = [];
	const bad = (msg: string) => problems.push(`${m.id}: ${msg}`);
	const { W, H, tiles, dotsInit } = m;
	const at = (x: number, y: number) => (y < 0 || y >= H ? WALL : tiles[y * W + ((x % W) + W) % W]);
	const inside = (x: number, y: number) => x >= 0 && x < W && y >= 0 && y < H;
	const tile = (p: [number, number]) => (inside(p[0], p[1]) ? tiles[p[1] * W + p[0]] : -1);
	const dot = (p: [number, number]) => dotsInit[p[1] * W + p[0]];

	// Size: arcade scale, fits a laptop screen.
	if (W % 2 !== 1) bad(`width ${W} is even; mirrored halves need an odd width`);
	if (W < 21 || W > 25) bad(`width ${W} is outside 21-25`);
	if (H < 23 || H > 27) bad(`height ${H} is outside 23-27`);
	if (tiles.length !== W * H || dotsInit.length !== W * H) bad('tile arrays do not match W*H');

	// Left-right symmetry of walls and pickups.
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W >> 1; x++) {
			const a = y * W + x, b = y * W + (W - 1 - x);
			if (tiles[a] !== tiles[b] || dotsInit[a] !== dotsInit[b]) { bad(`not symmetric at row ${y}`); break; }
		}

	// Outer border: walls everywhere except the tunnel mouths.
	for (let x = 0; x < W; x++) {
		if (tiles[x] !== WALL) bad(`top border open at ${x}`);
		if (tiles[(H - 1) * W + x] !== WALL) bad(`bottom border open at ${x}`);
	}
	const tunnels: number[] = [];
	for (let y = 0; y < H; y++) if (tiles[y * W] !== WALL || tiles[y * W + W - 1] !== WALL) tunnels.push(y);
	if (tunnels.join() !== m.tunnelRows.join()) bad(`tunnelRows ${m.tunnelRows} do not match open edges ${tunnels}`);
	if (tunnels.length < 1 || tunnels.length > 2) bad(`${tunnels.length} tunnel rows; expected 1 or 2`);
	for (const y of tunnels) {
		if (tiles[y * W] !== PATH || tiles[y * W + W - 1] !== PATH) bad(`tunnel row ${y} is not open on both sides`);
		if (at(0, y - 1) !== WALL || at(0, y + 1) !== WALL) bad(`tunnel row ${y} mouth is not a closed tube`);
	}

	// Corridors one tile wide: no 2x2 block of open floor.
	for (let y = 0; y < H - 1; y++)
		for (let x = 0; x < W - 1; x++)
			if (at(x, y) === PATH && at(x + 1, y) === PATH && at(x, y + 1) === PATH && at(x + 1, y + 1) === PATH)
				bad(`open 2x2 area at ${x},${y}`);

	// No dead ends: every open tile has at least two open neighbours (tunnels wrap).
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			if (at(x, y) !== PATH) continue;
			let n = 0;
			for (const d of DIRS) if (at(x + d.x, y + d.y) === PATH) n++;
			if (n < 2) bad(`dead end at ${x},${y}`);
		}

	// Start and bonus tile: on open floor, not on a dot.
	if (tile(m.start) !== PATH) bad('start is not on open floor');
	else if (dot(m.start)) bad('start is on a dot');
	if (m.start[1] < H / 2) bad('start is not in the lower half');
	if (tile(m.bonusTile) !== PATH) bad('bonus tile is not on open floor');
	else if (dot(m.bonusTile)) bad('bonus tile is on a dot');

	// Every open tile, so every dot, is reachable from the start.
	const dist = pathDistances(m, m.start);
	for (let i = 0; i < W * H; i++)
		if (tiles[i] === PATH && dist[i] < 0) bad(`tile ${i % W},${(i / W) | 0} cannot be reached from the start`);
	for (let i = 0; i < W * H; i++) if (dotsInit[i] && tiles[i] !== PATH) bad(`pickup on a non-floor tile at ${i % W},${(i / W) | 0}`);

	// Pen: door in the middle column, exit right above it, home and slots inside, sealed otherwise.
	const [ex, ey] = m.exit;
	if (tile(m.exit) !== PATH) bad('exit is not on open floor');
	if (at(ex, ey + 1) !== DOOR) bad('exit is not directly above the door');
	if (ex !== (W - 1) / 2) bad('door is not in the middle column');
	if (tile(m.home) !== PEN) bad('home is not a pen tile');
	if (m.penSlots.length < 3) bad('fewer than three pen slots');
	for (const s of m.penSlots) if (tile(s) !== PEN) bad(`pen slot ${s} is not a pen tile`);
	if (m.bonusTile[1] <= m.home[1]) bad('bonus tile is not below the pen');
	let doors = 0;
	for (let y = 0; y < H; y++)
		for (let x = 0; x < W; x++) {
			const t = at(x, y);
			if (t === DOOR) doors++;
			if (t !== PEN && t !== DOOR) continue;
			for (const d of DIRS) {
				const n = at(x + d.x, y + d.y);
				const ok = n === WALL || n === PEN || n === DOOR || (t === DOOR && x + d.x === ex && y + d.y === ey);
				if (!ok) bad(`pen leaks at ${x},${y}`);
			}
		}
	if (doors !== 1) bad(`${doors} door tiles; expected 1`);
	const ghostDist = pathDistancesThroughPen(m, m.exit);
	for (let i = 0; i < W * H; i++) if (tiles[i] === PEN && ghostDist[i] < 0) bad(`pen tile ${i % W},${(i / W) | 0} is cut off`);

	// Pickups: four power dots, one per quarter of the board; a sensible number of dots.
	const powers: [number, number][] = [];
	for (let i = 0; i < W * H; i++) if (dotsInit[i] === 2) powers.push([i % W, (i / W) | 0]);
	if (powers.length !== 4) bad(`${powers.length} power dots; expected 4`);
	const quarters = new Set(powers.map(([x, y]) => (x < W / 2 ? 0 : 1) + (y < H / 2 ? 0 : 2)));
	if (quarters.size !== 4) bad('power dots are not spread over the four quarters');
	let count = 0;
	for (let i = 0; i < W * H; i++) if (dotsInit[i]) count++;
	if (count !== m.dotTotal) bad(`dotTotal ${m.dotTotal} does not match ${count} pickups`);
	if (m.dotTotal < 150 || m.dotTotal > 320) bad(`${m.dotTotal} pickups; expected 150-320`);
	for (const y of m.tunnelRows) if (dotsInit[y * W] || dotsInit[y * W + W - 1]) bad(`dots inside tunnel ${y}`);

	if (m.bannerRow < 0 || m.bannerRow >= H) bad('banner row is off the board');
	return problems;
}

function pathDistancesThroughPen(m: Maze, [sx, sy]: [number, number]): Int16Array {
	const dist = new Int16Array(m.W * m.H).fill(-1);
	const queue = [sy * m.W + sx];
	dist[queue[0]] = 0;
	for (let q = 0; q < queue.length; q++) {
		const x = queue[q] % m.W, y = (queue[q] / m.W) | 0;
		for (const d of DIRS) {
			const nx = (x + d.x + m.W) % m.W, ny = y + d.y;
			if (ny < 0 || ny >= m.H) continue;
			const i = ny * m.W + nx;
			if (m.tiles[i] === WALL || dist[i] >= 0) continue;
			dist[i] = dist[queue[q]] + 1;
			queue.push(i);
		}
	}
	return dist;
}

/** Text picture of a maze for debugging and test failure messages. */
export function drawMaze(m: Maze): string {
	const ch = (i: number) => {
		const t = m.tiles[i];
		if (t === WALL) return '#';
		if (t === DOOR) return '-';
		if (t === PEN) return '_';
		return m.dotsInit[i] === 2 ? 'o' : m.dotsInit[i] ? '.' : ' ';
	};
	const rows: string[] = [];
	for (let y = 0; y < m.H; y++) {
		let r = '';
		for (let x = 0; x < m.W; x++) r += x === m.start[0] && y === m.start[1] ? 'S' : x === m.bonusTile[0] && y === m.bonusTile[1] ? 'B' : ch(y * m.W + x);
		rows.push(r);
	}
	return rows.join('\n');
}
