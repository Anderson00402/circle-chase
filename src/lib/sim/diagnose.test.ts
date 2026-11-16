// Ad hoc diagnosis: outcome and turn-away time against the bot's own belief error. Run with DIAG=1
// (DIAG_NOISE, DIAG_CAUTION, DIAG_N); the lines are also written to .logs/diagnose.txt.
import { describe, it } from 'vitest';
import { simulateBlock, type SimTrial } from './block';

declare const process: { env: Record<string, string | undefined> };

// Node's file module, without needing its type package.
const nodeFs = 'node:fs';
let lines: string[] = [];
const say = (line: string) => { console.log(line); lines.push(line); };

describe.runIf(process.env.DIAG)('diagnosis', () => {
	it('outcome by belief error', async () => {
		lines = [];
		const noise = +(process.env.DIAG_NOISE ?? 1.5), caution = +(process.env.DIAG_CAUTION ?? 0.3);
		say(`\n== noise ${noise} caution ${caution}`);
		const all: SimTrial[] = [];
		for (let s = 1; s <= +(process.env.DIAG_N ?? 30); s++) {
			let i = 0;
			const r = simulateBlock({ cue: 'x', seed: s * 7 + 3, seconds: 90, skill: 0.9, awareness: () => ({ noise, caution, reaction: 0.4, ignore: false }) },
				{ sessionKey: 's', blockKey: 'b', trialKey: () => 'k' + i++ });
			all.push(...r.trials);
		}
		const rated = all.filter((t) => t.measures.inRates && t.error !== null);
		const DECISION = ['caught', 'overstayed', 'timely-retreat', 'early-retreat'];
		const edges = [-Infinity, -2, -1, -0.5, 0, 0.5, 1, 2, Infinity];
		for (let b = 0; b + 1 < edges.length; b++) {
			const g = rated.filter((t) => t.error! >= edges[b] && t.error! < edges[b + 1]);
			if (!g.length) continue;
			const c: Record<string, number> = {};
			for (const t of g) c[t.measures.outcome] = (c[t.measures.outcome] ?? 0) + 1;
			// Rates over decision trials (convex/lib/rules.ts); catches are counted apart.
			const d = g.filter((t) => DECISION.includes(t.measures.outcome)).length;
			const share = (k: number) => (d ? `${((k / d) * 100).toFixed(0)}%` : '-');
			const late = (c['caught'] ?? 0) + (c['overstayed'] ?? 0);
			const turns = g.filter((t) => DECISION.includes(t.measures.outcome)).map((t) => t.measures.turnLeft).filter((x): x is number => x !== null).sort((a, b) => a - b);
			say(`error [${edges[b]}, ${edges[b + 1]}): n ${g.length} decisions ${d} in time ${share(c['timely-retreat'] ?? 0)} too late ${share(late)} (caught ${share(c['caught'] ?? 0)}) too early ${share(c['early-retreat'] ?? 0)} catches ${c['catch'] ?? 0} turn med ${turns[turns.length >> 1]?.toFixed(2)} ${JSON.stringify(c)}`);
		}
		const pts = rated.filter((t) => t.measures.turnLeft !== null);
		const mx = pts.reduce((a, t) => a + t.error!, 0) / pts.length, my = pts.reduce((a, t) => a + t.measures.turnLeft!, 0) / pts.length;
		let sxy = 0, sxx = 0, syy = 0;
		for (const t of pts) { const dx = t.error! - mx, dy = t.measures.turnLeft! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
		say(`corr(error, turnLeft) = ${(sxy / Math.sqrt(sxx * syy)).toFixed(2)} over ${pts.length}; in rates ${rated.length} of ${all.length}`);
		const fs: { appendFileSync(path: string, text: string): void } = await import(/* @vite-ignore */ nodeFs);
		fs.appendFileSync('.logs/diagnose.txt', lines.join('\n') + '\n');
	}, 600_000);
});
