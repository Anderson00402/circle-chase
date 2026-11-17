/**
 * Exports: trials (CSV or JSON), ratings (CSV) and blocks, i.e. runs (CSV). Every export is read in
 * pages (`exports.page`), so it works at any size: one page stays far below Convex's 16 MiB return
 * limit, and the HTTP routes (convex/http.ts) stream page after page into one download.
 *
 * Context that lives on other rows (participant label and numbers, the Latin square row, pauses,
 * the session's app version and simulator run) is joined in per page, one session at a time: the
 * blocks and ratings of a session are read with one index query each and kept for the page, so a
 * page costs about (rows + 3 x sessions on it) reads, never a lookup per row. With the default
 * page sizes below that stays far inside Convex's per-query budget even on a busy machine; the
 * HTTP stream also retries a failed page at half the size (convex/http.ts).
 */
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { query, type QueryCtx } from './_generated/server';
import { filterArgs, light, matches, trialRange, type Filter } from './lib/filters';
import { isDecision, isLateCatch } from './lib/rules';
import { unpackSeries } from './lib/series';
import { packedSeriesOf } from './trials';

/**
 * Rows per page by default; the HTTP routes accept `pageSize` (1-1000) to force smaller pages.
 * Kept small on purpose (round 3: 1,000 ratings or 500 blocks per page timed out with "too many
 * system operations" on a loaded machine). A trials JSON row also reads its series, so its pages
 * are the smallest.
 */
export const PAGE_SIZE = { trials: 200, trialsJson: 100, ratings: 200, blocks: 200 } as const;

export const kind = v.union(v.literal('trials'), v.literal('ratings'), v.literal('blocks'));
export type Kind = 'trials' | 'ratings' | 'blocks';
export const format = v.union(v.literal('csv'), v.literal('json'));

/**
 * Rows joined in for context, looked up once per page. Blocks and ratings are read a whole session
 * at a time (one index query each), since the rows of a page come from few sessions.
 */
class Joins {
	private sessions = new Map<string, Doc<'sessions'> | null>();
	private participants = new Map<string, Doc<'participants'> | null>();
	private blocksOf = new Map<string, Map<string, Doc<'blocks'>>>();
	private ratingsOf = new Map<string, Map<string, Doc<'ratings'>>>();
	constructor(private ctx: QueryCtx) {}
	private async get<T>(map: Map<string, T | null>, id: string, load: () => Promise<T | null>): Promise<T | null> {
		if (!map.has(id)) map.set(id, await load());
		return map.get(id) ?? null;
	}
	session(id: Id<'sessions'>) { return this.get(this.sessions, id, () => this.ctx.db.get(id)); }
	participant(id: Id<'participants'>) { return this.get(this.participants, id, () => this.ctx.db.get(id)); }
	/** A block of the given session (all its blocks are read on first use). */
	async block(sessionId: Id<'sessions'>, id: Id<'blocks'>): Promise<Doc<'blocks'> | null> {
		let m = this.blocksOf.get(sessionId);
		if (!m) {
			const rows = await this.ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
			this.blocksOf.set(sessionId, (m = new Map(rows.map((b) => [b._id as string, b]))));
		}
		// A block filed under another session (should not happen) is still found.
		return m.get(id) ?? (await this.ctx.db.get(id));
	}
	/** The block rating of a block of the given session (the first, as `by_block` would give). */
	async ratingOfBlock(sessionId: Id<'sessions'>, blockId: Id<'blocks'>): Promise<Doc<'ratings'> | null> {
		let m = this.ratingsOf.get(sessionId);
		if (!m) {
			const rows = await this.ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', sessionId)).collect();
			m = new Map();
			for (const r of rows) if (r.blockId && !m.has(r.blockId)) m.set(r.blockId, r);
			this.ratingsOf.set(sessionId, m);
		}
		return m.get(blockId) ?? null;
	}
}

/** Who and in which run: the same columns at the start of every export. */
function who(s: Doc<'sessions'> | null, p: Doc<'participants'> | null) {
	return {
		participantLabel: s?.run?.participantLabel ?? p?.nickname ?? null,
		/**
		 * The number the researcher sees on the run console and run screens ("#4"). Null outside
		 * the run console (free play, bots on play pages).
		 */
		consoleNumber: s?.run?.participantNumber ?? p?.runNumber ?? null,
		/** Overall order of first visit (everyone, also free play and bots). Not the console's "#N": use `consoleNumber`. */
		participantNumber: p?.number ?? null,
		/** Run-console order per source: what picks the suggested case order from now on. */
		runNumber: p?.runNumber ?? null,
		/** Number the session's suggested order was picked with (older sessions: the overall number). */
		orderNumber: s?.run?.participantNumber ?? s?.study?.participantNumber ?? null,
		orderRow: s?.run?.orderRow ?? s?.study?.orderRow ?? null,
		simRun: s?.sim?.run ?? null
	};
}

type Row = Record<string, unknown>;

/**
 * The chase log in one CSV cell: one chase per `;`, each `ghost from at left dist gain end endDist`
 * (seconds since the power started, power left, tiles; `-` for a missing distance), in the order the
 * chases began. Empty for a trial without chases, `null` before rules version 3 (no log stored).
 */
export function chaseLogCell(log: Doc<'trials'>['chaseLog']): string | null {
	if (!log) return null;
	const n = (x: number | null) => (x === null ? '-' : String(Math.round(x * 1000) / 1000));
	return log.map((c) => [c.ghost, n(c.from), n(c.at), n(c.left), n(c.dist), n(c.gain), c.end, n(c.endDist)].join(' ')).join(';');
}

/** The chase log back from its CSV cell (the inverse of `chaseLogCell`, to three decimals). */
export function parseChaseLogCell(cell: string | null): NonNullable<Doc<'trials'>['chaseLog']> | null {
	if (cell === null) return null;
	if (cell === '') return [];
	const n = (x: string) => (x === '-' ? null : Number(x));
	return cell.split(';').map((c) => {
		const [ghost, from, at, left, dist, gain, end, endDist] = c.split(' ');
		return { ghost, from: n(from)!, at: n(at)!, left: n(left)!, dist: n(dist)!, gain: n(gain)!, end: end as 'turn' | 'eat' | 'open', endDist: n(endDist) };
	});
}

/** One trial as a flat CSV row: context first, then every measure (nested values spelled out). */
async function trialRow(t: Doc<'trials'>, j: Joins): Promise<Row> {
	const s = await j.session(t.sessionId);
	const p = await j.participant(t.participantId);
	const b = await j.block(t.sessionId, t.blockId);
	const suggested = s?.cueOrder.indexOf(t.cue) ?? -1;
	return {
		trialId: t._id, createdAt: new Date(t.createdAt).toISOString(),
		participantId: t.participantId, ...who(s, p), sessionId: t.sessionId, blockId: t.blockId,
		source: t.source, mode: t.mode, cue: t.cue,
		blockIndex: t.blockIndex, suggestedPosition: suggested >= 0 ? suggested : null,
		pauses: b?.pauses ?? null, pausedSeconds: b?.pausedSeconds ?? null,
		trialIndex: t.trialIndex, difficulty: t.difficulty, level: t.level, mazeId: t.mazeId,
		powerTotal: t.total, sound: t.sound, reducedMotion: t.reducedMotion, inputType: t.inputType, fps: t.fps,
		appVersion: t.appVersion, endReason: t.endReason, leftAtEnd: t.leftAtEnd, scaredAtStart: t.scaredAtStart,
		outcome: t.outcome, rulesVersion: t.rulesVersion ?? 1, engaged: t.engaged, inRates: t.inRates,
		decision: isDecision(t), catchLate: t.outcome === 'catch' ? isLateCatch(t) : null,
		eats: t.eats.length, eatLefts: t.eats.map((e) => e.left).join(' '), lateCatch: t.lateCatch,
		allEatenLeft: t.allEatenLeft, turnLeft: t.turnLeft, turnDist: t.turnDist, turnAt: t.turnAt,
		turnReachable: t.turnReachable, chases: t.chases, lastChaseEnd: t.lastChaseEnd ?? null,
		// Rules version 3 raw measures: with the columns around them, enough to recompute the class.
		chaseEndDist: t.chaseEndDist ?? null, chaseGain: t.chaseGain ?? null, chaseGhost: t.chaseGhost ?? null,
		gaveUpEarly: t.gaveUpEarly ?? null, chaseLog: chaseLogCell(t.chaseLog),
		endDist: t.endDist, endClosing: t.endClosing,
		afterSeen: t.after.seen, afterCut: t.after.cut ?? null, afterDied: t.after.died, caught: t.after.caught,
		timeToCaught: t.after.timeToCaught, killer: t.after.killer, minDangerDist: t.after.minDangerDist,
		nearMiss: t.after.nearMiss, reaction: t.reaction, wasted: t.wasted, diedDuring: t.diedDuring,
		frames: t.frames, hasClip: !!t.clipId, practice: t.practice ?? false
	};
}

async function ratingRow(r: Doc<'ratings'>, j: Joins): Promise<Row> {
	const s = await j.session(r.sessionId);
	const p = await j.participant(r.participantId);
	const b = r.blockId ? await j.block(r.sessionId, r.blockId) : null;
	return {
		ratingId: r._id, createdAt: new Date(r.createdAt).toISOString(), kind: r.kind,
		participantId: r.participantId, ...who(s, p), sessionId: r.sessionId, blockId: r.blockId ?? null,
		source: r.source, mode: r.mode, cue: r.cue ?? null, blockIndex: b?.orderIndex ?? null,
		clarity: r.clarity ?? null, distraction: r.distraction ?? null, note: r.note ?? null,
		clearest: r.clearest ?? null, leastClear: r.leastClear ?? null, comment: r.comment ?? null
	};
}

async function blockRow(b: Doc<'blocks'>, j: Joins): Promise<Row> {
	const s = await j.session(b.sessionId);
	const p = await j.participant(b.participantId);
	const r = await j.ratingOfBlock(b.sessionId, b._id);
	const suggested = s?.cueOrder.indexOf(b.cue) ?? -1;
	return {
		blockId: b._id, startedAt: new Date(b.startedAt).toISOString(), endedAt: b.endedAt ? new Date(b.endedAt).toISOString() : null,
		participantId: b.participantId, ...who(s, p), sessionId: b.sessionId,
		source: b.source, mode: b.mode, cue: b.cue, blockIndex: b.orderIndex, suggestedPosition: suggested >= 0 ? suggested : null,
		trials: b.trialCount, engaged: b.engagedCount, deaths: b.deaths, score: b.score,
		pauses: b.pauses ?? null, pausedSeconds: b.pausedSeconds ?? null,
		clarity: r?.clarity ?? null, distraction: r?.distraction ?? null, note: r?.note ?? null,
		appVersion: s?.appVersion ?? null, inputType: s?.inputType ?? null,
		practice: b.practice ?? false, abandoned: b.abandoned ?? false
	};
}

/** The same filter applied to a rating or a block (they carry source, mode, cue, participant and session). */
function matchesRow(r: Doc<'ratings'> | Doc<'blocks'>, f: Filter, at: number, s: Doc<'sessions'> | null): boolean {
	const src = f.source ?? 'human';
	return (src === 'all' || r.source === src)
		&& (!f.mode || r.mode === f.mode)
		&& (!f.cue || r.cue === f.cue)
		&& (!f.participantId || r.participantId === f.participantId)
		&& (!f.sessionId || r.sessionId === f.sessionId)
		&& (!f.run || s?.sim?.run === f.run)
		&& (!!f.includePractice || !('practice' in r && r.practice))
		&& at >= (f.from ?? 0) && at <= (f.to ?? Number.MAX_SAFE_INTEGER);
}

function cell(x: unknown): string {
	if (x === null || x === undefined) return '';
	const s = String(x);
	return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV header line of an export (the columns of every row of that kind, in order). */
export function csvHeader(rows: Row[]): string {
	return Object.keys(rows[0]).map(cell).join(',');
}

/**
 * One page of an export. `rows` are CSV lines (no header; `header` is the header line, the same on
 * every page) or JSON objects. Keep calling with `continueCursor` until `isDone`; a page may hold
 * fewer rows than asked (rows outside the filter are skipped), even none.
 */
export const page = query({
	args: {
		...filterArgs, kind, format, paginationOpts: paginationOptsValidator,
		/**
		 * Checks only: a page asking for more rows than this fails the way an overloaded backend
		 * does, so the stream's retry at half the size can be tested (`scripts/export-e2e.mjs --squeeze`).
		 */
		failAbove: v.optional(v.number())
	},
	handler: async (ctx, { kind: k, format: fmt, paginationOpts, failAbove, ...f }) => {
		if (failAbove !== undefined && paginationOpts.numItems > failAbove) {
			throw new Error(`Simulated overload: a page of ${paginationOpts.numItems} rows is above the test limit of ${failAbove} (too many system operations)`);
		}
		// A simulator run holds simulated rows only: human rows of a run are none, so do not step
		// through the thousands of rows of the run to find that out.
		if (f.run && f.source !== 'bot' && f.source !== 'all') {
			return { header: fmt === 'csv' ? csvHeader([await emptyRow(ctx, k, fmt)]) : null, rows: [], isDone: true, continueCursor: '' };
		}
		const j = new Joins(ctx);
		let rows: Row[] = [];
		let res: { isDone: boolean; continueCursor: string };
		if (k === 'trials') {
			const p = await trialRange(ctx, f).paginate(paginationOpts);
			res = p;
			for (const t of p.page) {
				if (!matches(t, f)) continue;
				if (fmt === 'json') {
					const packed = await packedSeriesOf(ctx, t);
					const s = await j.session(t.sessionId);
					const par = await j.participant(t.participantId);
					const b = await j.block(t.sessionId, t.blockId);
					rows.push({
						...light(t), ...who(s, par), pauses: b?.pauses ?? null, pausedSeconds: b?.pausedSeconds ?? null,
						rulesVersion: t.rulesVersion ?? 1, decision: isDecision(t), series: packed ? unpackSeries(packed) : null
					});
				} else rows.push(await trialRow(t, j));
			}
		} else if (k === 'ratings') {
			// The narrowest index: one session, else one cue, else one source, in the time range.
			const src = f.source ?? 'human', from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
			const q = f.sessionId
				? ctx.db.query('ratings').withIndex('by_session', (i) => i.eq('sessionId', f.sessionId!))
				: f.cue
					? ctx.db.query('ratings').withIndex('by_cue', (i) => i.eq('cue', f.cue!).gte('createdAt', from).lte('createdAt', to))
				: src !== 'all'
					? ctx.db.query('ratings').withIndex('by_source_created', (i) => i.eq('source', src).gte('createdAt', from).lte('createdAt', to))
					: ctx.db.query('ratings');
			const p = await q.paginate(paginationOpts);
			res = p;
			for (const r of p.page) {
				if (f.run || !matchesRow(r, f, r.createdAt, null)) {
					if (!f.run || !matchesRow(r, f, r.createdAt, await j.session(r.sessionId))) continue;
				}
				rows.push(await ratingRow(r, j));
			}
		} else {
			// One session, else one source in the time range: the whole table holds thousands of simulated blocks.
			const src = f.source ?? 'human', from = f.from ?? 0, to = f.to ?? Number.MAX_SAFE_INTEGER;
			const q = f.sessionId
				? ctx.db.query('blocks').withIndex('by_session', (i) => i.eq('sessionId', f.sessionId!))
				: f.cue
					? ctx.db.query('blocks').withIndex('by_cue', (i) => i.eq('cue', f.cue!).gte('startedAt', from).lte('startedAt', to))
				: src !== 'all'
					? ctx.db.query('blocks').withIndex('by_source_started', (i) => i.eq('source', src).gte('startedAt', from).lte('startedAt', to))
					: ctx.db.query('blocks');
			const p = await q.paginate(paginationOpts);
			res = p;
			for (const b of p.page) {
				if (!matchesRow(b, f, b.startedAt, f.run ? await j.session(b.sessionId) : null)) continue;
				rows.push(await blockRow(b, j));
			}
		}
		if (fmt === 'csv') {
			// The header comes from a matching row; only a page without one reads a stand-in row.
			return { header: csvHeader([rows[0] ?? (await emptyRow(ctx, k, fmt))]), rows: rows.map((r) => Object.values(r).map(cell).join(',')), isDone: res.isDone, continueCursor: res.continueCursor };
		}
		return { header: null, rows, isDone: res.isDone, continueCursor: res.continueCursor };
	}
});

/** A row with every column, for the CSV header of an export that has no rows. */
async function emptyRow(ctx: QueryCtx, k: Kind, fmt: 'csv' | 'json'): Promise<Row> {
	if (fmt === 'json') return {};
	const j = new Joins(ctx);
	if (k === 'trials') {
		const t = await ctx.db.query('trials').first();
		return t ? trialRow(t, j) : {};
	}
	if (k === 'ratings') {
		const r = await ctx.db.query('ratings').first();
		return r ? ratingRow(r, j) : {};
	}
	const b = await ctx.db.query('blocks').first();
	return b ? blockRow(b, j) : {};
}

/** File name of a download: circle-chase-<kind>-<source>[-<run>]-<date>.<format> */
export function fileName(k: Kind, fmt: 'csv' | 'json', f: Filter): string {
	const stamp = new Date().toISOString().slice(0, 10);
	const run = f.run ? `-${f.run.replace(/[^\w-]+/g, '')}` : '';
	return `circle-chase-${k}-${f.source ?? 'human'}${run}-${stamp}.${fmt}`;
}
