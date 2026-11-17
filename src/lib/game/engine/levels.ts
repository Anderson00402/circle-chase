import type { Difficulty } from '../types';
import { mazeForLevel } from './mazes';

/**
 * Level table: everything that changes from level to level and between difficulties.
 *
 * Our own tuning. It keeps the genre's shape (the player starts clearly faster than the ghosts and
 * the gap closes over the first levels; scared ghosts and tunnels stay slow; calm spells get
 * shorter and chases longer) but every number comes from a few smooth rules below rather than a
 * table, so there is no level-by-level copy of any other game's settings.
 * Speeds are in tiles per second; `BASE_SPEED` is "100%".
 */
export const BASE_SPEED = 7;

/**
 * Bonus items (our own set, one list shared by the engine and the renderer). `kind` is the drawing
 * in `render/items.ts`; the order is the order they first appear in, with points rising.
 */
export interface BonusItem {
	kind: number;
	name: string;
	points: number;
}
export const BONUS_ITEMS: readonly BonusItem[] = [
	{ kind: 2, name: 'Acorn', points: 150 },
	{ kind: 1, name: 'Mushroom', points: 250 },
	{ kind: 5, name: 'Teacup', points: 400 },
	{ kind: 3, name: 'Lantern', points: 600 },
	{ kind: 4, name: 'Pinwheel', points: 900 },
	{ kind: 6, name: 'Kite', points: 1300 },
	{ kind: 0, name: 'Gem', points: 1800 },
	{ kind: 7, name: 'Rocket', points: 2500 }
];
/** The bonus item drawn as `kind` (falls back to the first). */
export const bonusItem = (kind: number): BonusItem => BONUS_ITEMS.find((b) => b.kind === kind) ?? BONUS_ITEMS[0];

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
	/** Hunter speed while hurrying; a second, faster step at a third of `hurryDots`. */
	hurrySpeed: number;
	hurrySpeed2: number;
}

/** Rises by `step` per level from `from`, never past `to`. */
const ramp = (level: number, from: number, step: number, to: number) => Math.min(to, from + step * (level - 1));

/**
 * Calm spells (scatter) and chases, alternating, starting with a calm spell. Calm spells shrink by
 * a second and a half each wave and a little each level; chases grow by eight seconds each wave and
 * a little each level. After the fourth calm spell the chase never ends.
 */
function wavesFor(level: number, scatterScale: number): number[] {
	const shrink = Math.max(0.55, 1 - 0.08 * (level - 1));
	const out: number[] = [];
	for (let k = 0; k < 4; k++) {
		out.push(Math.round(Math.max(1.5, (8 - 1.5 * k) * shrink) * scatterScale * 10) / 10);
		out.push(k < 3 ? Math.min(60, 15 + 8 * k + 2 * (level - 1)) : Infinity);
	}
	return out;
}

/**
 * Arcade power length on normal: 6.5 s on level 1, about half a second less each level, with a
 * breather on every fourth level: it keeps the previous level's length instead of dropping. So
 * the power never gets longer from one level to the next. Never under 2 s on any difficulty.
 */
export const MIN_POWER_TIME = 2;
function powerTimeFor(level: number, powerScale: number): number {
	const step = level % 4 === 0 ? level - 2 : level - 1;
	const base = Math.max(2.5, 6.5 - 0.45 * step);
	return Math.max(MIN_POWER_TIME, Math.round(base * powerScale * 10) / 10);
}

/** Everything the rules need for one level at one difficulty. Pure; cheap enough to call per frame. */
export function levelInfo(level: number, difficulty: Difficulty = 'normal'): LevelInfo {
	level = Math.max(1, Math.floor(level));
	const diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal;
	const maze = mazeForLevel(level);
	// Shares of BASE_SPEED. The ghosts close the gap over the first six levels; from level 13 they
	// gain a little more while the player stays put.
	const p = ramp(level, 0.83, 0.03, 0.98);
	const g = ramp(level, 0.77, 0.035, 0.94) + (level >= 13 ? 0.02 : 0);
	const scared = ramp(level, 0.52, 0.015, 0.6);
	const ghost = (share: number) => share * BASE_SPEED * diff.ghostScale;
	const dots = maze.dotTotal;
	// Waiting ghosts leave after a share of the board's dots; the shares shrink each level.
	const waitShare = [0, 0.03, 0.11, 0.24].map((s) => Math.max(0, s - 0.035 * (level - 1)));
	// The hunter hurries once this share of the small dots is left (more of the board on later levels).
	const hurryShare = ramp(level, 0.09, 0.012, 0.3);
	return {
		level,
		difficulty,
		mazeId: maze.id,
		mazeName: maze.name,
		label: `Level ${level} · ${maze.name}`,
		playerSpeed: p * BASE_SPEED,
		playerPowerSpeed: Math.min(1, p + 0.06) * BASE_SPEED,
		ghostSpeed: ghost(g),
		ghostScaredSpeed: ghost(scared),
		ghostTunnelSpeed: ghost(g * 0.55),
		ghostPenSpeed: ghost(0.48),
		eyesSpeed: BASE_SPEED * 1.7,
		powerTime: powerTimeFor(level, diff.powerScale),
		waves: wavesFor(level, diff.scatterScale),
		bonus: BONUS_ITEMS[Math.min(level, BONUS_ITEMS.length) - 1],
		releaseDots: waitShare.map((s) => Math.round(s * dots * diff.releaseScale)) as LevelInfo['releaseDots'],
		releaseIdle: Math.max(2, Math.max(2.5, 5 - 0.5 * (level - 1)) + diff.idleBonus),
		releaseAfterDeath: [0, 0.025, 0.06, 0.11].map((s) => Math.round(s * dots * diff.releaseScale)) as LevelInfo['releaseAfterDeath'],
		hurryDots: difficulty === 'easy' ? 0 : Math.round(hurryShare * (dots - 4)),
		hurrySpeed: ghost(g + 0.04),
		hurrySpeed2: ghost(g + 0.07)
	};
}
