// Ad hoc calibration: how the bot's awareness noise maps to the measured outcomes. Run with CAL=1.
import { describe, it } from 'vitest';

declare const process: { env: Record<string, string | undefined> };
import { summarize } from '#convex/lib/stats.ts';
import { simulateBlock } from './block';

describe.runIf(process.env.CAL)('calibration', () => {
	it('noise vs outcomes', () => {
		const levels = (process.env.CAL_LEVELS ?? '0,0.4,0.8,1.2,1.8,2.5').split(',').map(Number);
		const caution = +(process.env.CAL_CAUTION ?? 0.5);
		const n = +(process.env.CAL_N ?? 8);
		const reaction = +(process.env.CAL_REACTION ?? 0.3);
		for (const noise of levels) {
			const t0 = performance.now();
			const rows = [];
			for (let s = 1; s <= n; s++) {
				let i = 0;
				const r = simulateBlock(
					{ cue: 'x', seed: s * 31 + Math.round(noise * 10), seconds: 90, skill: 0.95, awareness: () => ({ noise, caution, reaction, ignore: false }) },
					{ sessionKey: 's', blockKey: 'b', trialKey: () => 'k' + i++ }
				);
				for (const t of r.trials) rows.push({ ...t.measures, cue: 'x', participantId: 'p' + s });
			}
			const ms = performance.now() - t0;
			const sm = summarize('x', rows, []);
			console.log(`noise ${noise} caution ${caution} reaction ${reaction}: trials ${sm.trials} inRates ${sm.inRates} caught ${((sm.caught.rate ?? 0) * 100).toFixed(0)}% well ${((sm.wellTimed.rate ?? 0) * 100).toFixed(0)}% turn med ${sm.turnAway.median} ${JSON.stringify(sm.outcomes)} ${(ms / n).toFixed(0)} ms/block`);
		}
	}, 600_000);
});
