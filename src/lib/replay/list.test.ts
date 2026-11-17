import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, dashboardHref, dashboardList, dashboardReplayHref, periodStart, queryArgs, readState, toSearch } from './list';

describe('replay list state', () => {
	it('round-trips through the URL, the simulator run as "sim" (the player keeps "run" for a run summary)', () => {
		const s = { ...DEFAULT_STATE, source: 'bot' as const, run: '3allkras', mode: 'study' as const, period: '7d' as const, outcome: 'caught', dash: 'data=bot&run=3allkras' };
		const q = toSearch(s);
		expect(q).toContain('sim=3allkras');
		expect(q).not.toMatch(/[?&]run=/);
		expect(readState(new URLSearchParams(q.slice(1)))).toEqual(s);
		expect(toSearch(DEFAULT_STATE)).toBe('');
	});
	it('a replay opened from the dashboard walks the dashboard view and links back to it', () => {
		const dash = '?data=bot&run=3allkras&mode=arcade&p=abc&period=today&cue=heartbeat';
		const s = dashboardList(dash);
		expect(s).toMatchObject({ source: 'bot', run: '3allkras', mode: 'arcade', participant: 'abc', period: 'today', cue: '' });
		expect(dashboardList(dash, 'heartbeat').cue).toBe('heartbeat');
		expect(dashboardHref(s)).toBe(`/dashboard${dash}`);
		const href = dashboardReplayHref('kn7x', dash);
		expect(href.startsWith('/replays/kn7x?')).toBe(true);
		expect(readState(new URL(href, 'http://x').searchParams)).toEqual(s);
		// Human data ignores a simulator run; "all" participants is no filter.
		expect(dashboardList('?run=x&p=all')).toMatchObject({ source: 'human', run: '', participant: '' });
	});
	it('sends the run, rules and period to the server, the period as a start time that holds for an hour', () => {
		const a = queryArgs({ ...DEFAULT_STATE, source: 'bot', run: 'r1', mode: 'study', period: '7d' });
		expect(a).toMatchObject({ source: 'bot', run: 'r1', mode: 'study' });
		expect(typeof a.from).toBe('number');
		const now = Date.UTC(2026, 10, 16, 10, 20);
		expect(periodStart('7d', now)).toBe(periodStart('7d', now + 30 * 60_000));
		expect(periodStart('', now)).toBeUndefined();
		expect(queryArgs(DEFAULT_STATE)).toEqual({ source: 'human', sort: 'newest' });
	});
});
