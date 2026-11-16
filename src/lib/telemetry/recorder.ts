/**
 * Replay clips. The recorder keeps the last few seconds of play at 20 Hz; when a trial finishes,
 * `clipFor` cuts the STUDY.md window (from 8 s before the power ended, or its start if later, to
 * 3 s after: the whole power-up under study rules) and `encodeClip` packs it. `decodeClip` gives
 * back `Scene[]` the renderer can draw with any cue, plus markers and the trial's key numbers.
 *
 * The recorder also holds the very latest frame, on the 20 Hz grid or not. `clipFor` adds it before
 * cutting, so a clip always ends on the frame that closed the trial: the frame of a death (its
 * `die` event, the `dying` phase) is in the clip of a caught trial.
 *
 * Binary layout (version 1), all integers as delta encoded zigzag varints (see convex/lib/pack.ts):
 *   version, scene count, ghost count, dots length, starting dots (raw bytes),
 *   one column per field over all scenes (times in hundredths of a second, positions in 64ths of a
 *   tile, enums as small integers, -1 for "none"),
 *   dot changes (scene index, tile index, new value),
 *   events and popups as JSON text (they are few; the frequent "dot" events are left out).
 * A 9 s clip is about 10-15 KB (an 11 s one, the longest under study rules, about 18 KB).
 */
import { mazeById, mazeForLevel } from '../game/engine/mazes';
import { GHOST_IDS, type Frame, type GameEvent, type GhostId, type GhostMode, type Phase, type PowerEndReason, type Scene } from '../game/types';
import { Reader, Writer } from '#convex/lib/pack.ts';
import type { Outcome, TrialMeasures } from './types';

export const CLIP_HZ = 20;
/** Seconds before the end of the power: 8 covers every power-up of the study (4-8 s) from its first frame. */
export const CLIP_BEFORE = 8;
export const CLIP_AFTER = 3;
const VERSION = 1;
const POS = 64; // position steps per tile
const CS = 100; // time steps per second

export type MarkerKind = 'powerStart' | 'eat' | 'turnAway' | 'powerEnd' | 'death';
export interface Marker {
	kind: MarkerKind;
	/** Game time. */
	t: number;
	ghost?: GhostId;
	/** Power left at that moment (negative after the end). */
	left?: number;
}

/** The trial's key numbers, kept with the clip so a replay can caption itself. */
export interface ClipNumbers {
	outcome: Outcome;
	total: number;
	turnLeft: number | null;
	turnDist: number | null;
	endDist: number | null;
	timeToCaught: number | null;
	eats: number;
	engaged: boolean;
}

export interface ClipMeta {
	v: number;
	cue: string;
	mazeId: string;
	level: number;
	/** Game time of the first and last scene. */
	t0: number;
	t1: number;
	hz: number;
	scenes: number;
	markers: Marker[];
	numbers: ClipNumbers;
}

export interface EncodedClip extends ClipMeta {
	data: ArrayBuffer;
}

export interface DecodedClip {
	meta: ClipMeta;
	scenes: Scene[];
	markers: Marker[];
}

interface Kept {
	frame: Frame;
	dots: Uint8Array;
	mazeId: string;
}

export interface Recorder {
	/** Feed every live scene; keeps one in every 1/20 s of game time. */
	push(scene: Scene): void;
	/** Scenes for a finished trial, or null when the buffer no longer reaches back far enough. */
	clipFor(trial: TrialMeasures, cue: string): EncodedClip | null;
	reset(): void;
	/** Scenes currently held. */
	readonly size: number;
}

export function createRecorder(opts: { keep?: number } = {}): Recorder {
	// Enough for the longest window plus slack: 8 s before the end, 3 s after.
	const keep = opts.keep ?? CLIP_BEFORE + CLIP_AFTER + 1.5;
	let buf: Kept[] = [];
	let next = -Infinity;
	/** Events of frames that were not kept, waiting for the next kept frame. */
	let pending: GameEvent[] = [];
	/** The newest frame when it was not kept (off the 20 Hz grid). */
	let latest: Kept | null = null;

	function wipe() { buf = []; next = -Infinity; pending = []; latest = null; }

	function keepFrame(k: Kept) {
		const f = k.frame;
		buf.push(pending.length === f.events.length ? k : { ...k, frame: { ...f, events: pending } });
		pending = [];
		latest = null;
		next = Math.max(next + 1 / CLIP_HZ, f.t + 1 / CLIP_HZ / 2);
		while (buf.length > 2 && buf[0].frame.t < f.t - keep) buf.shift();
	}

	/** Puts the newest frame in the buffer if it is not there yet, with the events that waited for it. */
	function flush() {
		const tail = buf.length ? buf[buf.length - 1] : null;
		if (latest && (!tail || latest.frame.t > tail.frame.t + 1e-9)) { keepFrame(latest); return; }
		// Game time stood still (the freeze after an eat): the events belong to the frame already kept.
		if (tail && pending.length) {
			buf[buf.length - 1] = { ...tail, frame: { ...tail.frame, events: [...tail.frame.events, ...pending] } };
			pending = [];
		}
		latest = null;
	}

	return {
		push(scene) {
			const f = scene.frame;
			if (buf.length && f.t < buf[buf.length - 1].frame.t - 1e-9) wipe();
			if (f.events.length) pending.push(...f.events);
			const k: Kept = { frame: f, dots: scene.dots.slice(), mazeId: scene.maze.id };
			if (f.t + 1e-9 < next) { latest = k; return; }
			keepFrame(k);
		},
		clipFor(trial, cue) {
			flush();
			const from = Math.max(trial.startedAt, trial.endedAt - CLIP_BEFORE) - 1e-6;
			// One clip step past the 3 s, so the frame that closed the trial is in.
			const to = trial.endedAt + CLIP_AFTER + 1 / CLIP_HZ;
			const kept = buf.filter((k) => k.frame.t >= from && k.frame.t <= to && k.frame.level === trial.level);
			if (kept.length < 2) return null;
			return encodeClip(kept, cue, trial);
		},
		reset: wipe,
		get size() { return buf.length; }
	};
}

const PHASES: Phase[] = ['ready', 'playing', 'dying', 'clear', 'over'];
const MODES: GhostMode[] = ['waiting', 'leaving', 'active', 'returning'];
const REASONS: PowerEndReason[] = ['expired', 'died', 'cleared', 'refreshed'];
const cs = (v: number) => Math.round(v * CS);
const ocs = (v: number) => (v < 0 ? -1 : Math.round(v * CS)); // -1 stays "never"
const q = (v: number) => Math.round(v * POS);

/** Markers for a trial: power start, each eat, the turn-away, power end, death. */
export function markersFor(trial: TrialMeasures): Marker[] {
	const m: Marker[] = [{ kind: 'powerStart', t: trial.startedAt, left: trial.total }];
	for (const e of trial.eats) m.push({ kind: 'eat', t: +(trial.startedAt + e.t).toFixed(3), ghost: e.ghost, left: e.left });
	if (trial.turnAt !== null) m.push({ kind: 'turnAway', t: +(trial.startedAt + trial.turnAt).toFixed(3), left: trial.turnLeft ?? undefined });
	m.push({ kind: 'powerEnd', t: trial.endedAt, left: trial.leftAtEnd });
	if (trial.after.died && trial.after.timeToCaught !== null) {
		m.push({ kind: 'death', t: +(trial.endedAt + trial.after.timeToCaught).toFixed(3), ghost: trial.after.killer ?? undefined });
	} else if (trial.after.died) {
		m.push({ kind: 'death', t: +(trial.endedAt + trial.after.seen).toFixed(3), ghost: trial.after.killer ?? undefined });
	}
	return m.sort((a, b) => a.t - b.t);
}

function numbersFor(t: TrialMeasures): ClipNumbers {
	return {
		outcome: t.outcome, total: t.total, turnLeft: t.turnLeft, turnDist: t.turnDist, endDist: t.endDist,
		timeToCaught: t.after.timeToCaught, eats: t.eats.length, engaged: t.engaged
	};
}

export function encodeClip(kept: { frame: Frame; dots: Uint8Array; mazeId: string }[], cue: string, trial: TrialMeasures): EncodedClip {
	const n = kept.length;
	const frames = kept.map((k) => k.frame);
	const G = frames[0].ghosts.length;
	const w = new Writer();
	w.int(VERSION);
	w.int(n);
	w.int(G);
	w.bytes(kept[0].dots);

	const col = (fn: (f: Frame) => number) => w.column(frames.map(fn));
	col((f) => cs(f.t));
	col((f) => PHASES.indexOf(f.phase));
	col((f) => cs(f.phaseTime));
	col((f) => f.level);
	col((f) => f.score);
	col((f) => f.lives);
	col((f) => f.dotsLeft);
	col((f) => q(f.player.x));
	col((f) => q(f.player.y));
	col((f) => f.player.dir);
	col((f) => f.player.face);
	col((f) => (f.player.moving ? 1 : 0));
	for (let g = 0; g < G; g++) {
		col((f) => GHOST_IDS.indexOf(f.ghosts[g].id));
		col((f) => q(f.ghosts[g].x));
		col((f) => q(f.ghosts[g].y));
		col((f) => f.ghosts[g].dir);
		col((f) => MODES.indexOf(f.ghosts[g].mode));
		col((f) => (f.ghosts[g].scared ? 1 : 0));
		col((f) => ocs(f.ghosts[g].revertedAt));
		col((f) => ocs(f.ghosts[g].eatenAt));
	}
	col((f) => cs(f.power.left));
	col((f) => Math.round(f.power.total * 1000));
	col((f) => ocs(f.power.startedAt));
	col((f) => ocs(f.power.endedAt));
	col((f) => (f.power.endReason ? REASONS.indexOf(f.power.endReason) : -1));
	col((f) => f.power.chain);
	col((f) => f.power.serial);
	col((f) => (f.bonus ? f.bonus.kind : -1));
	col((f) => (f.bonus ? f.bonus.x : 0));
	col((f) => (f.bonus ? f.bonus.y : 0));
	col((f) => (f.bonus ? cs(f.bonus.left) : 0));

	// Dot changes between kept scenes.
	const changes: number[] = [];
	for (let s = 1; s < n; s++) {
		const a = kept[s - 1].dots, b = kept[s].dots;
		if (a.length !== b.length) { for (let i = 0; i < b.length; i++) changes.push(s, i, b[i]); continue; }
		for (let i = 0; i < b.length; i++) if (a[i] !== b[i]) changes.push(s, i, b[i]);
	}
	w.int(changes.length / 3);
	w.column(changes.filter((_, i) => i % 3 === 0));
	w.column(changes.filter((_, i) => i % 3 === 1));
	w.column(changes.filter((_, i) => i % 3 === 2));

	// Events (without the frequent "dot" events, which the dot changes already show) and popups.
	const events: [number, GameEvent][] = [];
	frames.forEach((f, s) => { for (const e of f.events) if (e.type !== 'dot') events.push([s, roundEvent(e)]); });
	// Popups per scene (scene, x, y, text, age): few and short-lived. Their age keeps running during
	// the freeze after an eat while game time stands still, so it cannot be rebuilt from time alone.
	const popups: [number, number, number, string, number][] = [];
	frames.forEach((f, s) => { for (const p of f.popups) popups.push([s, q(p.x), q(p.y), p.text, cs(p.age)]); });
	w.text(JSON.stringify({ events, popups }));

	return {
		v: VERSION, cue, mazeId: kept[0].mazeId, level: frames[0].level,
		t0: frames[0].t, t1: frames[n - 1].t, hz: CLIP_HZ, scenes: n,
		markers: markersFor(trial), numbers: numbersFor(trial), data: w.finish()
	};
}

function roundEvent(e: GameEvent): GameEvent {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(e)) out[k] = typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
	return out as GameEvent;
}

export function decodeClip(clip: EncodedClip): DecodedClip {
	const r = new Reader(clip.data);
	const v = r.int();
	if (v !== VERSION) throw new Error(`unknown clip version ${v}`);
	const n = r.int(), G = r.int();
	let dots = r.bytes();
	const c = () => r.column(n);
	const t = c(), phase = c(), phaseTime = c(), level = c(), score = c(), lives = c(), dotsLeft = c();
	const px = c(), py = c(), pdir = c(), pface = c(), pmoving = c();
	const ghosts: number[][][] = [];
	for (let g = 0; g < G; g++) ghosts.push([c(), c(), c(), c(), c(), c(), c(), c()]);
	const left = c(), total = c(), startedAt = c(), endedAt = c(), reason = c(), chain = c(), serial = c();
	const bkind = c(), bx = c(), by = c(), bleft = c();
	const nc = r.int();
	const cScene = r.column(nc), cTile = r.column(nc), cVal = r.column(nc);
	const extra = JSON.parse(r.text()) as { events: [number, GameEvent][]; popups: [number, number, number, string, number][] };

	const time = (x: number) => x / CS;
	const otime = (x: number) => (x < 0 ? -1 : x / CS);
	const scenes: Scene[] = [];
	let ci = 0;
	for (let s = 0; s < n; s++) {
		if (ci < nc && cScene[ci] === s) {
			dots = dots.slice();
			while (ci < nc && cScene[ci] === s) { dots[cTile[ci]] = cVal[ci]; ci++; }
		}
		const ft = time(t[s]);
		const frame: Frame = {
			t: ft, phase: PHASES[phase[s]] ?? 'playing', phaseTime: time(phaseTime[s]), level: level[s],
			mazeId: clip.mazeId, score: score[s], lives: lives[s], dotsLeft: dotsLeft[s],
			player: { x: px[s] / POS, y: py[s] / POS, dir: pdir[s] as Frame['player']['dir'], face: pface[s] as Frame['player']['face'], moving: pmoving[s] === 1 },
			ghosts: ghosts.map((gc) => ({
				id: GHOST_IDS[gc[0][s]], x: gc[1][s] / POS, y: gc[2][s] / POS, dir: gc[3][s] as Frame['player']['dir'],
				mode: MODES[gc[4][s]], scared: gc[5][s] === 1, revertedAt: otime(gc[6][s]), eatenAt: otime(gc[7][s])
			})),
			power: {
				left: time(left[s]), total: total[s] / 1000, startedAt: otime(startedAt[s]), endedAt: otime(endedAt[s]),
				endReason: reason[s] < 0 ? null : REASONS[reason[s]], chain: chain[s], serial: serial[s]
			},
			bonus: bkind[s] < 0 ? null : { kind: bkind[s], x: bx[s], y: by[s], left: time(bleft[s]) },
			popups: extra.popups.filter(([i]) => i === s).map(([, x, y, text, age]) => ({ x: x / POS, y: y / POS, text, age: age / CS })),
			events: extra.events.filter(([i]) => i === s).map(([, e]) => e)
		};
		const maze = level[s] === clip.level ? mazeById(clip.mazeId) : mazeForLevel(level[s]);
		scenes.push({ maze, dots, frame });
	}
	const { data: _data, ...meta } = clip;
	return { meta, scenes, markers: clip.markers };
}
