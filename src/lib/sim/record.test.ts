import { describe, expect, it } from 'vitest';
import { simulateBlock } from './block';
import { decodeChunk } from '../telemetry/runrec';

const plan = { cue: 'timer-bar', seed: 4, seconds: 40, skill: 0.9, awareness: () => ({ noise: 0.5, caution: 0.3, reaction: 0.3, ignore: false }) };
const keys = (k: string) => ({ sessionKey: 's', blockKey: k, trialKey: (() => { let n = 0; return () => `${k}:t${++n}`; })() });

describe('simulated blocks and full-run recordings', () => {
	it('store no full-run recording by default', () => {
		expect(simulateBlock(plan, keys('a')).chunks).toBeUndefined();
	});
	it('record the whole block when asked, with its trials placed', () => {
		const r = simulateBlock({ ...plan, recordRun: true }, keys('b'));
		expect(r.chunks!.length).toBeGreaterThanOrEqual(7);
		expect(r.chunks!.map((c) => c.i)).toEqual(r.chunks!.map((_, i) => i));
		const listed = r.chunks!.flatMap((c) => c.trials ?? []);
		expect(listed).toEqual(r.trials.map((t) => t.args.key));
		expect(decodeChunk(r.chunks![2]).scenes.length).toBeGreaterThan(40);
	});
});
