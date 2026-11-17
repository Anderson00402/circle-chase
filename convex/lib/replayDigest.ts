/**
 * Replay digests: one document per session holding a slim row for every trial with a replay clip
 * (study trials only, no warm-up). The replay browser (`replays.list`) and the player's Previous /
 * Next (`replays.neighbours`) read these instead of trial rows.
 *
 * Why: the local backend costs about 0.6 ms per document read, so scanning 16,000 trial rows takes
 * seconds and ran again after every new trial. A session holds 100-200 trials, so the same list
 * reads about a hundred digests (each about 25 KB) instead. The dashboard's `trialDigests` would do
 * as well, but they carry the approach curves (about 100 KB a session), which would put a list of
 * every session near Convex's 16 MiB read limit; these stay small.
 *
 * Kept in step by the writers: `trials.save` calls `syncReplayDigest` with the new trial, the
 * reclassify step calls `patchReplayRows`; `replays.rebuildDigests` rebuilds them all. The trial
 * rows stay the source of truth: a digest can always be rebuilt from them.
 *
 * The participant's name is stored on the digest (refreshed at every write, on every chunk of the
 * session when it changes), so the list never reads the participants table.
 *
 * Chunks, as for the dashboard's digests (convex/lib/digest.ts): a session's rows are kept in
 * documents of at most `REPLAY_CHUNK` rows (`chunk` 0, 1...; older digests have none and hold the
 * whole session), so a new clip rewrites a small document, not the whole session. Readers already
 * treat every document on its own (rows, name, source, participant).
 */
import { defineTable } from 'convex/server';
import { v, type Infer } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { mode, source } from '../validators';

const maybeNum = v.union(v.number(), v.null());

export const replayRow = v.object({
	id: v.id('trials'),
	cue: v.string(),
	mode,
	/** Stored as a plain string so a new outcome class never breaks the digest. */
	outcome: v.string(),
	rulesVersion: v.number(),
	createdAt: v.number(),
	blockIndex: v.number(),
	trialIndex: v.number(),
	/** Game times of the power-up (s). */
	startedAt: v.number(),
	endedAt: v.number(),
	endReason: v.string(),
	total: v.number(),
	turnAt: maybeNum,
	turnLeft: maybeNum,
	turnDist: maybeNum,
	endDist: maybeNum,
	lastChaseEnd: v.union(v.string(), v.null()),
	eats: v.number(),
	/** The last eat: game time after the start, and power left then. */
	lastEatT: maybeNum,
	lastEatLeft: maybeNum,
	caught: v.boolean(),
	died: v.boolean(),
	diedDuring: v.boolean(),
	timeToCaught: maybeNum,
	nearMiss: v.boolean(),
	engaged: v.boolean(),
	inRates: v.boolean()
});
export type ReplayRow = Infer<typeof replayRow>;

export const replayDigestTable = defineTable({
	sessionId: v.id('sessions'),
	participantId: v.id('participants'),
	source,
	/** How the participant is shown everywhere (`participantName`). */
	name: v.string(),
	/** Run-console number (1, 2, 3... per source), null for participants who never used the console. */
	runNumber: maybeNum,
	lastAt: v.number(),
	/** Position among the session's chunks (absent: 0, a digest written before chunks). */
	chunk: v.optional(v.number()),
	rows: v.array(replayRow)
})
	.index('by_session', ['sessionId'])
	.index('by_source', ['source', 'lastAt'])
	.index('by_participant', ['participantId', 'lastAt']);

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * One participant identity for every page: the label the researcher typed and, when it does not
 * already say so, the console number ("Ana · #5", "P05"). Participants who never used the run
 * console (simulated players) have no console number: "Sim 133" or "P48".
 */
export function participantName(p: { label?: string | null; nickname?: string | null; runNumber?: number | null; number?: number | null; source?: string }): string {
	const typed = (p.label ?? p.nickname ?? '').trim();
	const run = p.runNumber ?? null;
	if (typed) return run !== null && typed !== `P${pad(run)}` ? `${typed} · #${run}` : typed;
	if (run !== null) return `P${pad(run)}`;
	if (p.number == null) return 'Unknown';
	return p.source === 'bot' ? `Sim ${p.number}` : `P${pad(p.number)}`;
}

/** A trial belongs in the replay browser: it has a clip and is not a warm-up. */
export const listed = (t: Doc<'trials'>) => !!t.clipId && !t.practice;

export function replayRowOf(t: Doc<'trials'>): ReplayRow {
	const last = t.eats.length ? t.eats[t.eats.length - 1] : null;
	return {
		id: t._id, cue: t.cue, mode: t.mode, outcome: t.outcome, rulesVersion: t.rulesVersion ?? 1, createdAt: t.createdAt,
		blockIndex: t.blockIndex, trialIndex: t.trialIndex, startedAt: t.startedAt, endedAt: t.endedAt, endReason: t.endReason,
		total: t.total, turnAt: t.turnAt, turnLeft: t.turnLeft, turnDist: t.turnDist, endDist: t.endDist,
		lastChaseEnd: t.lastChaseEnd ?? null, eats: t.eats.length, lastEatT: last ? last.t : null, lastEatLeft: last ? last.left : null,
		caught: t.after.caught, died: t.after.died, diedDuring: t.diedDuring, timeToCaught: t.after.timeToCaught,
		nearMiss: t.after.nearMiss, engaged: t.engaged, inRates: t.inRates
	};
}

async function who(ctx: MutationCtx, sessionId: Id<'sessions'>, participantId: Id<'participants'>) {
	const s = await ctx.db.get(sessionId);
	const p = await ctx.db.get(participantId);
	return {
		name: participantName({ label: s?.run?.participantLabel, nickname: p?.nickname, runNumber: p?.runNumber, number: p?.number, source: p?.source }),
		runNumber: p?.runNumber ?? null
	};
}

/** Rows per replay digest document. */
export const REPLAY_CHUNK = 25;
let chunkSize: number = REPLAY_CHUNK;
/** Tests only: write chunks of another size (Infinity: one document per session, as before chunks). */
export function setReplayChunkForTests(n: number) { chunkSize = n; }

type Digest = Doc<'replayDigests'>;
const byCreated = (a: ReplayRow, b: ReplayRow) => a.createdAt - b.createdAt;

async function chunksOf(ctx: MutationCtx, sessionId: Id<'sessions'>): Promise<Digest[]> {
	const ds = await ctx.db.query('replayDigests').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
	return ds.sort((a, b) => (a.chunk ?? 0) - (b.chunk ?? 0));
}

async function insertChunks(ctx: MutationCtx, head: Pick<Digest, 'sessionId' | 'participantId' | 'source' | 'name' | 'runNumber'>, rows: ReplayRow[], start: number) {
	const size = Number.isFinite(chunkSize) ? chunkSize : Math.max(1, rows.length);
	for (let i = 0, c = start; i < rows.length; i += size, c++) {
		const part = rows.slice(i, i + size);
		await ctx.db.insert('replayDigests', { ...head, chunk: c, lastAt: part[part.length - 1].createdAt, rows: part });
	}
}

/** Put one trial into its session's replay digest (insert or replace); a trial without a clip is left out. */
export async function syncReplayDigest(ctx: MutationCtx, t: Doc<'trials'>): Promise<void> {
	if (!listed(t)) return;
	const ds = await chunksOf(ctx, t.sessionId);
	const id = await who(ctx, t.sessionId, t.participantId);
	if (!ds.length) {
		await insertChunks(ctx, { sessionId: t.sessionId, participantId: t.participantId, source: t.source, ...id }, [replayRowOf(t)], 0);
		return;
	}
	const renamed = (d: Digest) => d.name !== id.name || d.runNumber !== id.runNumber;
	const home = ds.find((d) => d.rows.some((r) => r.id === t._id));
	const last = ds[ds.length - 1];
	let target: Digest | null = home ?? (last.rows.length < chunkSize ? last : null);
	if (target) {
		const rows = target.rows.filter((r) => r.id !== t._id);
		rows.push(replayRowOf(t));
		rows.sort(byCreated);
		await ctx.db.patch(target._id, { ...id, rows, lastAt: rows[rows.length - 1].createdAt });
	} else {
		await insertChunks(ctx, { sessionId: t.sessionId, participantId: t.participantId, source: t.source, ...id }, [replayRowOf(t)], (last.chunk ?? 0) + 1);
	}
	// The other chunks keep the session's name in step (rare: the label arrived after the first clips).
	for (const d of ds) if (d !== target && renamed(d)) await ctx.db.patch(d._id, id);
}

/** Replace the rows of some trials of one session (after they were re-scored). One write per chunk changed. */
export async function patchReplayRows(ctx: MutationCtx, sessionId: Id<'sessions'>, ts: Doc<'trials'>[]): Promise<void> {
	const byId = new Map(ts.filter(listed).map((t) => [t._id, t]));
	for (const d of await chunksOf(ctx, sessionId)) {
		if (!d.rows.some((r) => byId.has(r.id))) continue;
		await ctx.db.patch(d._id, { rows: d.rows.map((r) => (byId.has(r.id) ? replayRowOf(byId.get(r.id)!) : r)) });
	}
}

/** Rebuild one session's replay digest from its trial rows (one read per trial). Returns the rows kept. */
export async function rebuildReplayDigest(ctx: MutationCtx, sessionId: Id<'sessions'>): Promise<number> {
	const trials = await ctx.db.query('trials').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
	for (const d of await chunksOf(ctx, sessionId)) await ctx.db.delete(d._id);
	const rows = trials.filter(listed).map(replayRowOf).sort(byCreated);
	if (!rows.length) return 0;
	const t = trials[0];
	const id = await who(ctx, sessionId, t.participantId);
	await insertChunks(ctx, { sessionId, participantId: t.participantId, source: t.source, ...id }, rows, 0);
	return rows.length;
}
