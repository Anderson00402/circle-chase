/**
 * Row lists shared by the per-condition charts, so every chart lists the conditions in the same
 * order: ranked (enough decision trials, best well-timed rate first, then the rest in code order under a
 * "not enough data" caption) or plain code order (A, B, 0, 1-10).
 */
import { CONDITIONS, condition, type Condition } from '#lib/charts/encoding.ts';
import { ENOUGH } from './insight';
import type { CueRow, RowOrder } from './types';

export interface OrderedRow {
	cond: Condition;
	s: CueRow | null;
	thin: boolean;
	group?: string;
}

export const THIN_GROUP = `Not enough data yet (under ${ENOUGH} counted)`;

export function orderedRows(cues: CueRow[], order: RowOrder): OrderedRow[] {
	const byId = new Map(cues.map((c) => [c.cue, c]));
	const ids = [...CONDITIONS.map((c) => c.id), ...cues.map((c) => c.cue).filter((id) => !CONDITIONS.some((c) => c.id === id))];
	const rows = ids.map((id) => {
		const s = byId.get(id) ?? null;
		return { cond: condition(id), s, thin: (s?.decisions ?? 0) < ENOUGH };
	});
	if (order === 'code') return rows;
	const ranked = rows.filter((r) => !r.thin).sort((a, b) => (b.s!.wellTimed.rate ?? 0) - (a.s!.wellTimed.rate ?? 0) || a.cond.order - b.cond.order);
	const thin = rows.filter((r) => r.thin);
	return [...ranked, ...thin.map((r, i) => ({ ...r, group: i === 0 ? THIN_GROUP : undefined }))];
}
