/**
 * Trial digests: one document per session holding a compact row per trial (outcome, timing, context
 * and the approach curve already binned). The dashboard reads these instead of trial rows.
 *
 * Why: the backend costs about the same per document whatever its size (about 0.6 ms locally), so a
 * summary over 4,000 trial rows takes seconds and runs again after every new trial. A study session
 * holds 100-200 trials, so the same summary reads a few dozen digests instead.
 *
 * Kept in step by the writers: `trials.save` calls `syncDigest` with the new trial and its series;
 * anything that changes a stored trial (reclassify, migrations) calls `syncDigest` without a series
 * (the curve is kept) or `rebuildSessionDigest`. `dashboard.rebuildDigests` rebuilds them all.
 * The trial rows stay the source of truth: a digest can always be rebuilt from them.
 *
 * The digest's `mode` is its first trial's; each row carries its own `mode` too, and filters use
 * the row's (a console session can mix study and arcade runs).
 */
import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mode, source } from '../validators';
import { unpackSeries } from './series';

/** Approach-curve grid: from 8 s of power left to 3 s after the end, every 0.25 s. */
export const CURVE_FROM = 8;
export const CURVE_TO = -3;
export const CURVE_STEP = 0.25;
export const CURVE_BINS = Math.round((CURVE_FROM - CURVE_TO) / CURVE_STEP) + 1;
/** Time left at bin k. */
export const curveAt = (k: number) => Math.round((CURVE_FROM - k * CURVE_STEP) * 100) / 100;

const maybeNum = v.union(v.number(), v.null());

export const digestRow = v.object({
	id: v.id('trials'),
	cue: v.string(),
	createdAt: v.number(),
	/** Stored as a plain string so a new outcome class never breaks the digest. */
	outcome: v.string(),
	rulesVersion: maybeNum,
	engaged: v.boolean(),
	inRates: v.boolean(),
	practice: v.boolean(),
	turnLeft: maybeNum,
	wasted: maybeNum,
	total: v.number(),
	trialIndex: v.number(),
	blockIndex: v.number(),
	sound: v.boolean(),
	inputType: v.string(),
	fps: v.number(),
	clip: v.boolean(),
	caught: v.boolean(),
	nearMiss: v.boolean(),
	/** Rules v3: an early retreat that gave up on the chase very early (docs/STUDY.md). Absent before v3. */
	gaveUpEarly: v.optional(v.boolean()),
	/** The trial's own rules mode (a console session can mix study and arcade runs). */
	mode: v.optional(mode),
	/**
	 * Approach curve on the grid above, packed (`packCurve`): per bin the path distance to the
	 * nearest scared ghost in tenths of a tile (-1: no target; -2: no sample) and whether the player
	 * was chasing (1, 0; -1: no sample). About 135 bytes. Absent when the series is missing.
	 */
	curve: v.optional(v.bytes())
});
export type DigestRow = Infer<typeof digestRow>;

export const trialDigestTable = defineTable({
	sessionId: v.id('sessions'),
	participantId: v.id('participants'),
	/** The participant's number (P7), for labels without another read. */
	participantNumber: maybeNum,
	source,
	mode,
	simRun: v.optional(v.string()),
	firstAt: v.number(),
	lastAt: v.number(),
	rows: v.array(digestRow)
})
	.index('by_session', ['sessionId'])
	.index('by_source', ['source', 'lastAt'])
	.index('by_run', ['simRun', 'lastAt'])
	.index('by_participant', ['participantId', 'lastAt']);

export interface Curve {
	dist: number[];
	chasing: number[];
}

/** Curve as bytes: CURVE_BINS int16 distances, then CURVE_BINS int8 chasing flags. */
export function packCurve(c: Curve): ArrayBuffer {
	const buf = new ArrayBuffer(CURVE_BINS * 3);
	const dv = new DataView(buf);
	for (let k = 0; k < CURVE_BINS; k++) {
		dv.setInt16(k * 2, Math.max(-32768, Math.min(32767, c.dist[k])), true);
		dv.setInt8(CURVE_BINS * 2 + k, c.chasing[k]);
	}
	return buf;
}

export function unpackCurve(buf: ArrayBuffer): Curve {
	const dv = new DataView(buf);
	const dist: number[] = [], chasing: number[] = [];
	for (let k = 0; k < CURVE_BINS; k++) {
		dist.push(dv.getInt16(k * 2, true));
		chasing.push(dv.getInt8(CURVE_BINS * 2 + k));
	}
	return { dist, chasing };
}

/** The curve of a digest row, if it has one (packed or legacy). */
export function curveOf(r: DigestRow): Curve | null {
	return r.curve ? unpackCurve(r.curve) : null;
}

/**
 * Rows beyond this in one session's digest are stored without their curve, so the document stays
 * far below Convex's 1 MiB limit (a row is about 0.3 KB; a console session holds about 150).
 */
export const MAX_ROWS_WITH_CURVE = 2000;

/** Bin a packed series onto the curve grid (the first sample in each bin). */
export function binCurve(packed: ArrayBuffer): Curve {
	const s = unpackSeries(packed);
	const dist = new Array<number>(CURVE_BINS).fill(-2);
	const chasing = new Array<number>(CURVE_BINS).fill(-1);
	for (let i = 0; i < s.t.length; i++) {
		const k = Math.round((CURVE_FROM - s.left[i]) / CURVE_STEP);
		if (k < 0 || k >= CURVE_BINS || chasing[k] !== -1) continue;
		const d = s.dist[i];
		dist[k] = d === null ? -1 : Math.round(d * 10);
		chasing[k] = s.chasing[i] ? 1 : 0;
	}
	return { dist, chasing };
}

/** The digest row of a stored trial. `packed`: its series (null: none; undefined: keep `keep`'s curve). */
export function rowOf(t: Doc<'trials'>, packed?: ArrayBuffer | null, keep?: DigestRow): DigestRow {
	const kept = packed === undefined ? keep?.curve : undefined;
	const curve = packed ? packCurve(binCurve(packed)) : kept;
	return {
		id: t._id,
		cue: t.cue,
		createdAt: t.createdAt,
		outcome: t.outcome,
		rulesVersion: t.rulesVersion ?? 1,
		engaged: t.engaged,
		inRates: t.inRates,
		practice: !!t.practice,
		turnLeft: t.turnLeft,
		wasted: t.wasted,
		total: t.total,
		trialIndex: t.trialIndex,
		blockIndex: t.blockIndex,
		sound: t.sound,
		inputType: t.inputType,
		fps: t.fps,
		clip: !!t.clipId,
		caught: t.after.caught,
		nearMiss: t.after.nearMiss,
		mode: t.mode,
		...(t.gaveUpEarly !== undefined ? { gaveUpEarly: t.gaveUpEarly } : {}),
		...(curve ? { curve } : {})
	};
}

function bounds(rows: DigestRow[]) {
	return { firstAt: rows.length ? rows[0].createdAt : 0, lastAt: rows.length ? rows[rows.length - 1].createdAt : 0 };
}

/**
 * Put one trial into its session's digest (insert or replace). Pass the packed series when the
 * trial is new; leave it out to keep the curve already stored (an outcome changed).
 */
export async function syncDigest(ctx: MutationCtx, t: Doc<'trials'>, packed?: ArrayBuffer | null): Promise<void> {
	const d = await ctx.db.query('trialDigests').withIndex('by_session', (i) => i.eq('sessionId', t.sessionId)).unique();
	if (!d) {
		const p = await ctx.db.get(t.participantId);
		const rows = [rowOf(t, packed ?? null)];
		await ctx.db.insert('trialDigests', {
			sessionId: t.sessionId, participantId: t.participantId, participantNumber: p?.number ?? null,
			source: t.source, mode: t.mode, ...(t.simRun ? { simRun: t.simRun } : {}), ...bounds(rows), rows
		});
		return;
	}
	const i = d.rows.findIndex((r) => r.id === t._id);
	const rows = [...d.rows];
	if (i >= 0) rows[i] = rowOf(t, packed, d.rows[i]);
	else {
		rows.push(rowOf(t, rows.length < MAX_ROWS_WITH_CURVE ? (packed ?? null) : null));
		rows.sort((a, b) => a.createdAt - b.createdAt);
	}
	await ctx.db.patch(d._id, { rows, ...bounds(rows) });
}

/** Rebuild one session's digest from its trial rows and series (about 2 reads per trial). */
export async function rebuildSessionDigest(ctx: MutationCtx, sessionId: Id<'sessions'>): Promise<number> {
	const trials = await ctx.db.query('trials').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
	const d = await ctx.db.query('trialDigests').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).unique();
	if (!trials.length) {
		if (d) await ctx.db.delete(d._id);
		return 0;
	}
	const rows: DigestRow[] = [];
	for (const t of trials) {
		const ser = await ctx.db.query('trialSeries').withIndex('by_trial', (i) => i.eq('trialId', t._id)).unique();
		rows.push(rowOf(t, rows.length < MAX_ROWS_WITH_CURVE ? (ser?.series ?? null) : null));
	}
	rows.sort((a, b) => a.createdAt - b.createdAt);
	if (d) {
		await ctx.db.patch(d._id, { rows, ...bounds(rows) });
	} else {
		const p = await ctx.db.get(trials[0].participantId);
		const t = trials[0];
		await ctx.db.insert('trialDigests', {
			sessionId, participantId: t.participantId, participantNumber: p?.number ?? null,
			source: t.source, mode: t.mode, ...(t.simRun ? { simRun: t.simRun } : {}), ...bounds(rows), rows
		});
	}
	return rows.length;
}

/** Remove a trial from its session's digest (when the trial row is deleted). */
export async function dropFromDigest(ctx: MutationCtx, t: Pick<Doc<'trials'>, '_id' | 'sessionId'>): Promise<void> {
	const d = await ctx.db.query('trialDigests').withIndex('by_session', (i) => i.eq('sessionId', t.sessionId)).unique();
	if (!d) return;
	const rows = d.rows.filter((r) => r.id !== t._id);
	if (rows.length) await ctx.db.patch(d._id, { rows, ...bounds(rows) });
	else await ctx.db.delete(d._id);
}
