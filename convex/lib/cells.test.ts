/**
 * The per-session totals (cells.ts) against the row-by-row arithmetic (stats.ts, compare.ts), the
 * "too early" line check against the shared classifier, and the headline's cost on a synthetic load
 * of 50,000 power-ups (pure: nothing is written to any database).
 */
import { describe, expect, it } from 'vitest';
import { cellsOfRows, clusteredRates4, isDecisionRow, lineIndex, mainOf, outcomeAt, timeToSpare, type CellRow, type CellsData, type Part } from './cells';
import { allPairs, cellsOf, RATE_INDEX } from './compare';
import { derive, type ChaseEnd, type RuleInput } from './rules';
import { clusteredRates, summarize, type TrialRow } from './stats';

const CUES = ['none', 'classic-blink', 'timer-bar', 'ink-refill', 'clock-halos', 'burning-fuse', 'wall-tide', 'heartbeat', 'waking-ghosts', 'pen-hourglass', 'deflating-player', 'final-count', 'dot-sweep'];

/** Small seeded generator, so the synthetic data is the same every run. */
function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A plausible trial: raw measures first, then the class the shared rules give them. */
function trial(r: () => number, cue: string, i: number, at: number, skill: number): CellRow {
	const total = 4 + r() * 4;
	const endReason = r() < 0.04 ? 'death' : 'expired';
	const kind = r();
	let lastChaseEnd: ChaseEnd | null = null, turnLeft: number | null = null, turnDist: number | null = null, chaseEndDist: number | null = null;
	if (kind < 0.3) lastChaseEnd = null;
	else if (kind < 0.55) {
		lastChaseEnd = 'eat';
		turnLeft = Math.round(r() * total * 100) / 100;
	} else if (kind < 0.9) {
		lastChaseEnd = 'turn';
		// Better "skill" turns closer to 1 s left.
		// Two decimals, as the tracker stores it.
		turnLeft = Math.round(Math.max(-0.5, Math.min(total, 1 + (r() - 0.5) * 6 * (1.2 - skill))) * 100) / 100;
		turnDist = r() * 6;
		chaseEndDist = turnLeft > 0 ? turnDist + r() * 3 : r() * 4;
	} else {
		lastChaseEnd = 'open';
		chaseEndDist = r() * 7;
	}
	const engaged = lastChaseEnd !== null && (lastChaseEnd === 'open' || (turnLeft !== null && turnLeft <= 3));
	const m: RuleInput = {
		endReason, engaged, after: { caught: r() < 0.08, cut: r() < 0.01 ? 'quit' : null }, endDist: r() * 8,
		lastChaseEnd, turnLeft, turnDist, chaseEndDist
	};
	const d = derive(m);
	return {
		id: `t${at}-${i}`, cue, createdAt: at, outcome: d.outcome, rulesVersion: 3, engaged, inRates: d.inRates, practice: false,
		turnLeft, wasted: d.wasted, total, trialIndex: i % 16, blockIndex: CUES.indexOf(cue), sound: r() < 0.7, inputType: r() < 0.8 ? 'keyboard' : 'touch',
		fps: 60, clip: false, caught: m.after.caught, nearMiss: r() < 0.05, gaveUpEarly: d.gaveUpEarly, mode: 'study',
		endReason, lastChaseEnd, turnDist, chaseEndDist, endDist: m.endDist, cut: m.after.cut ?? null
	};
}

/** `people` participants, one session each, `perCue` power-ups per condition. */
function synth(people: number, perCue: number, seed = 1) {
	const r = rng(seed);
	const sessions: { pid: string; rows: CellRow[] }[] = [];
	let at = 1;
	for (let p = 0; p < people; p++) {
		const rows: CellRow[] = [];
		for (const [c, cue] of CUES.entries()) for (let i = 0; i < perCue; i++) rows.push(trial(r, cue, i, at++, c / CUES.length));
		sessions.push({ pid: `p${String(p).padStart(4, '0')}`, rows });
	}
	return sessions;
}

const partsOf = (sessions: { pid: string; rows: CellRow[] }[]): Part[] =>
	sessions.map((s, i) => {
		const data = JSON.parse(JSON.stringify(cellsOfRows(s.rows, 'study'))) as CellsData;
		const cues = Object.fromEntries(Object.entries(data.groups[0].cues));
		return { pid: s.pid, sid: `s${i}`, firstAt: s.rows[0].createdAt, lastAt: s.rows[s.rows.length - 1].createdAt, cues };
	});

describe('per-session totals', () => {
	const sessions = synth(24, 16);
	const rows = sessions.flatMap((s) => s.rows.map((r) => ({ ...r, participantId: s.pid })));
	const m = mainOf(partsOf(sessions), 0);

	it('give the same counts and rates as the row-by-row summary', () => {
		const asTrial = (r: CellRow & { participantId: string }): TrialRow & { rulesVersion?: number } => ({
			cue: r.cue, participantId: r.participantId, outcome: r.outcome, engaged: r.engaged, inRates: r.inRates, rulesVersion: 3,
			lateCatch: r.outcome === 'catch' && r.turnLeft !== null && r.turnLeft <= 1.5, turnLeft: r.turnLeft, wasted: r.wasted, eats: [],
			after: { nearMiss: r.nearMiss, caught: r.caught }
		});
		for (const cue of CUES) {
			const want = summarize(cue, rows.filter((r) => r.cue === cue).map(asTrial), []);
			const got = m.cues.find((c) => c.cue === cue)!;
			for (const k of ['trials', 'engaged', 'inRates', 'decisions', 'participants', 'decisionParticipants', 'nearMisses'] as const) expect(got[k]).toBe(want[k]);
			expect(got.outcomes).toEqual(want.outcomes);
			expect(got.catches).toEqual(want.catches);
			for (const k of ['wellTimed', 'tooLate', 'caught', 'tooEarly'] as const) expect([got[k].k, got[k].n]).toEqual([want[k].k, want[k].n]);
			expect(got.turnAway.median).toBe(want.turnAway.median);
			expect(got.wasted.mean).toBe(want.wasted.mean);
		}
	});

	it('give the same paired comparisons as cells built from rows', () => {
		const dec = rows.filter(isDecisionRow);
		const want = allPairs(cellsOf(dec), m.ranked, RATE_INDEX.wellTimed);
		expect(m.pairs.wellTimed.map((x) => [x.a, x.b, x.people, x.clear])).toEqual(want.map((x) => [x.a, x.b, x.people, x.clear]));
		expect(m.pairs.wellTimed.map((x) => x.diff)).toEqual(want.map((x) => (x.diff === null ? null : Math.round(x.diff * 10000) / 10000)));
	});

	it('the 2.5 s line moves only retreats with 2 to 2.5 s left, through the shared classifier', () => {
		let moved = 0;
		for (const r of rows) {
			const alt = outcomeAt(r, lineIndex(2.5));
			if (alt !== r.outcome) {
				moved++;
				expect([r.outcome, alt]).toEqual(['early-retreat', 'timely-retreat']);
				expect(r.turnLeft! > 2 && r.turnLeft! <= 2.5).toBe(true);
			} else if (r.outcome === 'early-retreat') expect(r.turnLeft! > 2.5).toBe(true);
		}
		expect(moved).toBeGreaterThan(0);
		const m25 = mainOf(partsOf(sessions), 1);
		const shifted = rows.filter((r) => isDecisionRow(r) && outcomeAt(r, 1) !== r.outcome).length;
		expect(m25.all.wellTimed.k - m.all.wellTimed.k).toBe(shifted);
		expect(m25.all.tooEarly.k - m.all.tooEarly.k).toBe(-shifted);
		expect(m25.all.decisions).toBe(m.all.decisions);
		// A row without the raw measures falls back to the same answer.
		for (const r of rows.slice(0, 500)) {
			const bare = { ...r, endReason: undefined, lastChaseEnd: undefined, chaseEndDist: undefined };
			expect(outcomeAt(bare, 1)).toBe(outcomeAt(r, 1));
		}
	});

	it('time to spare: time left minus the time the pursuit still needed', () => {
		expect(timeToSpare({ turnLeft: 2.4, turnDist: 3, mode: 'study' }, 'early-retreat')).toBe(0.4);
		expect(timeToSpare({ turnLeft: 2.4, turnDist: 6, mode: 'study' }, 'early-retreat')).toBe(-1.6);
		expect(timeToSpare({ turnLeft: 1, turnDist: 5.6, mode: 'arcade' }, 'timely-retreat')).toBe(0);
		expect(timeToSpare({ turnLeft: 1, turnDist: 2, mode: 'study' }, 'overstayed')).toBeNull();
	});
});

describe('intervals', () => {
	it('the fast bootstrap gives exactly the numbers of stats.ts clusteredRates', () => {
		const r = rng(3);
		for (const P of [2, 3, 7, 40, 250]) {
			const cl = Array.from({ length: P }, () => {
				const n = 1 + Math.floor(r() * 12);
				const a = Math.floor(r() * (n + 1)), b = Math.floor(r() * (n - a + 1));
				return { n, k: [a, b, Math.floor(r() * (b + 1)), n - a - b] };
			});
			expect(clusteredRates4(cl, `seed${P}`)).toEqual(clusteredRates(cl, 4, `seed${P}`));
		}
	});
});

describe('headline cost on a synthetic load', () => {
	it('50,000 power-ups: totals stay small and the arithmetic stays well under the query budget', () => {
		// 250 people x 13 conditions x 16 power-ups = 52,000 power-ups, one session each.
		const sessions = synth(250, 16, 7);
		const stored = sessions.map((s) => JSON.stringify(cellsOfRows(s.rows, 'study')));
		const bytes = stored.reduce((a, s) => a + s.length, 0);
		const t0 = performance.now();
		const parts: Part[] = stored.map((s, i) => {
			const data = JSON.parse(s) as CellsData;
			return { pid: sessions[i].pid, sid: `s${i}`, firstAt: 0, lastAt: 0, cues: data.groups[0].cues };
		});
		const m = mainOf(parts, 0);
		const ms = performance.now() - t0;
		console.log(`50k: ${m.totals.trials} power-ups, ${sessions.length} totals documents, ${(bytes / 1024).toFixed(0)} KB in all (${(bytes / sessions.length / 1024).toFixed(1)} KB each), parse + headline ${ms.toFixed(0)} ms`);
		expect(m.totals.trials).toBe(52000);
		// Each session's document stays a few kilobytes, whatever the number of trials elsewhere.
		expect(bytes / sessions.length).toBeLessThan(12_000);
		// The arithmetic itself (bootstrap and every Holm family included) leaves room in a 300 ms budget.
		expect(ms).toBeLessThan(300);
	});
});
