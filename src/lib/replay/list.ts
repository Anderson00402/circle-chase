/**
 * The replay browser's filters and sorts, shared by the list (`/replays`) and the player (for its
 * previous / next links). The state lives in the URL query (`?source=bot&outcome=caught&sort=closest`)
 * so a filtered list can be shared and the player can walk through the same list.
 */
import type { FunctionReturnType } from 'convex/server';
import type { api } from '#convex/_generated/api.js';

export type Moment = FunctionReturnType<typeof api.replays.list>['rows'][number];
export type Source = 'human' | 'bot' | 'all';
export type Sort = 'newest' | 'closest' | 'caught' | 'turn-early' | 'turn-late';

export interface ListState {
	source: Source;
	cue: string;
	outcome: string;
	/** Participant number as text, '' for everyone. */
	participant: string;
	sort: Sort;
}

export const SORTS: { value: Sort; label: string }[] = [
	{ value: 'newest', label: 'Newest first' },
	{ value: 'closest', label: 'Closest calls first' },
	{ value: 'caught', label: 'Caught first' },
	{ value: 'turn-early', label: 'Earliest turn-away first' },
	{ value: 'turn-late', label: 'Latest turn-away first' }
];

export const DEFAULT_STATE: ListState = { source: 'human', cue: '', outcome: '', participant: '', sort: 'newest' };

export function readState(sp: Pick<URLSearchParams, 'get'>, fallbackSource: Source = 'human'): ListState {
	const src = sp.get('source');
	const sort = sp.get('sort') as Sort | null;
	return {
		source: src === 'human' || src === 'bot' || src === 'all' ? src : fallbackSource,
		cue: sp.get('cue') ?? '',
		outcome: sp.get('outcome') ?? '',
		participant: sp.get('p') ?? '',
		sort: sort && SORTS.some((s) => s.value === sort) ? sort : 'newest'
	};
}

/** Query string for a state, leaving out defaults ('' when everything is default). */
export function toSearch(s: ListState): string {
	const sp = new URLSearchParams();
	if (s.source !== 'human') sp.set('source', s.source);
	if (s.cue) sp.set('cue', s.cue);
	if (s.outcome) sp.set('outcome', s.outcome);
	if (s.participant) sp.set('p', s.participant);
	if (s.sort !== 'newest') sp.set('sort', s.sort);
	const q = sp.toString();
	return q ? '?' + q : '';
}

const nullsLast = (a: number | null, b: number | null, dir: 1 | -1) =>
	a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : (a - b) * dir;

export function sortMoments(rows: Moment[], sort: Sort): Moment[] {
	const out = [...rows];
	const newest = (a: Moment, b: Moment) => b.createdAt - a.createdAt;
	switch (sort) {
		case 'closest': return out.sort((a, b) => nullsLast(a.endDist, b.endDist, 1) || newest(a, b));
		case 'caught': return out.sort((a, b) => Number(b.caught) - Number(a.caught) || nullsLast(a.timeToCaught, b.timeToCaught, 1) || newest(a, b));
		case 'turn-early': return out.sort((a, b) => nullsLast(a.turnLeft, b.turnLeft, -1) || newest(a, b));
		case 'turn-late': return out.sort((a, b) => nullsLast(a.turnLeft, b.turnLeft, 1) || newest(a, b));
		default: return out.sort(newest);
	}
}

/** Rows matching the cue, outcome and participant filters (the source is filtered by the query). */
export function filterMoments(rows: Moment[], s: Pick<ListState, 'cue' | 'outcome' | 'participant'>): Moment[] {
	return rows.filter((r) =>
		(!s.cue || r.cue === s.cue) &&
		(!s.outcome || r.outcome === s.outcome) &&
		(!s.participant || String(r.participant) === s.participant)
	);
}

export const applyList = (rows: Moment[], s: ListState) => sortMoments(filterMoments(rows, s), s.sort);

/**
 * The game time worth showing as a still: the turn-away for retreats, the last eat for a late
 * catch, just after the switch otherwise (the ghosts have just turned).
 */
export function keyTime(m: Pick<Moment, 'outcome' | 'startedAt' | 'endedAt' | 'turnAt' | 'lastEatAt'>): number {
	if ((m.outcome === 'timely-retreat' || m.outcome === 'early-retreat') && m.turnAt !== null) return m.startedAt + m.turnAt;
	if (m.outcome === 'late-catch' && m.lastEatAt !== null) return m.lastEatAt + 0.05;
	return m.endedAt + 0.15;
}
