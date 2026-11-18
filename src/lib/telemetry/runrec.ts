/**
 * Full-run recording: every run (block) is kept from start to end, next to the per-power-up clips
 * (recorder.ts), so it can be replayed whole (/replays/run/<blockKey>).
 *
 * How it is stored (docs/STUDY.md "Full-run recordings", convex/runRecordings.ts):
 * - Scenes are kept at 10 Hz of game time with the same quantisation as the clips (times in
 *   hundredths of a second, positions in 64ths of a tile, enums as small integers).
 * - They are cut into **chunks of about 5 s of game time** (`CHUNK_SECONDS`). A paused game writes
 *   nothing. Each chunk is sent once, as soon as it is complete, and never rewritten; its key is
 *   the block key plus its index (0, 1, 2...), so sending it twice is harmless.
 * - A chunk holds: the pickups left at its first scene as a bitset over the maze's pickup tiles,
 *   every change of a pickup after that (eaten, or a power dot coming back) with its exact time,
 *   one column per frame field (delta encoded, then run-length encoded, so a value that does not
 *   change, or changes by the same step, costs almost nothing), every steer input, every game event
 *   but `dot` (the pickup changes say the same), popups, and notes (pauses with their wall-clock
 *   length and reason, view toggles, trials stored).
 * - Times: a chunk is played on one game (`frame.t` starts at 0 for every page and every new
 *   game). `base` turns game time into **run time**: run time = base + game time, continuous over
 *   a refresh (the next page starts where the last chunk ended) and over a new game.
 *
 * `createRunRecorder` is fed every live scene (like the clip recorder); `decodeChunk` gives back
 * scenes in run time that the renderer and `sceneAt` (src/lib/replay/interp.ts) use as they are.
 * Pure: no DOM, no Convex.
 */
import { mazeById, mazeForLevel } from '../game/engine/mazes';
import { GHOST_IDS, type Facing, type Frame, type GameEvent, type Maze, type Scene } from '../game/types';
import { Reader, Writer } from '#convex/lib/pack.ts';
import { MODES, PHASES, REASONS, roundEvent } from './recorder';

export const RUN_HZ = 10;
/** Game seconds per chunk. */
export const CHUNK_SECONDS = 5;
const VERSION = 1;
const POS = 64;
const CS = 100;

/** A note in the recording: what happened outside the board. */
export type RunMark =
	/** The game was paused (no frames) for `wall` seconds of wall-clock time: P/Escape, the window losing focus, a hidden tab. */
	| { k: 'pause'; t: number; wall: number; why: 'key' | 'blur' | 'hidden' | 'unknown' }
	/** The researcher switched between participant view and the researcher's view. */
	| { k: 'view'; t: number; view: 'participant' | 'researcher' }
	/** A trial was measured and stored (its key), with its game times. */
	| { k: 'trial'; t: number; key: string; s: number; e: number }
	/** A new game started on the same page (game time starts again). */
	| { k: 'game'; t: number }
	/** The page started recording into this run (first page, or after a refresh). */
	| { k: 'page'; t: number };

/** One stored chunk, as sent to `runRecordings.saveChunk`. */
export interface RunChunk {
	blockKey: string;
	/** Index in the run: 0, 1, 2... */
	i: number;
	/** Run time of game time 0 for this chunk's game (s). */
	base: number;
	/** Run time of the first and last scene (s). */
	t0: number;
	t1: number;
	/** Wall-clock time (ms) of the first and last scene. */
	at: number;
	end: number;
	mazeId: string;
	layout?: string;
	/** Keys of trials stored during this chunk (lets the player place a trial on the run's timeline without decoding). */
	trials?: string[];
	data: ArrayBuffer;
}

export interface DecodedChunk {
	i: number;
	base: number;
	/** Scenes in run time (every absolute time shifted by `base`). */
	scenes: Scene[];
	/** Every game event in run time, the `dot` events rebuilt from the pickup changes. */
	events: GameEvent[];
	/** Steer inputs in run time (a repeat of the same direction is not kept). */
	inputs: { t: number; dir: Facing }[];
	marks: RunMark[];
	/** Pickups at the first scene and every change after it (run time). */
	dots0: Uint8Array;
	changes: { t: number; tile: number; v: number }[];
	maze: Maze;
}

// ---------- run-length delta columns ----------

/** Deltas, then (delta, repeat) pairs: a constant column costs 2 bytes, a steady slope 3. */
function rle(w: Writer, values: ArrayLike<number>) {
	let prev = 0, cur: number | null = null, run = 0;
	const pairs: number[] = [];
	for (let i = 0; i < values.length; i++) {
		const d = values[i] - prev;
		prev = values[i];
		if (d === cur) { run++; continue; }
		if (cur !== null) pairs.push(cur, run);
		cur = d; run = 1;
	}
	if (cur !== null) pairs.push(cur, run);
	w.int(pairs.length / 2);
	for (let k = 0; k < pairs.length; k++) w.int(pairs[k]);
}
function unrle(r: Reader, n: number): number[] {
	const out = new Array<number>(n);
	const runs = r.int();
	let prev = 0, k = 0;
	for (let j = 0; j < runs; j++) {
		const d = r.int(), run = r.int();
		for (let m = 0; m < run && k < n; m++) out[k++] = prev += d;
	}
	while (k < n) out[k++] = prev;
	return out;
}

// ---------- pickups: a bitset over the maze's pickup tiles ----------

/** Bits over the tiles that hold a pickup at the start (`dotsInit`), set while it is still there. */
function packDots(w: Writer, dots: Uint8Array, maze: Maze) {
	const init = maze.dotsInit;
	let fits = init.length === dots.length;
	if (fits) for (let i = 0; i < dots.length; i++) if (dots[i] && dots[i] !== init[i]) { fits = false; break; }
	if (!fits) { w.int(1); w.bytes(dots); return; } // never expected: keep the raw bytes
	w.int(0);
	const bits: number[] = [];
	let byte = 0, k = 0;
	for (let i = 0; i < init.length; i++) {
		if (!init[i]) continue;
		if (dots[i]) byte |= 1 << (k & 7);
		if ((++k & 7) === 0) { bits.push(byte); byte = 0; }
	}
	if (k & 7) bits.push(byte);
	w.bytes(Uint8Array.from(bits));
}
function unpackDots(r: Reader, maze: Maze): Uint8Array {
	if (r.int() === 1) return r.bytes();
	const bits = r.bytes(), init = maze.dotsInit;
	const out = new Uint8Array(init.length);
	let k = 0;
	for (let i = 0; i < init.length; i++) {
		if (!init[i]) continue;
		if (bits[k >> 3] & (1 << (k & 7))) out[i] = init[i];
		k++;
	}
	return out;
}

// ---------- frame fields ----------

const cs = (v: number) => Math.round(v * CS);
const ocs = (v: number) => (v < 0 ? -1 : Math.round(v * CS));
const q = (v: number) => Math.round(v * POS);
type Get = (f: Frame) => number;

function frameColumns(G: number): Get[] {
	const cols: Get[] = [
		(f) => cs(f.t), (f) => PHASES.indexOf(f.phase), (f) => cs(f.phaseTime), (f) => f.level, (f) => f.score, (f) => f.lives, (f) => f.dotsLeft,
		(f) => q(f.player.x), (f) => q(f.player.y), (f) => f.player.dir, (f) => f.player.face, (f) => (f.player.moving ? 1 : 0)
	];
	for (let g = 0; g < G; g++) {
		cols.push(
			(f) => GHOST_IDS.indexOf(f.ghosts[g].id), (f) => q(f.ghosts[g].x), (f) => q(f.ghosts[g].y), (f) => f.ghosts[g].dir,
			(f) => MODES.indexOf(f.ghosts[g].mode), (f) => (f.ghosts[g].scared ? 1 : 0), (f) => ocs(f.ghosts[g].revertedAt), (f) => ocs(f.ghosts[g].eatenAt)
		);
	}
	cols.push(
		(f) => cs(f.power.left), (f) => Math.round(f.power.total * 1000), (f) => ocs(f.power.startedAt), (f) => ocs(f.power.endedAt),
		(f) => (f.power.endReason ? REASONS.indexOf(f.power.endReason) : -1), (f) => f.power.chain, (f) => f.power.serial,
		(f) => (f.bonus ? f.bonus.kind : -1), (f) => (f.bonus ? f.bonus.x : 0), (f) => (f.bonus ? f.bonus.y : 0), (f) => (f.bonus ? cs(f.bonus.left) : 0)
	);
	return cols;
}

interface Open {
	frames: Frame[];
	dots0: Uint8Array;
	maze: Maze;
	changes: number[]; // cs, tile, value
	events: [number, GameEvent][];
	inputs: number[]; // cs, dir
	marks: RunMark[];
	trials: string[];
	at: number;
	end: number;
}

/** Packs one chunk's content (pure; exported for tests and the simulator). */
export function encodeChunk(c: Open, base: number): ArrayBuffer {
	const n = c.frames.length, G = c.frames[0].ghosts.length;
	const w = new Writer();
	w.int(VERSION);
	w.int(n);
	w.int(G);
	w.int(Math.round(base * 1000));
	packDots(w, c.dots0, c.maze);
	for (const get of frameColumns(G)) rle(w, c.frames.map(get));
	const nc = c.changes.length / 3;
	w.int(nc);
	w.column(c.changes.filter((_, i) => i % 3 === 0));
	w.column(c.changes.filter((_, i) => i % 3 === 1));
	w.column(c.changes.filter((_, i) => i % 3 === 2));
	const ni = c.inputs.length / 2;
	w.int(ni);
	w.column(c.inputs.filter((_, i) => i % 2 === 0));
	w.column(c.inputs.filter((_, i) => i % 2 === 1));
	const popups: [number, number, number, string, number][] = [];
	c.frames.forEach((f, s) => { for (const p of f.popups) popups.push([s, q(p.x), q(p.y), p.text, cs(p.age)]); });
	const extra: Record<string, unknown> = {};
	if (c.events.length) extra.e = c.events;
	if (popups.length) extra.p = popups;
	if (c.marks.length) extra.m = c.marks;
	w.text(Object.keys(extra).length ? JSON.stringify(extra) : '');
	return w.finish();
}

/** Shift every absolute game time of a frame into run time. */
const shift = (x: number, base: number) => (x < 0 ? x : +(x + base).toFixed(3));

/** Unpacks one chunk into scenes and everything else, in run time. */
export function decodeChunk(chunk: Pick<RunChunk, 'i' | 'mazeId' | 'data'>): DecodedChunk {
	const r = new Reader(chunk.data);
	const v = r.int();
	if (v !== VERSION) throw new Error(`unknown run chunk version ${v}`);
	const n = r.int(), G = r.int();
	const base = r.int() / 1000;
	const maze0 = mazeById(chunk.mazeId);
	const dots0 = unpackDots(r, maze0);
	const cols = frameColumns(G).map(() => unrle(r, n));
	const nc = r.int();
	const cT = r.column(nc), cTile = r.column(nc), cVal = r.column(nc);
	const ni = r.int();
	const iT = r.column(ni), iDir = r.column(ni);
	const text = r.text();
	const extra = (text ? JSON.parse(text) : {}) as { e?: [number, GameEvent][]; p?: [number, number, number, string, number][]; m?: RunMark[] };
	const evs = extra.e ?? [], pops = extra.p ?? [];

	const time = (x: number) => x / CS;
	const otime = (x: number) => (x < 0 ? -1 : x / CS);
	let c = 0;
	const col = () => cols[c++];
	const t = col(), phase = col(), phaseTime = col(), level = col(), score = col(), lives = col(), dotsLeft = col();
	const px = col(), py = col(), pdir = col(), pface = col(), pmoving = col();
	const gh: number[][][] = [];
	for (let g = 0; g < G; g++) gh.push([col(), col(), col(), col(), col(), col(), col(), col()]);
	const left = col(), total = col(), startedAt = col(), endedAt = col(), reason = col(), chain = col(), serial = col();
	const bkind = col(), bx = col(), by = col(), bleft = col();

	const scenes: Scene[] = [];
	let dots = dots0, ci = 0, ei = 0;
	const level0 = level[0];
	for (let s = 0; s < n; s++) {
		// Pickup changes up to this scene's time.
		if (ci < nc && cT[ci] <= t[s]) {
			dots = dots.slice();
			while (ci < nc && cT[ci] <= t[s]) { dots[cTile[ci]] = cVal[ci]; ci++; }
		}
		// Events up to this scene (those after the last scene go on the last one).
		const events: GameEvent[] = [];
		while (ei < evs.length && (evs[ei][0] <= t[s] || s === n - 1)) { events.push({ ...evs[ei][1], t: +(evs[ei][0] / CS + base).toFixed(3) } as GameEvent); ei++; }
		const frame: Frame = {
			t: +(time(t[s]) + base).toFixed(3), phase: PHASES[phase[s]] ?? 'playing', phaseTime: time(phaseTime[s]), level: level[s],
			mazeId: chunk.mazeId, score: score[s], lives: lives[s], dotsLeft: dotsLeft[s],
			player: { x: px[s] / POS, y: py[s] / POS, dir: pdir[s] as Frame['player']['dir'], face: pface[s] as Frame['player']['face'], moving: pmoving[s] === 1 },
			ghosts: gh.map((g) => ({
				id: GHOST_IDS[g[0][s]], x: g[1][s] / POS, y: g[2][s] / POS, dir: g[3][s] as Frame['player']['dir'],
				mode: MODES[g[4][s]], scared: g[5][s] === 1, revertedAt: shift(otime(g[6][s]), base), eatenAt: shift(otime(g[7][s]), base)
			})),
			power: {
				left: time(left[s]), total: total[s] / 1000, startedAt: shift(otime(startedAt[s]), base), endedAt: shift(otime(endedAt[s]), base),
				endReason: reason[s] < 0 ? null : REASONS[reason[s]], chain: chain[s], serial: serial[s]
			},
			bonus: bkind[s] < 0 ? null : { kind: bkind[s], x: bx[s], y: by[s], left: time(bleft[s]) },
			popups: pops.filter(([i]) => i === s).map(([, x, y, text, age]) => ({ x: x / POS, y: y / POS, text, age: age / CS })),
			events
		};
		const maze = level[s] === level0 ? maze0 : mazeForLevel(level[s]);
		scenes.push({ maze, dots, frame });
	}
	const changes = Array.from({ length: nc }, (_, k) => ({ t: +(cT[k] / CS + base).toFixed(3), tile: cTile[k], v: cVal[k] }));
	// Every event, with the `dot` events rebuilt from the pickups eaten.
	const events: GameEvent[] = evs.map(([tt, e]) => ({ ...e, t: +(tt / CS + base).toFixed(3) } as GameEvent));
	for (const ch of changes) {
		if (ch.v === 0 && maze0.dotsInit[ch.tile] === 1) events.push({ type: 'dot', t: ch.t, x: ch.tile % maze0.W, y: Math.floor(ch.tile / maze0.W) });
	}
	events.sort((a, b) => a.t - b.t);
	return {
		i: chunk.i, base, scenes, events, dots0, changes, maze: maze0,
		inputs: Array.from({ length: ni }, (_, k) => ({ t: +(iT[k] / CS + base).toFixed(3), dir: iDir[k] as Facing })),
		marks: (extra.m ?? []).map((m) => ({ ...m, t: +(m.t + base).toFixed(3) }))
	};
}

/**
 * The pickups on the board at run time `t` within a decoded chunk (exact, not on the 10 Hz grid).
 * Change times are kept to the hundredth of a second, frames are 1/60 s apart: half a hundredth
 * of slack takes a change at the frame it happened on and never one of the next frame.
 */
export function dotsAt(c: Pick<DecodedChunk, 'dots0' | 'changes'>, t: number): Uint8Array {
	const d = c.dots0.slice();
	for (const ch of c.changes) { if (ch.t > t + 0.005 + 1e-9) break; d[ch.tile] = ch.v; }
	return d;
}

// ---------- the recorder ----------

export interface RunRecorderOptions {
	blockKey: string;
	/** Index of the first chunk this page writes (a refreshed run continues the numbering). */
	firstIndex?: number;
	/** Run time this page starts at (where the previous page's recording ended). */
	startAt?: number;
	/** Called with every finished chunk, once. */
	onChunk: (c: RunChunk) => void;
	chunkSeconds?: number;
	/** Wall clock (ms); tests pass their own. */
	now?: () => number;
}

export interface RunRecorder {
	/** Feed every live scene. */
	push(scene: Scene): void;
	/** A steer input (repeats of the same direction are dropped). */
	input(dir: Facing): void;
	/** A note at the latest game time. */
	mark(m: DistributiveOmit<RunMark, 't'>): void;
	/** A new game on this page: its game time starts again at 0. */
	newGame(): void;
	/** Send what has been kept so far as a (short) chunk. Returns it, or null when there was nothing. */
	flush(): RunChunk | null;
	/** Index of the next chunk. */
	readonly next: number;
	/** Run time of the latest frame. */
	readonly runTime: number;
	/** A chunk is open with at least one scene. */
	readonly open: boolean;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function createRunRecorder(o: RunRecorderOptions): RunRecorder {
	const span = o.chunkSeconds ?? CHUNK_SECONDS;
	const now = o.now ?? (() => Date.now());
	let next = o.firstIndex ?? 0;
	/** Run time of this game's time 0. */
	let base = o.startAt ?? 0;
	let cur: Open | null = null;
	let lastT = -1, nextKeep = -Infinity, lastDir: Facing | null = null;
	let prevDots: Uint8Array | null = null;
	/** Inputs and notes that came while no chunk was open. */
	let early: { inputs: number[]; marks: RunMark[] } = { inputs: [], marks: [] };

	function close(): RunChunk | null {
		const c = cur;
		cur = null;
		if (!c || !c.frames.length) return null;
		const first = c.frames[0], last = c.frames[c.frames.length - 1];
		const chunk: RunChunk = {
			blockKey: o.blockKey, i: next++, base: +base.toFixed(3),
			t0: +(base + first.t).toFixed(3), t1: +(base + last.t).toFixed(3), at: c.at, end: c.end,
			mazeId: c.maze.id, ...(c.maze.layout ? { layout: c.maze.layout } : {}),
			...(c.trials.length ? { trials: c.trials } : {}),
			data: encodeChunk(c, base)
		};
		o.onChunk(chunk);
		return chunk;
	}

	function openAt(scene: Scene) {
		cur = {
			frames: [], dots0: scene.dots.slice(), maze: scene.maze, changes: [], events: [],
			inputs: early.inputs, marks: early.marks, trials: early.marks.flatMap((m) => (m.k === 'trial' ? [m.key] : [])), at: now(), end: now()
		};
		early = { inputs: [], marks: [] };
	}

	function newGame() {
		close();
		// The next game starts a little after this one's last frame, on the same run clock.
		if (lastT >= 0) base = +(base + lastT + 0.5).toFixed(3);
		lastT = -1;
		nextKeep = -Infinity;
		prevDots = null;
		lastDir = null;
	}

	return {
		push(scene) {
			const f = scene.frame;
			if (lastT >= 0 && f.t < lastT - 1e-6) { newGame(); early.marks.push({ k: 'game', t: f.t }); }
			// One maze per chunk: a level on another maze starts a new one.
			if (cur && (cur.maze !== scene.maze || cur.dots0.length !== scene.dots.length)) close();
			lastT = f.t;
			let opened = false;
			if (f.t + 1e-9 >= nextKeep) {
				if (cur && cur.frames.length && f.t - cur.frames[0].t >= span - 1e-6) close();
				if (!cur) { openAt(scene); opened = true; }
				cur!.frames.push(f.events.length || f.popups.length ? { ...f, events: [] } : f);
				nextKeep = Math.max(nextKeep + 1 / RUN_HZ, f.t + 1 / RUN_HZ / 2);
			}
			if (cur) {
				cur.end = now();
				for (const e of f.events) if (e.type !== 'dot') cur.events.push([cs(e.t), stripT(roundEvent(e))]);
				if (!opened && prevDots && prevDots.length === scene.dots.length) {
					const d = scene.dots;
					for (let i = 0; i < d.length; i++) if (d[i] !== prevDots[i]) cur.changes.push(cs(f.t), i, d[i]);
				}
			}
			if (!prevDots || prevDots.length !== scene.dots.length) prevDots = scene.dots.slice();
			else prevDots.set(scene.dots);
		},
		input(dir) {
			if (dir === lastDir) return;
			lastDir = dir;
			const at = cs(Math.max(0, lastT));
			(cur ? cur.inputs : early.inputs).push(at, dir);
		},
		mark(m) {
			const full = { ...m, t: +Math.max(0, lastT).toFixed(3) } as RunMark;
			if (cur) { cur.marks.push(full); if (full.k === 'trial') cur.trials.push(full.key); }
			else early.marks.push(full);
		},
		newGame,
		flush: close,
		get next() { return next; },
		get runTime() { return +(base + Math.max(0, lastT)).toFixed(3); },
		get open() { return !!cur && cur.frames.length > 0; }
	};
}

function stripT(e: GameEvent): GameEvent {
	const { t: _t, ...rest } = e as GameEvent & Record<string, unknown>;
	return rest as unknown as GameEvent;
}

/** Where a refreshed run's recording carries on: this browser's note of the last chunk written. */
export interface RunRecProgress { next: number; runEnd: number }
const KEY = (blockKey: string) => `cc.rec.${blockKey}`;
export function readRecProgress(blockKey: string): RunRecProgress {
	try {
		const v = JSON.parse(localStorage.getItem(KEY(blockKey)) ?? 'null');
		if (v && Number.isInteger(v.next) && Number.isFinite(v.runEnd)) return v;
	} catch { /* no storage */ }
	return { next: 0, runEnd: 0 };
}
export function writeRecProgress(blockKey: string, p: RunRecProgress) {
	try { localStorage.setItem(KEY(blockKey), JSON.stringify(p)); } catch { /* storage blocked */ }
}
/** The later of two progress notes (this browser's and the server's). */
export function laterProgress(a: RunRecProgress, b: RunRecProgress | null): RunRecProgress {
	if (!b) return a;
	return { next: Math.max(a.next, b.next), runEnd: Math.max(a.runEnd, b.runEnd) };
}
/** Run time a page that continues a run starts at: a short visible gap after the last chunk. */
export const resumeAt = (p: RunRecProgress) => (p.next === 0 ? 0 : +(p.runEnd + 0.5).toFixed(3));
