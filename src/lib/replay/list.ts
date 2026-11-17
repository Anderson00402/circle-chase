/**
 * The replay browser's filters and sort, shared by the list (`/replays`) and the player (for its
 * previous / next links). The state lives in the URL query (`?source=bot&outcome=caught&sort=closest`, plus `sim`, `mode`, `period` and `dash` when opened from the dashboard)
 * so a filtered list can be shared and the player can walk through the same list. Filtering and
 * sorting happen on the server (convex/replays.ts).
 */
import type { FunctionReturnType } from 'convex/server';
import type { api } from '#convex/_generated/api.js';
import { endTimeOf } from './story';

export type Moment = FunctionReturnType<typeof api.replays.list>['rows'][number];
export type Source = 'human' | 'bot' | 'all';
export type Sort = 'newest' | 'closest' | 'caught' | 'turn-early' | 'turn-late';

export type Period = '' | 'today' | '7d' | '30d';
export type Rules = '' | 'study' | 'arcade';

export interface ListState {
	source: Source;
	cue: string;
	outcome: string;
	/** Participant id (`participants` document id), '' for everyone. */
	participant: string;
	/**
	 * One simulator run ('other': simulated play outside any run), '' for all. Set when opened from
	 * the dashboard. In the URL as `sim` (`run` is the run console's block on the player).
	 */
	run: string;
	/** Study or arcade rules only, '' for both. */
	mode: Rules;
	/** Recorded today or in the last 7 or 30 days, '' for any time (the dashboard's period). */
	period: Period;
	/** The dashboard view (its query string, without "?") this list was opened from, '' when not. */
	dash: string;
	sort: Sort;
}

export const SORTS: { value: Sort; label: string }[] = [
	{ value: 'newest', label: 'Newest first' },
	{ value: 'closest', label: 'Closest calls first' },
	{ value: 'caught', label: 'Caught first' },
	{ value: 'turn-early', label: 'Earliest turn-away first' },
	{ value: 'turn-late', label: 'Latest turn-away first' }
];

export const DEFAULT_STATE: ListState = { source: 'human', cue: '', outcome: '', participant: '', run: '', mode: '', period: '', dash: '', sort: 'newest' };

const PERIODS: Period[] = ['today', '7d', '30d'];
export const PERIOD_LABEL: Record<Exclude<Period, ''>, string> = { today: 'today', '7d': 'the last 7 days', '30d': 'the last 30 days' };

/**
 * Start of a period in ms. Rounded down to the hour for the rolling ones, so the query arguments
 * stay the same (and the answer cached) while the page is open.
 */
export function periodStart(p: Period, now = Date.now()): number | undefined {
	if (p === 'today') { const d = new Date(now); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
	const hour = Math.floor(now / 3_600_000) * 3_600_000;
	return p === '7d' ? hour - 7 * 864e5 : p === '30d' ? hour - 30 * 864e5 : undefined;
}

export function readState(sp: Pick<URLSearchParams, 'get'>, fallbackSource: Source = 'human'): ListState {
	const src = sp.get('source');
	const sort = sp.get('sort') as Sort | null;
	return {
		source: src === 'human' || src === 'bot' || src === 'all' ? src : fallbackSource,
		cue: sp.get('cue') ?? '',
		outcome: sp.get('outcome') ?? '',
		participant: sp.get('p') ?? '',
		run: sp.get('sim') ?? '',
		mode: sp.get('mode') === 'study' || sp.get('mode') === 'arcade' ? (sp.get('mode') as Rules) : '',
		period: PERIODS.includes(sp.get('period') as Period) ? (sp.get('period') as Period) : '',
		dash: sp.get('dash') ?? '',
		sort: sort && SORTS.some((s) => s.value === sort) ? sort : 'newest'
	};
}

/**
 * The list a replay opened from the dashboard walks: the dashboard's data, simulator run, rules,
 * participant, period and (when given) condition, and the dashboard view itself for the way back.
 * `dashSearch` is the dashboard's query string (`page.url.search`).
 */
export function dashboardList(dashSearch: string, cue?: string): ListState {
	const d = new URLSearchParams(dashSearch.replace(/^\?/, ''));
	const source: Source = d.get('data') === 'bot' ? 'bot' : 'human';
	const mode = d.get('mode');
	const p = d.get('p');
	return {
		...DEFAULT_STATE,
		source,
		cue: cue ?? '',
		participant: p && p !== 'all' ? p : '',
		run: source === 'bot' ? (d.get('run') ?? '') : '',
		mode: mode === 'study' || mode === 'arcade' ? mode : '',
		period: PERIODS.includes(d.get('period') as Period) ? (d.get('period') as Period) : '',
		dash: d.toString()
	};
}

/** Link to a replay from the dashboard: Previous / Next walk the dashboard's view, and a link goes back to it. */
export const dashboardReplayHref = (trialId: string, dashSearch: string, cue?: string) =>
	`/replays/${trialId}${toSearch(dashboardList(dashSearch, cue))}`;

/** The dashboard view a list came from, or the dashboard as it was last left. */
export const dashboardHref = (s: Pick<ListState, 'dash'>) => (s.dash ? `/dashboard?${s.dash}` : '/dashboard');

/** The filters this list has beyond the replay page's own controls (set by the dashboard), in words. */
export function dashboardScope(s: ListState, runLabel?: string): string[] {
	const out: string[] = [];
	if (s.run) out.push(s.run === 'other' ? 'simulated play outside any run' : `simulator run ${runLabel ?? s.run}`);
	if (s.mode) out.push(s.mode === 'arcade' ? 'arcade rules' : 'study rules');
	if (s.period) out.push(`recorded ${PERIOD_LABEL[s.period]}`);
	return out;
}

/** The query arguments for convex `replays.list` / `replays.neighbours`. */
export const queryArgs = (s: ListState) => ({
	source: s.source,
	...(s.cue ? { cue: s.cue } : {}),
	...(s.outcome ? { outcome: s.outcome } : {}),
	...(s.participant ? { participant: s.participant } : {}),
	...(s.run ? { run: s.run } : {}),
	...(s.mode ? { mode: s.mode } : {}),
	...(s.period ? { from: periodStart(s.period) } : {}),
	sort: s.sort
});

/** Query string for a state, leaving out defaults ('' when everything is default). */
export function toSearch(s: ListState): string {
	const sp = new URLSearchParams();
	if (s.source !== 'human') sp.set('source', s.source);
	if (s.cue) sp.set('cue', s.cue);
	if (s.outcome) sp.set('outcome', s.outcome);
	if (s.participant) sp.set('p', s.participant);
	if (s.run) sp.set('sim', s.run);
	if (s.mode) sp.set('mode', s.mode);
	if (s.period) sp.set('period', s.period);
	if (s.sort !== 'newest') sp.set('sort', s.sort);
	if (s.dash) sp.set('dash', s.dash);
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
