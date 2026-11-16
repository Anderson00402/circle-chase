import type { Difficulty } from '../types';
import { mazeForLevel } from './mazes';

/**
 * Level table: everything that changes from level to level and between difficulties.
 *
 * Speeds follow the genre's usual ramp: on level 1 the player is clearly faster than the ghosts,
 * from level 5 the ghosts are nearly as fast, and scared ghosts and the tunnels stay slow.
 * Speeds are in tiles per second; `BASE_SPEED` is "100%".
 */
export const BASE_SPEED = 7;

/** Bonus items (our own set). `kind` is what the renderer draws; points rise with the level. */
export interface BonusItem {
	kind: number;
	name: string;
	points: number;
}
export const BONUS_ITEMS: readonly BonusItem[] = [
	{ kind: 0, name: 'Seed', points: 100 },
	{ kind: 1, name: 'Leaf', points: 300 },
	{ kind: 2, name: 'Shell', points: 500 },
	{ kind: 3, name: 'Acorn', points: 700 },
	{ kind: 4, name: 'Star', points: 1000 },
	{ kind: 5, name: 'Crown', points: 2000 },
	{ kind: 6, name: 'Gem', points: 3000 },
	{ kind: 7, name: 'Comet', points: 5000 }
];

export interface DifficultyDef {
	label: string;
	lives: number;
	/** Multiplies every ghost speed except the eyes. */
	ghostScale: number;
	/** Multiplies the arcade power length. */
	powerScale: number;
	/** Multiplies scatter lengths (the calm spells between chases). */
	scatterScale: number;
	/** Multiplies how many dots each waiting ghost lets the player eat before it leaves. */
	releaseScale: number;
	/** Added to the "no dot eaten for a while" release timer. */
	idleBonus: number;
}
export const DIFFICULTY: Record<Difficulty, DifficultyDef> = {
	easy: { label: 'Easy', lives: 5, ghostScale: 0.9, powerScale: 1.5, scatterScale: 1.3, releaseScale: 1.5, idleBonus: 1 },
	normal: { label: 'Normal', lives: 3, ghostScale: 1, powerScale: 1, scatterScale: 1, releaseScale: 1, idleBonus: 0 },
	hard: { label: 'Hard', lives: 3, ghostScale: 1.05, powerScale: 0.7, scatterScale: 0.8, releaseScale: 0.5, idleBonus: -1 }
};

export interface LevelInfo {
	level: number;
	difficulty: Difficulty;
	mazeId: string;
	mazeName: string;
	/** Ready to show: "Level 3 · Circuit". */
	label: string;
	/** Player speed, normally and while a power-up is on. */
	playerSpeed: number;
	playerPowerSpeed: number;
	ghostSpeed: number;
	/** Scared ghosts. Constant for the whole power-up, so speed never hints at the time left. */
	ghostScaredSpeed: number;
	/** Ghosts (not the player) inside a tunnel. */
	ghostTunnelSpeed: number;
	/** Inside the pen and on the way out. */
	ghostPenSpeed: number;
	/** Eaten ghosts heading home. */
	eyesSpeed: number;
	/** Arcade power length in seconds. Study mode ignores it and draws from `frightRange`. */
	powerTime: number;
	/** Alternating scatter / chase lengths in seconds, starting with scatter. Ends with Infinity. */
	waves: number[];
	bonus: BonusItem;
	/** Dots the player may eat while each ghost waits in the pen (hunter, ambusher, guard, drifter). */
	releaseDots: [number, number, number, number];
	/** Seconds without eating a dot after which the next waiting ghost leaves anyway. */
	releaseIdle: number;
	/** After a death one shared count is used: dots eaten since the death at which each ghost leaves. */
	releaseAfterDeath: [number, number, number, number];
	/** Small dots left at which the hunter hurries (a little faster, and chases even in scatter). */
	hurryDots: number;
	/** Hunter speed while hurrying; a second step at half `hurryDots` adds as much again. */
	hurrySpeed: number;
	hurrySpeed2: number;
}

// Shares of BASE_SPEED by level band: player, player with power, ghost, scared ghost, tunnel.
const SPEED_BANDS: { upTo: number; s: [number, number, number, number, number] }[] = [
	{ upTo: 1, s: [0.8, 0.9, 0.75, 0.5, 0.4] },
	{ upTo: 4, s: [0.9, 0.95, 0.85, 0.55, 0.45] },
	{ upTo: 20, s: [1, 1, 0.95, 0.6, 0.5] },
	{ upTo: Infinity, s: [0.9, 0.9, 0.95, 0.6, 0.5] }
];
// Arcade power length on normal, by level; the last value repeats.
const POWER_TIME = [6, 5, 4, 3.5, 3, 5, 3, 3, 2.5, 4.5, 2.5, 2];
const BONUS_BY_LEVEL = [0, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7];
const HURRY_DOTS = [20, 30, 40, 40, 40, 50, 50, 50, 60, 60, 60, 80];

function wavesFor(level: number, scatterScale: number): number[] {
	const w = level === 1 ? [7, 20, 7, 20, 5, 20, 5, Infinity]
		: level <= 4 ? [7, 20, 7, 20, 5, 40, 1, Infinity]
			: [5, 20, 5, 20, 5, 40, 1, Infinity];
	return w.map((s, i) => (i % 2 === 0 && Number.isFinite(s) ? Math.round(s * scatterScale * 10) / 10 : s));
}

const pick = <T>(table: readonly T[], level: number): T => table[Math.min(level, table.length) - 1];

/** Everything the rules need for one level at one difficulty. Pure; cheap enough to call per frame. */
export function levelInfo(level: number, difficulty: Difficulty = 'normal'): LevelInfo {
	level = Math.max(1, Math.floor(level));
	const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
	const maze = mazeForLevel(level);
	const [p, pp, g, gs, gt] = SPEED_BANDS.find((b) => level <= b.upTo)!.s;
	const ghost = (share: number) => share * BASE_SPEED * diff.ghostScale;
	// Release counts were tuned for a ~240-dot board; scale to this maze.
	const dotScale = maze.dotTotal / 240;
	const dots = level === 1 ? [0, 0, 30, 60] : level === 2 ? [0, 0, 0, 50] : [0, 0, 0, 0];
	const hurry = Math.round(pick(HURRY_DOTS, level) * dotScale);
	return {
		level,
		difficulty,
		mazeId: maze.id,
		mazeName: maze.name,
		label: `Level ${level} · ${maze.name}`,
		playerSpeed: p * BASE_SPEED,
		playerPowerSpeed: pp * BASE_SPEED,
		ghostSpeed: ghost(g),
		ghostScaredSpeed: ghost(gs),
		ghostTunnelSpeed: ghost(gt),
		ghostPenSpeed: ghost(0.45),
		eyesSpeed: BASE_SPEED * 1.6,
		powerTime: Math.max(1.5, Math.round(pick(POWER_TIME, level) * diff.powerScale * 10) / 10),
		waves: wavesFor(level, diff.scatterScale),
		bonus: BONUS_ITEMS[pick(BONUS_BY_LEVEL, level)],
		releaseDots: dots.map((n) => Math.round(n * dotScale * diff.releaseScale)) as LevelInfo['releaseDots'],
		releaseIdle: Math.max(2, (level <= 4 ? 4 : 3) + diff.idleBonus),
		releaseAfterDeath: [0, 7, 17, 32].map((n) => Math.round(n * dotScale * diff.releaseScale)) as LevelInfo['releaseAfterDeath'],
		hurryDots: difficulty === 'easy' ? 0 : hurry,
		hurrySpeed: ghost(g + 0.05),
		hurrySpeed2: ghost(g + 0.1)
	};
}
