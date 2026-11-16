/**
 * The replay browser's filters and sort, shared by the list (`/replays`) and the player (for its
 * previous / next links). The state lives in the URL query (`?source=bot&outcome=caught&sort=closest`)
 * so a filtered list can be shared and the player can walk through the same list. Filtering and
 * sorting happen on the server (convex/replays.ts).
 */
import type { FunctionReturnType } from 'convex/server';
import type { api } from '#convex/_generated/api.js';
import { endTimeOf } from './story';

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

/** The query arguments for convex `replays.list` / `replays.neighbours`. */
export const queryArgs = (s: ListState) => ({
	source: s.source,
	...(s.cue ? { cue: s.cue } : {}),
	...(s.outcome ? { outcome: s.outcome } : {}),
	...(s.participant ? { participant: s.participant } : {}),
	sort: s.sort
});

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

/**
 * The game time worth showing as a still: the turn-away for retreats, the last eat for a late
 * catch, just after the switch otherwise (the ghosts have just turned).
 */
export function keyTime(m: Pick<Moment, 'outcome' | 'startedAt' | 'endedAt' | 'total' | 'turnAt' | 'lastEatAt'>): number {
	if ((m.outcome === 'timely-retreat' || m.outcome === 'early-retreat') && m.turnAt !== null) return m.startedAt + m.turnAt;
	if ((m.outcome === 'catch' || m.outcome === 'late-catch') && m.lastEatAt !== null) return m.lastEatAt + 0.05;
	return endTimeOf(m) + (m.outcome === 'interrupted' ? -0.05 : 0.15);
}

/**
 * Link to a replay. `run` scopes it to one run (opened from that run's summary: "Back to run
 * summary", Previous / Next through that run); `list` carries the replay list's filter and sort.
 */
export function replayHref(trialId: string, opts: { run?: string; list?: string } = {}): string {
	if (opts.run) return `/replays/${trialId}?run=${encodeURIComponent(opts.run)}`;
	return `/replays/${trialId}${opts.list ?? ''}`;
}
