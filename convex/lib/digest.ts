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
 * The trial rows stay the source of truth: a digest can always be rebuilt from them. Each digest has
 * a small companion in `trialCells` (per-session totals for the headline; convex/lib/cells.ts),
 * rewritten on every digest change here, so code elsewhere changes digests only through these
 * functions (`patchDigestRows` for a batch of rows).
 *
 * The digest's `mode` is its first trial's; each row carries its own `mode` too, and filters use
 * the row's (a console session can mix study and arcade runs).
 *
 * Chunks: a session's rows are kept in documents of at most `DIGEST_CHUNK` rows (`chunk` 0, 1,
 * 2...; digests written before chunks have no `chunk` and hold the whole session). A new trial is
 * appended to the session's last chunk, so a save rewrites at most `DIGEST_CHUNK` rows, not the
 * whole session (the local database keeps every revision: rewriting a 150-row digest on each trial
 * made about 1 GB of revisions for 15,000 power-ups). Readers treat each chunk like a digest of its
 * own (each carries the session's context and its own `firstAt`/`lastAt`); `sessionRows` gives a
 * session's rows in one list.
 */
import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mode, source } from '../validators';
import { unpackSeries } from './series';
import { cellsOfRows, type CellRow } from './cells';

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
	 * The raw measures the outcome rules read (convex/lib/rules.ts `RuleInput`), so the dashboard can
	 * recompute a class with a moved threshold (the "too early" line check) and the time to spare at a
	 * turn-away, without reading trial rows. Absent on digests built before they were carried.
	 */
	endReason: v.optional(v.string()),
	lastChaseEnd: v.optional(v.union(v.literal('turn'), v.literal('eat'), v.literal('open'), v.null())),
	turnDist: v.optional(maybeNum),
	chaseEndDist: v.optional(maybeNum),
	endDist: v.optional(maybeNum),
	cut: v.optional(v.union(v.literal('power'), v.literal('clear'), v.literal('quit'), v.null())),
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
	/** Position of this document among its session's chunks (absent: 0, a digest written before chunks). */
	chunk: v.optional(v.number()),
	rows: v.array(digestRow)
})
	.index('by_session', ['sessionId'])
	.index('by_source', ['source', 'lastAt'])
	.index('by_run', ['simRun', 'lastAt'])
	.index('by_participant', ['participantId', 'lastAt']);

/**
 * Per-session totals for the dashboard's headline numbers (convex/lib/cells.ts): one small document
 * per session, rebuilt from the session's digest rows whenever the digest changes, so the headline
 * query reads a few kilobytes per session whatever the number of trials. `data` is the JSON of
 * `CellsData` (condition ids and level names as keys, which Convex field names do not allow).
 */
export const trialCellsTable = defineTable({
	sessionId: v.id('sessions'),
	participantId: v.id('participants'),
	participantNumber: maybeNum,
	source,
	mode,
	simRun: v.optional(v.string()),
	firstAt: v.number(),
	lastAt: v.number(),
	/** Digest rows the totals were built from (a quick check that the two agree). */
	rows: v.number(),
	data: v.string()
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
		endReason: t.endReason,
		turnDist: t.turnDist ?? null,
		endDist: t.endDist ?? null,
		cut: t.after.cut ?? null,
		...(t.lastChaseEnd !== undefined ? { lastChaseEnd: t.lastChaseEnd } : {}),
		...(t.chaseEndDist !== undefined ? { chaseEndDist: t.chaseEndDist } : {}),
		...(t.gaveUpEarly !== undefined ? { gaveUpEarly: t.gaveUpEarly } : {}),
		...(curve ? { curve } : {})
	};
}

/**
 * Write a session's cells from its digest rows (insert, replace, or delete when no rows are left).
 * Every change to a digest goes through here, so the two never disagree.
 */
export async function syncCells(ctx: MutationCtx, d: Pick<Doc<'trialDigests'>, 'sessionId' | 'participantId' | 'participantNumber' | 'source' | 'mode' | 'simRun'>, rows: DigestRow[]): Promise<void> {
	const have = await ctx.db.query('trialCells').withIndex('by_session', (i) => i.eq('sessionId', d.sessionId)).unique();
	if (!rows.length) {
		if (have) await ctx.db.delete(have._id);
		return;
	}
	const doc = {
		sessionId: d.sessionId, participantId: d.participantId, participantNumber: d.participantNumber, source: d.source, mode: d.mode,
		...(d.simRun ? { simRun: d.simRun } : {}), ...bounds(rows), rows: rows.length,
		data: JSON.stringify(cellsOfRows(rows as CellRow[], d.mode))
	};
	if (have) await ctx.db.replace(have._id, doc);
	else await ctx.db.insert('trialCells', doc);
}

/** Rows per digest document (see "Chunks" above). */
export const DIGEST_CHUNK = 25;
let chunkSize: number = DIGEST_CHUNK;
/** Tests only: write chunks of another size (Infinity: one document per session, as before chunks). */
export function setDigestChunkForTests(n: number) { chunkSize = n; }

type Digest = Doc<'trialDigests'>;
type Reader = Pick<QueryCtx, 'db'>;
const byCreated = (a: DigestRow, b: DigestRow) => a.createdAt - b.createdAt;

/** A session's digest documents, in chunk order. */
export async function sessionChunks(ctx: Reader, sessionId: Id<'sessions'>): Promise<Digest[]> {
	const ds = await ctx.db.query('trialDigests').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
	return ds.sort((a, b) => (a.chunk ?? 0) - (b.chunk ?? 0));
}

/** All of a session's digest rows, oldest first. */
export function rowsOfChunks(ds: Digest[]): DigestRow[] {
	return ds.flatMap((d) => d.rows).sort(byCreated);
}
export async function sessionRows(ctx: Reader, sessionId: Id<'sessions'>): Promise<DigestRow[]> {
	return rowsOfChunks(await sessionChunks(ctx, sessionId));
}

/** Write a chunk's rows (delete it when none are left). */
async function writeChunk(ctx: MutationCtx, d: Digest, rows: DigestRow[]) {
	if (rows.length) await ctx.db.patch(d._id, { rows, ...bounds(rows) });
	else await ctx.db.delete(d._id);
}

/** Insert a session's rows as new chunks after `start`. */
async function insertChunks(ctx: MutationCtx, head: Omit<Digest, '_id' | '_creationTime' | 'rows' | 'firstAt' | 'lastAt' | 'chunk'>, rows: DigestRow[], start: number) {
	const size = Number.isFinite(chunkSize) ? chunkSize : Math.max(1, rows.length);
	for (let i = 0, c = start; i < rows.length; i += size, c++) {
		const part = rows.slice(i, i + size);
		await ctx.db.insert('trialDigests', { ...head, chunk: c, ...bounds(part), rows: part });
	}
}

/**
 * Change some rows of one session's digest (and its cells): `update` returns the new row, or the
 * same object to leave it. Only chunks with a changed row are written. For writers outside this
 * file, e.g. `admin.reclassify`.
 */
export async function patchSessionRows(ctx: MutationCtx, sessionId: Id<'sessions'>, update: (r: DigestRow) => DigestRow): Promise<void> {
	const ds = await sessionChunks(ctx, sessionId);
	if (!ds.length) return;
	const all: DigestRow[] = [];
	for (const d of ds) {
		let changed = false;
		const rows = d.rows.map((r) => { const n = update(r); if (n !== r) changed = true; return n; });
		if (changed) await writeChunk(ctx, d, rows);
		all.push(...rows);
	}
	await syncCells(ctx, ds[0], all.sort(byCreated));
}

function bounds(rows: DigestRow[]) {
	return { firstAt: rows.length ? rows[0].createdAt : 0, lastAt: rows.length ? rows[rows.length - 1].createdAt : 0 };
}

/**
 * Put one trial into its session's digest (insert or replace). Pass the packed series when the
 * trial is new; leave it out to keep the curve already stored (an outcome changed). A new trial is
 * appended to the last chunk, or starts a new one when that is full.
 */
export async function syncDigest(ctx: MutationCtx, t: Doc<'trials'>, packed?: ArrayBuffer | null): Promise<void> {
	const ds = await sessionChunks(ctx, t.sessionId);
	if (!ds.length) {
		const p = await ctx.db.get(t.participantId);
		const rows = [rowOf(t, packed ?? null)];
		const head = {
			sessionId: t.sessionId, participantId: t.participantId, participantNumber: p?.number ?? null,
			source: t.source, mode: t.mode, ...(t.simRun ? { simRun: t.simRun } : {})
		};
		await insertChunks(ctx, head, rows, 0);
		await syncCells(ctx, head, rows);
		return;
	}
	for (const d of ds) {
		const i = d.rows.findIndex((r) => r.id === t._id);
		if (i < 0) continue;
		const rows = [...d.rows];
		rows[i] = rowOf(t, packed, d.rows[i]);
		await writeChunk(ctx, d, rows);
		await syncCells(ctx, d, rowsOfChunks(ds.map((x) => (x === d ? { ...x, rows } : x))));
		return;
	}
	const total = ds.reduce((n, d) => n + d.rows.length, 0);
	const row = rowOf(t, total < MAX_ROWS_WITH_CURVE ? (packed ?? null) : null);
	const last = ds[ds.length - 1];
	let chunks: Digest[];
	if (last.rows.length < chunkSize) {
		const rows = [...last.rows, row].sort(byCreated);
		await writeChunk(ctx, last, rows);
		chunks = [...ds.slice(0, -1), { ...last, rows }];
	} else {
		const { _id, _creationTime, rows: _r, firstAt: _f, lastAt: _l, chunk, ...head } = last;
		await insertChunks(ctx, head, [row], (chunk ?? 0) + 1);
		chunks = [...ds, { ...last, rows: [row] }];
	}
	await syncCells(ctx, last, rowsOfChunks(chunks));
}

/** Rebuild one session's digest from its trial rows and series (about 2 reads per trial). */
export async function rebuildSessionDigest(ctx: MutationCtx, sessionId: Id<'sessions'>): Promise<number> {
	const trials = await ctx.db.query('trials').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
	const ds = await sessionChunks(ctx, sessionId);
	for (const d of ds) await ctx.db.delete(d._id);
	if (!trials.length) {
		if (ds.length) await syncCells(ctx, ds[0], []);
		return 0;
	}
	const rows: DigestRow[] = [];
	for (const t of trials) {
		const ser = await ctx.db.query('trialSeries').withIndex('by_trial', (i) => i.eq('trialId', t._id)).unique();
		rows.push(rowOf(t, rows.length < MAX_ROWS_WITH_CURVE ? (ser?.series ?? null) : null));
	}
	rows.sort(byCreated);
	const t = trials[0];
	const p = await ctx.db.get(t.participantId);
	const head = {
		sessionId, participantId: t.participantId, participantNumber: p?.number ?? null,
		source: t.source, mode: t.mode, ...(t.simRun ? { simRun: t.simRun } : {})
	};
	await insertChunks(ctx, head, rows, 0);
	await syncCells(ctx, head, rows);
	return rows.length;
}

/** Rewrite one session's cells from its digest rows (no digest change). Returns the rows read. */
export async function rebuildSessionCells(ctx: MutationCtx, sessionId: Id<'sessions'>): Promise<number> {
	const ds = await sessionChunks(ctx, sessionId);
	if (!ds.length) return 0;
	const rows = rowsOfChunks(ds);
	await syncCells(ctx, ds[0], rows);
	return rows.length;
}

/** Remove a trial from its session's digest (when the trial row is deleted). */
export async function dropFromDigest(ctx: MutationCtx, t: Pick<Doc<'trials'>, '_id' | 'sessionId'>): Promise<void> {
	const ds = await sessionChunks(ctx, t.sessionId);
	const d = ds.find((x) => x.rows.some((r) => r.id === t._id));
	if (!d) return;
	const rows = d.rows.filter((r) => r.id !== t._id);
	await writeChunk(ctx, d, rows);
	await syncCells(ctx, d, rowsOfChunks(ds.map((x) => (x === d ? { ...x, rows } : x))));
}
