/**
 * Shared contracts for Circle Chase.
 *
 * Three layers talk only through these types:
 *   engine   -> produces a `Frame` (a plain snapshot of everything on the board)
 *   renderer -> draws a `Scene` (maze + dots + frame) with one countdown `Cue` plugged in
 *   telemetry / replays -> read and store `Frame`s; a replay is just recorded scenes drawn again
 *
 * Because the renderer and every cue are pure functions of a Scene, a replay shows exactly what
 * the player saw, and scrubbing backwards works. Keep it that way: no cue may depend on state it
 * accumulated from earlier frames.
 */

// ---------- directions and tiles ----------
/** 0 up, 1 left, 2 down, 3 right, -1 none. `(d + 2) % 4` is the reverse. */
export type Dir = -1 | 0 | 1 | 2 | 3;
export type Facing = 0 | 1 | 2 | 3;
export const DIRS: readonly { x: number; y: number }[] = [
	{ x: 0, y: -1 },
	{ x: -1, y: 0 },
	{ x: 0, y: 1 },
	{ x: 1, y: 0 }
];
export const PATH = 0, WALL = 1, DOOR = 2, PEN = 3;
export type TileKind = 0 | 1 | 2 | 3;

// ---------- maze ----------
/** Colours of one maze. Every maze brings its own so levels look different. */
export interface MazeTheme {
	bg: string;
	wall: string;
	wallGlow: string;
	dot: string;
	power: string;
}

export interface Maze {
	id: string;
	name: string;
	W: number;
	H: number;
	/** W*H tile kinds (PATH, WALL, DOOR, PEN), row-major. */
	tiles: Uint8Array;
	/** W*H starting pickups: 0 none, 1 dot, 2 power dot. Never mutated; the game keeps its own copy. */
	dotsInit: Uint8Array;
	dotTotal: number;
	start: [number, number];
	/** Tile just outside the pen door, where ghosts become active. */
	exit: [number, number];
	/** Tile inside the pen that eaten ghosts return to. */
	home: [number, number];
	penSlots: [number, number][];
	/** Rows that wrap around the left and right edges. */
	tunnelRows: number[];
	/** Row for the READY / LEVEL banner. */
	bannerRow: number;
	/** Where the bonus item appears. */
	bonusTile: [number, number];
	theme: MazeTheme;
}

// ---------- actors ----------
export type GhostId = 'hunter' | 'ambusher' | 'guard' | 'drifter';
export const GHOST_IDS: readonly GhostId[] = ['hunter', 'ambusher', 'guard', 'drifter'];
/** waiting: in the pen. leaving: walking out. active: on the board. returning: eaten, eyes heading home. */
export type GhostMode = 'waiting' | 'leaving' | 'active' | 'returning';

export interface GhostView {
	id: GhostId;
	/** Position in tiles, fractional while moving. May be just outside 0..W-1 in a tunnel; wrap when drawing. */
	x: number;
	y: number;
	dir: Dir;
	mode: GhostMode;
	/** True while the power-up makes this ghost edible. */
	scared: boolean;
	/** Game time this ghost last turned dangerous again because the power ran out; -1 if never. */
	revertedAt: number;
	/** Game time this ghost was last eaten; -1 if never. */
	eatenAt: number;
}

export interface PlayerView {
	x: number;
	y: number;
	dir: Dir;
	face: Facing;
	moving: boolean;
}

// ---------- power-up ----------
export type PowerEndReason = 'expired' | 'died' | 'cleared' | 'refreshed';

export interface PowerView {
	/** Seconds of power left; 0 when no power-up is active. */
	left: number;
	/** Length of the current (or most recent) power-up in seconds. */
	total: number;
	/** Game time the current (or most recent) power-up started; -1 if none yet. */
	startedAt: number;
	/** Game time the most recent power-up ended; -1 if none has ended. */
	endedAt: number;
	endReason: PowerEndReason | null;
	/** Ghosts eaten in this power-up so far. */
	chain: number;
	/** Counts power-ups since the game was created (1, 2, 3...). 0 before the first. */
	serial: number;
}

// ---------- events ----------
/** Things that happened since the previous frame. `t` is game time. */
export type GameEvent = { t: number } & (
	| { type: 'dot'; x: number; y: number }
	| { type: 'power'; x: number; y: number; total: number }
	| { type: 'eat'; ghost: GhostId; points: number; x: number; y: number; left: number }
	| { type: 'powerEnd'; reason: PowerEndReason }
	| { type: 'powerRespawn'; x: number; y: number }
	| { type: 'die'; by: GhostId }
	| { type: 'bonusShow'; x: number; y: number; kind: number }
	| { type: 'bonus'; points: number; x: number; y: number }
	| { type: 'mode'; mode: 'scatter' | 'chase' }
	| { type: 'clear' }
	| { type: 'level'; level: number }
	| { type: 'extra' }
	| { type: 'over' }
);
export type GameEventType = GameEvent['type'];

// ---------- frame ----------
export type Phase = 'ready' | 'playing' | 'dying' | 'clear' | 'over';

export interface Popup {
	x: number;
	y: number;
	text: string;
	age: number;
}

export interface BonusView {
	kind: number;
	x: number;
	y: number;
	/** Seconds until it disappears. */
	left: number;
}

/** One snapshot of the board. Plain data: safe to store, send and draw later. */
export interface Frame {
	/** Game time in seconds. Stops while paused and during the short freeze after eating a ghost. */
	t: number;
	phase: Phase;
	/** Seconds since the phase began. */
	phaseTime: number;
	level: number;
	mazeId: string;
	score: number;
	lives: number;
	dotsLeft: number;
	player: PlayerView;
	ghosts: GhostView[];
	power: PowerView;
	bonus: BonusView | null;
	popups: Popup[];
	events: GameEvent[];
}

/** Everything the renderer needs to draw one moment. */
export interface Scene {
	maze: Maze;
	/** Current pickups, same layout as `Maze.dotsInit`. */
	dots: Uint8Array;
	frame: Frame;
}

// ---------- game ----------
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface GameConfig {
	/**
	 * arcade: the normal game. study: tuned for collecting power-up trials (see fields below).
	 * The mode itself changes nothing; it is recorded with the data.
	 */
	mode: 'arcade' | 'study';
	difficulty: Difficulty;
	/** Seed for the game's random numbers. Same seed and inputs give the same game. */
	seed: number;
	startLevel: number;
	/**
	 * Power-up length in seconds, drawn uniformly from [min, max] for every power dot. When null the
	 * difficulty table decides (fixed length, shorter each level). Study mode sets a range so players
	 * cannot learn the length by heart and must read the cue.
	 */
	frightRange: [number, number] | null;
	/** Seconds after which an eaten power dot grows back; 0 = never. */
	powerRespawn: number;
	/** Deaths are still counted and animated, but the game never ends. */
	infiniteLives: boolean;
}

export interface Game {
	readonly config: GameConfig;
	/** Current maze. Replaced when the level changes. */
	readonly maze: Maze;
	/** Current pickups. Replaced when the level changes. */
	readonly dots: Uint8Array;
	/** Ask to turn; remembered for a moment so early key presses still count. */
	steer(dir: Facing): void;
	/** Advance by `dt` seconds. Call with a fixed step (1/120). */
	update(dt: number): void;
	/** Snapshot of the board. Also hands over, and clears, the events since the last call. */
	frame(): Frame;
	/** Convenience: `{ maze, dots, frame: frame() }`. */
	scene(): Scene;
	/** Where a ghost is heading right now (for the debug overlay and the bot). */
	targetOf(id: GhostId): [number, number];
	/** Total deaths, including those forgiven by `infiniteLives`. */
	readonly deaths: number;
}

// ---------- sound ----------
export interface ToneOptions {
	type?: OscillatorType;
	vol?: number;
	/** Glide to this frequency over the tone's length. */
	to?: number;
	delay?: number;
}
/** Tiny synth every sound in the game goes through. All calls are no-ops while sound is off. */
export interface Sfx {
	tone(freq: number, dur: number, opts?: ToneOptions): void;
	/** Burst of filtered noise (thumps, puffs, crackle). */
	noise(dur: number, opts?: { vol?: number; freq?: number; q?: number; delay?: number }): void;
}

// ---------- countdown cues ----------
export type CueId =
	| 'none'
	| 'classic-blink'
	| 'timer-bar'
	| 'ink-refill'
	| 'clock-halos'
	| 'burning-fuse'
	| 'wall-tide'
	| 'heartbeat'
	| 'waking-ghosts'
	| 'pen-hourglass'
	| 'deflating-player'
	| 'final-count'
	| 'dot-sweep';

/** Where on screen a cue puts its information; used to group cues in the analysis. */
export type CueChannel = 'hud' | 'ghosts' | 'player' | 'maze' | 'screen';

export type GhostLook = 'normal' | 'scared' | 'scared-flash' | 'eyes';

/** What a cue gets every time it draws. */
export interface CueContext {
	/** 2D context, already scaled so one unit is one CSS pixel. Leave its state as you found it. */
	ctx: CanvasRenderingContext2D;
	/** Tile size in CSS pixels. */
	T: number;
	/** Device pixel ratio (shadowBlur ignores the transform, so multiply blur by this). */
	dpr: number;
	scene: Scene;
	frame: Frame;
	maze: Maze;
	/** Game time, same as `frame.t`. Drive every animation from this. */
	now: number;
	power: {
		active: boolean;
		left: number;
		total: number;
		/** 1 at the start of the power-up, 0 when it runs out. */
		frac: number;
		/** Seconds since the power-up started. */
		elapsed: number;
		/** Seconds since the last power-up ran out by itself (`endReason === 'expired'`); Infinity otherwise. */
		sinceExpired: number;
	};
	reduceMotion: boolean;
	colors: Palette;
	/** Centre of a tile position in CSS pixels. */
	px(x: number, y: number): [number, number];
	/** Calls `fn` once per visible copy of something at tile column `x` (twice in a tunnel). */
	eachWrap(x: number, fn: (cx: number) => void): void;
	/** True during the default "about to end" blink: the last 2 s, five blinks, ending with the power. */
	baseFlash(): boolean;
	/** Default drawings, for cues that decorate rather than replace. */
	drawGhost(g: GhostView, index: number, look: GhostLook, cx: number, cy: number): void;
	/** Traces the ghost's body outline as the current path at (cx, cy) and returns the y of its head centre. */
	ghostPath(g: GhostView, index: number, cx: number, cy: number): number;
	drawPlayer(cx: number, cy: number, scale?: number): void;
	/** Cached picture of the maze walls in one colour (full board, device pixels). */
	wallLayer(color: string, glow?: string): CanvasImageSource;
}

export interface Palette {
	bg: string;
	wall: string;
	wallGlow: string;
	dot: string;
	power: string;
	player: string;
	scared: string;
	scaredFill: string;
	ink: string;
	inkDim: string;
	accent: string;
	ghost: Record<GhostId, string>;
}

/**
 * A way of telling the player how much power is left. All hooks are optional and must be pure
 * functions of the context (see the note at the top of this file).
 */
export interface Cue {
	id: CueId;
	/**
	 * reference: the two yardsticks (no signal at all, and the genre's usual ghost blink).
	 * baseline: the timer bar. idea: the ten alternatives.
	 */
	role: 'reference' | 'baseline' | 'idea';
	/** Short label for lists and charts: "A", "B" for the references, "0" for the timer bar, "1"-"10" for the ideas. */
	code: string;
	name: string;
	/** One short sentence shown in lists. */
	tagline: string;
	/** What the player sees from start to end, two or three sentences. */
	description: string;
	channel: CueChannel;
	/**
	 * Keep the default white blink on scared ghosts in the last 2 s. Only `classic-blink` sets this:
	 * every other cue must carry the message by itself, so the study compares one signal at a time.
	 */
	baseFlash: boolean;

	/** Drawn right after the maze walls (tint walls, burn fuses...). */
	walls?(k: CueContext): void;
	/** Replace how pickups are drawn. Call `drawDefault()` to keep the normal dots. */
	dots?(k: CueContext, drawDefault: () => void): void;
	/** Above maze and dots, below ghosts and player. */
	under?(k: CueContext): void;
	/** Replace or decorate one ghost. Call `drawDefault()` for the normal drawing. Only called for visible ghosts. */
	ghost?(k: CueContext, g: GhostView, index: number, cx: number, cy: number, drawDefault: () => void): void;
	/** Replace or decorate the player. */
	player?(k: CueContext, cx: number, cy: number, drawDefault: () => void): void;
	/** Above everything on the board. */
	over?(k: CueContext): void;
	/**
	 * Sounds. Called once per live frame while playing, with the previous frame, so a cue can fire
	 * a sound when a threshold is crossed (`prev.power.left > 3 && frame.power.left <= 3`).
	 */
	sound?(prev: Frame, frame: Frame, sfx: Sfx): void;
}
