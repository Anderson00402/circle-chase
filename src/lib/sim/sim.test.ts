import { describe, expect, it } from 'vitest';
import { decodeClip } from '../telemetry/recorder';
import { cueOrder, seededShuffle, williamsRow } from './order';
import {
	blockRatings, drawProfile, FLAT_NOISE, IGNORE_CAUTION, levelsFor, PLANTED, trialAwareness, type Profile
} from './model';
import { BLOCK_POWER_UPS, simulateSession } from './session';
import { RUN_LENGTH } from '../study/length';
import { makeRng } from '../game/engine/game';

const ALL = PLANTED.map((p) => p.cue);

describe('cue order', () => {
	it('every Williams row is a permutation', () => {
		for (const n of [4, 5, 13]) for (let r = 0; r < 2 * n; r++) expect([...williamsRow(n, r)].sort((a, b) => a - b)).toEqual([...Array(n).keys()]);
	});

	it('balances first-order carry-over: even n once per n rows, odd n twice per 2n rows', () => {
		for (const [n, rows, times] of [[4, 4, 1], [6, 6, 1], [13, 26, 2]] as const) {
			const pairs = new Map<string, number>();
			for (let r = 0; r < rows; r++) {
				const row = williamsRow(n, r);
				for (let i = 0; i + 1 < n; i++) pairs.set(`${row[i]}>${row[i + 1]}`, (pairs.get(`${row[i]}>${row[i + 1]}`) ?? 0) + 1);
			}
			expect(pairs.size).toBe(n * (n - 1));
			expect([...pairs.values()].every((c) => c === times)).toBe(true);
		}
	});

	it('every condition is in every position equally often over a full square', () => {
		const counts = ALL.map(() => new Array(ALL.length).fill(0));
		for (let p = 1; p <= 26; p++) cueOrder(ALL, ALL, p, 1).forEach((c, pos) => counts[ALL.indexOf(c)][pos]++);
		expect(counts.flat().every((c) => c === 2)).toBe(true);
	});

	it('all conditions: the Latin row of the participant number, whatever the seed', () => {
		expect(cueOrder(ALL, ALL, 3, 1)).toEqual(cueOrder(ALL, ALL, 3, 99));
		expect(cueOrder(ALL, ALL, 3, 1)).not.toEqual(cueOrder(ALL, ALL, 4, 1));
	});

	it('a subset: a seeded shuffle of just those conditions', () => {
		const sub = ['none', 'timer-bar', 'heartbeat', 'dot-sweep'];
		const a = cueOrder(ALL, sub, 1, 5);
		expect([...a].sort()).toEqual([...sub].sort());
		expect(cueOrder(ALL, sub, 1, 5)).toEqual(a);
		const orders = new Set([1, 2, 3, 4, 5, 6].map((p) => cueOrder(ALL, sub, p, 5).join()));
		expect(orders.size).toBeGreaterThan(1);
		expect(seededShuffle([1, 2, 3], 1)).toEqual(seededShuffle([1, 2, 3], 1));
	});
});

describe('awareness model', () => {
	const steady: Profile = { ...drawProfile(1, 13), noiseScale: 1, learning: 0, ignoreRate: 0, caution: 0.3 };
	const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
	const noiseOf = (cue: string, preset: 'flat' | 'planted', p = steady, at = 100) => {
		const level = levelsFor(preset, [cue])[0];
		const rng = makeRng(7);
		return mean(Array.from({ length: 400 }, () => trialAwareness(p, level, at, rng).noise));
	};

	it('flat gives every condition the same level', () => {
		const levels = levelsFor('flat', ALL);
		expect(new Set(levels.map((l) => l.noise))).toEqual(new Set([FLAT_NOISE]));
		expect(noiseOf('none', 'flat')).toBeCloseTo(noiseOf('timer-bar', 'flat'), 5);
	});

	it('planted follows the declared table', () => {
		expect(noiseOf('timer-bar', 'planted')).toBeLessThan(noiseOf('classic-blink', 'planted'));
		expect(noiseOf('classic-blink', 'planted')).toBeLessThan(noiseOf('none', 'planted'));
		expect(noiseOf('timer-bar', 'planted')).toBeCloseTo(0.3, 1);
	});

	it('learning: noise is larger early in the session and settles', () => {
		const learner = { ...steady, learning: 0.5 };
		expect(noiseOf('heartbeat', 'planted', learner, 0)).toBeGreaterThan(noiseOf('heartbeat', 'planted', learner, 80) * 1.3);
	});

	it('ignored power-ups get a caution that keeps the bot away', () => {
		const lazy = { ...steady, ignoreRate: 1 };
		const a = trialAwareness(lazy, PLANTED[0], 0, makeRng(1));
		expect(a.ignore).toBe(true);
		expect(a.caution).toBe(IGNORE_CAUTION);
	});

	it('profiles are reproducible and varied', () => {
		expect(drawProfile(42, 13)).toEqual(drawProfile(42, 13));
		const ps = Array.from({ length: 200 }, (_, i) => drawProfile(i, 13));
		expect(new Set(ps.map((p) => p.skill)).size).toBeGreaterThan(20);
		const quit = ps.filter((p) => p.quitAfter !== null).length;
		expect(quit).toBeGreaterThan(10);
		expect(quit).toBeLessThan(70);
		expect(ps.every((p) => p.quitAfter === null || (p.quitAfter >= 1 && p.quitAfter < 13))).toBe(true);
	});

	it('ratings follow the planted level', () => {
		const rng = makeRng(3);
		const clarity = (cue: string) => mean(Array.from({ length: 300 }, () => blockRatings(steady, levelsFor('planted', [cue])[0], rng).clarity));
		expect(clarity('timer-bar')).toBeGreaterThan(clarity('none') + 2);
		const r = blockRatings(steady, PLANTED[0], rng);
		expect(r.clarity).toBeGreaterThanOrEqual(1);
		expect(r.distraction).toBeLessThanOrEqual(7);
	});
});

describe('simulated session', () => {
	const opts = {
		preset: 'planted' as const, allCues: ALL, cues: ['none', 'timer-bar', 'heartbeat'], run: 'test',
		runSeed: 11, index: 0, participantNumber: 1, blockSeconds: 40
	};
	const fingerprint = (s: ReturnType<typeof simulateSession>) => JSON.stringify(s.blocks.map((b) => b.trials.map((t) => ({
		...t.measures, clip: t.args.clip ? t.args.clip.data.byteLength : 0, series: t.args.series.byteLength, key: t.args.key
	}))));

	it('is reproducible for a seed and differs for another', () => {
		const a = simulateSession(opts), b = simulateSession(opts);
		expect(fingerprint(a)).toBe(fingerprint(b));
		expect(a.cueOrder).toEqual(b.cueOrder);
		const c = simulateSession({ ...opts, runSeed: 12 });
		expect(fingerprint(c)).not.toBe(fingerprint(a));
	});

	it('has the shape of a real session: keys, trial indices, clips that decode, the sim record', () => {
		const s = simulateSession(opts);
		expect(s.sim.preset).toBe('planted');
		expect(s.sim.planted.map((p) => p.cue).sort()).toEqual([...opts.cues].sort());
		expect(s.blocks.length).toBe(s.sim.profile.quitAfter ?? 3);
		const trials = s.blocks.flatMap((b) => b.trials);
		expect(trials.length).toBeGreaterThan(3);
		for (const b of s.blocks) {
			b.trials.forEach((t, i) => {
				expect(t.args.trialIndex).toBe(i);
				expect(t.args.blockKey).toBe(b.key);
				expect(t.args.sessionKey).toBe(s.key);
				expect(t.awareness).not.toBeNull();
			});
		}
		expect(new Set(trials.map((t) => t.args.key)).size).toBe(trials.length);
		const withClip = trials.filter((t) => t.args.clip);
		expect(withClip.length).toBeGreaterThan(0);
		for (const t of trials) if (t.measures.engaged || t.measures.after.caught) expect(t.args.clip).toBeDefined();
		const d = decodeClip(withClip[0].args.clip!);
		expect(d.scenes.length).toBeGreaterThan(20);
		expect(d.meta.cue).toBe(withClip[0].args.clip!.cue);
	});

	it('by default a block ends once the run length in power-ups has been measured, as a human run does', () => {
		const s = simulateSession({ ...opts, blockSeconds: undefined, blockPowerUps: 5, cues: ['timer-bar'] });
		const b = s.blocks[0];
		expect(b.trials).toHaveLength(5);
		// The last power-up was measured to its end: the block stopped when its trial closed.
		expect(b.trials.at(-1)!.measures.endReason).not.toBe('quit');
		expect(b.seconds).toBeGreaterThan(5 * 6);
		expect(b.seconds).toBeLessThan(5 * 40);
		// The planned default is the run console's.
		expect(BLOCK_POWER_UPS).toBe(RUN_LENGTH);
	});
});
