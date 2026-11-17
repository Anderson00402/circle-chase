/**
 * Row lists shared by the per-condition charts, so every chart lists the conditions in the same
 * order: ranked (best well-timed rate first, grouped as the takeaway groups them: the top group,
 * then those clearly behind the best), then the rest in code order under a "not enough data"
 * caption; or plain code order (A, B, 0, 1-10).
 *
 * The takeaway (insight.ts) is computed once per result and shared here, so the chart's groups and
 * the sentence above it always agree.
 */
import { CONDITIONS, condition, type Condition } from '#lib/charts/encoding.ts';
import { ENOUGH, insight, RANK_PEOPLE, rankable, type Cmp, type Comparisons, type Insight } from './insight';
import type { CueRow, Main, RowOrder } from './types';

export interface OrderedRow {
	cond: Condition;
	s: CueRow | null;
	thin: boolean;
	group?: string;
	/** Marked on the ranking: 'lead' (the leaders), 'top' (the rest of the top group). */
	band?: 'lead' | 'top';
}

export const THIN_GROUP = `Not enough data yet (under ${ENOUGH} counted or ${RANK_PEOPLE} people)`;
export const TOP_GROUP = 'Top group: not clearly behind the best';
export const BEHIND_GROUP = 'Clearly behind the best';

const takes = new WeakMap<object, Insight>();
/** The takeaway of a result (cached per result object). */
export function takeOf(main: Main): Insight {
	let t = takes.get(main);
	if (!t) {
		const vs: Comparisons['vs'] = {
			'timer-bar': main.paired['timer-bar'].wellTimed as Cmp[],
			none: main.paired.none.wellTimed as Cmp[],
			'classic-blink': main.paired['classic-blink'].wellTimed as Cmp[]
		};
		t = insight(main.cues, (id) => condition(id), CONDITIONS.map((c) => c.id), { pairs: main.pairs as Comparisons['pairs'], vs, top: main.precision.top });
		takes.set(main, t);
	}
	return t;
}

export function orderedRows(cues: CueRow[], order: RowOrder, groups: Insight['groups'] = null): OrderedRow[] {
	const byId = new Map(cues.map((c) => [c.cue, c]));
	const ids = [...CONDITIONS.map((c) => c.id), ...cues.map((c) => c.cue).filter((id) => !CONDITIONS.some((c) => c.id === id))];
	const rows: OrderedRow[] = ids.map((id) => {
		const s = byId.get(id) ?? null;
		return { cond: condition(id), s, thin: !s || !rankable(s) };
	});
	if (order === 'code') return rows;
	const ranked = rows.filter((r) => !r.thin).sort((a, b) => (b.s!.wellTimed.rate ?? 0) - (a.s!.wellTimed.rate ?? 0) || a.cond.order - b.cond.order);
	const thin = rows.filter((r) => r.thin).map((r, i) => ({ ...r, group: i === 0 ? THIN_GROUP : undefined }));
	if (!groups) return [...ranked, ...thin];
	const pick = (list: string[]) => list.map((id) => ranked.find((r) => r.cond.id === id)).filter((r): r is OrderedRow => !!r);
	const top = pick(groups.top).map((r, i) => ({ ...r, band: groups.leaders.includes(r.cond.id) ? ('lead' as const) : ('top' as const), group: i === 0 ? TOP_GROUP : undefined }));
	const behind = pick(groups.behind).map((r, i) => ({ ...r, group: i === 0 ? BEHIND_GROUP : undefined }));
	const rest = ranked.filter((r) => !groups.top.includes(r.cond.id) && !groups.behind.includes(r.cond.id));
	return [...top, ...behind, ...rest, ...thin];
}
