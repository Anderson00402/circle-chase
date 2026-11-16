// Ad hoc diagnosis: outcome and turn-away time against the bot's own belief error. Run with DIAG=1.
import { describe, it } from 'vitest';
import { simulateBlock, type SimTrial } from './block';

declare const process: { env: Record<string, string | undefined> };

describe.runIf(process.env.DIAG)('diagnosis', () => {
	it('outcome by belief error', () => {
		const noise = +(process.env.DIAG_NOISE ?? 1.5), caution = +(process.env.DIAG_CAUTION ?? 0.3);
		const all: SimTrial[] = [];
		for (let s = 1; s <= +(process.env.DIAG_N ?? 30); s++) {
			let i = 0;
			const r = simulateBlock({ cue: 'x', seed: s * 7 + 3, seconds: 90, skill: 0.9, awareness: () => ({ noise, caution, reaction: 0.4, ignore: false }) },
				{ sessionKey: 's', blockKey: 'b', trialKey: () => 'k' + i++ });
			all.push(...r.trials);
		}
		const rated = all.filter((t) => t.measures.inRates && t.error !== null);
		const edges = [-Infinity, -2, -1, -0.5, 0, 0.5, 1, 2, Infinity];
		for (let b = 0; b + 1 < edges.length; b++) {
			const g = rated.filter((t) => t.error! >= edges[b] && t.error! < edges[b + 1]);
			if (!g.length) continue;
			const c: Record<string, number> = {};
			for (const t of g) c[t.measures.outcome] = (c[t.measures.outcome] ?? 0) + 1;
			const well = ((c['late-catch'] ?? 0) + (c['timely-retreat'] ?? 0)) / g.length;
			const turns = g.map((t) => t.measures.turnLeft).filter((x): x is number => x !== null).sort((a, b) => a - b);
			console.log(`error [${edges[b]}, ${edges[b + 1]}): n ${g.length} well ${(well * 100).toFixed(0)}% turn med ${turns[turns.length >> 1]?.toFixed(2)} ${JSON.stringify(c)}`);
		}
		const pts = rated.filter((t) => t.measures.turnLeft !== null);
		const mx = pts.reduce((a, t) => a + t.error!, 0) / pts.length, my = pts.reduce((a, t) => a + t.measures.turnLeft!, 0) / pts.length;
		let sxy = 0, sxx = 0, syy = 0;
		for (const t of pts) { const dx = t.error! - mx, dy = t.measures.turnLeft! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
		console.log(`corr(error, turnLeft) = ${(sxy / Math.sqrt(sxx * syy)).toFixed(2)} over ${pts.length}; in rates ${rated.length} of ${all.length}`);
	}, 600_000);
});
