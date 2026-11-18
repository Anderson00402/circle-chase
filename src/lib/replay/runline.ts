/**
 * The timeline of a whole run (/replays/run/<blockKey>): where each power-up sits in run time, its
 * moment markers, and the jump points.
 *
 * Run time = a chunk's `base` + game time (src/lib/telemetry/runrec.ts). A trial's times are game
 * times of the page that played it, so its base is the base of the chunk that lists the trial's key
 * (every chunk of one game shares its base). Older or odd cases fall back to the chunk whose game
 * span holds the end of the power and whose wall-clock time is nearest before the trial was stored.
 *
 * Jump points: for each power-up, two seconds (`LEAD`) before its key moment, where the close call
 * plays out: the turn-away when there was one, else the end of the power.
 */
import type { GhostId } from '../game/types';
import type { Marker } from '../telemetry/recorder';

/** Seconds of lead before a power-up's key moment. */
export const LEAD = 2;

export interface RunTrial {
	_id: string;
	key: string;
	n: number;
	createdAt: number;
	outcome: string;
	startedAt: number;
	endedAt: number;
	total: number;
	endReason: string;
	leftAtEnd: number;
	turnAt: number | null;
	turnLeft: number | null;
	turnDist: number | null;
	endDist: number | null;
	lastChaseEnd: string | null;
	eats: { t: number; ghost: string; left: number }[];
	after: { died: boolean; caught: boolean; timeToCaught: number | null; seen: number; killer: string | null };
	diedDuring?: boolean;
	clipId: string | null;
}

export interface ChunkHead {
	i: number;
	base: number;
	t0: number;
	t1: number;
	at: number;
	end: number;
	trials: string[];
}

export interface Span {
	trial: RunTrial;
	/** Run time of the game time 0 of the trial's game. */
	base: number;
	/** Run times: power on, power end, end of the 3 s after it (or the death). */
	start: number;
	end: number;
	until: number;
	/** The key moment (turn-away, else the end of the power) and the jump point before it. */
	key: number;
	keyKind: 'turnAway' | 'powerEnd';
	jump: number;
	markers: Marker[];
}

/** The base of a trial's game, or null when no chunk can be tied to it. */
export function trialBase(t: Pick<RunTrial, 'key' | 'endedAt' | 'startedAt' | 'createdAt'>, chunks: ChunkHead[]): number | null {
	const listed = chunks.find((c) => c.trials.includes(t.key));
	if (listed) return listed.base;
	let best: ChunkHead | null = null;
	for (const c of chunks) {
		const g0 = c.t0 - c.base, g1 = c.t1 - c.base;
		if (t.startedAt < g0 - 0.2 || t.startedAt > g1 + 0.2) continue;
		if (c.at > t.createdAt) continue;
		if (!best || c.at > best.at) best = c;
	}
	return best ? best.base : null;
}

/** The trial's markers in game time, as the clip player shows them. */
export function trialMarkers(t: RunTrial): Marker[] {
	const m: Marker[] = [{ kind: 'powerStart', t: t.startedAt, left: t.total }];
	for (const e of t.eats) m.push({ kind: 'eat', t: t.startedAt + e.t, ghost: e.ghost as GhostId, left: e.left });
	const lastEat = t.eats.length ? t.eats[t.eats.length - 1] : null;
	const endedByEat = t.lastChaseEnd === 'eat' || t.outcome === 'catch'
		|| (t.lastChaseEnd == null && lastEat !== null && t.turnAt !== null && Math.abs(t.turnAt - lastEat.t) < 0.06);
	if (t.turnAt !== null && !endedByEat && t.startedAt + t.turnAt <= t.endedAt + 3.05) {
		m.push({ kind: 'turnAway', t: t.startedAt + t.turnAt, left: t.turnLeft ?? undefined });
	}
	m.push({ kind: 'powerEnd', t: t.endedAt, left: t.leftAtEnd });
	if (t.endReason === 'died') m.push({ kind: 'death', t: t.endedAt, left: t.leftAtEnd });
	else if (t.after.died) m.push({ kind: 'death', t: t.endedAt + (t.after.timeToCaught ?? t.after.seen), ghost: (t.after.killer ?? undefined) as GhostId | undefined });
	return m.sort((a, b) => a.t - b.t);
}

/** Every trial placed on the run's clock (trials that cannot be placed are left out), in time order. */
export function spansOf(trials: RunTrial[], chunks: ChunkHead[], lead = LEAD): Span[] {
	const out: Span[] = [];
	for (const t of trials) {
		const base = trialBase(t, chunks);
		if (base === null) continue;
		const markers = trialMarkers(t).map((m) => ({ ...m, t: +(m.t + base).toFixed(3) }));
		const turn = markers.find((m) => m.kind === 'turnAway');
		const end = base + t.endedAt;
		const key = turn ? turn.t : end;
		const death = markers.find((m) => m.kind === 'death');
		const start = base + t.startedAt;
		out.push({
			trial: t, base, start, end, until: Math.max(end + (t.endReason === 'expired' ? Math.min(3, t.after.seen) : 0), death?.t ?? -Infinity),
			key, keyKind: turn ? 'turnAway' : 'powerEnd', jump: Math.max(start - 0.5, key - lead), markers
		});
	}
	return out.sort((a, b) => a.start - b.start);
}

/** The jump points of a run, in time order. */
export const jumpPoints = (spans: Span[]) => spans.map((s) => s.jump).sort((a, b) => a - b);

/** The next (dir 1) or previous (dir -1) jump point from `time`, or null. */
export function nextJump(spans: Span[], time: number, dir: 1 | -1): Span | null {
	const sorted = [...spans].sort((a, b) => a.jump - b.jump);
	if (dir > 0) return sorted.find((s) => s.jump > time + 0.05) ?? null;
	// Going back from inside a power-up's moment first goes to its own jump point.
	return [...sorted].reverse().find((s) => s.jump < time - 0.3) ?? null;
}

/** The power-up the playhead is in (from its start to the end of its aftermath). */
export const spanAt = (spans: Span[], t: number) => spans.find((s) => t >= s.start - 1e-6 && t <= s.until + 1e-6) ?? null;

export interface ExtraMark { kind: 'death' | 'bonus'; t: number }

/** Deaths outside every power-up (and its aftermath) and bonus pickups, from the run's events (run time). */
export function extraMarks(events: { type: string; t: number }[], spans: Span[]): ExtraMark[] {
	const out: ExtraMark[] = [];
	for (const e of events) {
		if (e.type === 'bonus') out.push({ kind: 'bonus', t: e.t });
		else if (e.type === 'die' && !spans.some((s) => e.t >= s.start - 0.05 && e.t <= s.until + 0.6)) out.push({ kind: 'death', t: e.t });
	}
	return out.sort((a, b) => a.t - b.t);
}

/** "1:05.3" for a run time in seconds. */
export function clock(t: number, digits = 1): string {
	// Round first, so 59.97 s reads 1:00.0, never 0:60.0.
	const k = 10 ** digits;
	const s = Math.round(Math.max(0, t) * k) / k;
	const m = Math.floor(s / 60);
	const r = s - m * 60;
	return `${m}:${r.toFixed(digits).padStart(digits ? 3 + digits : 2, '0')}`;
}
