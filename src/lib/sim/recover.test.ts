// Ad hoc: planted versus recovered without Convex, the way the dashboard compares conditions
// (paired within participants, Holm-adjusted over every pair of conditions with 10 or more
// decisions). Run with RECOVER=1 (RECOVER_PRESET, RECOVER_PEOPLE, RECOVER_POWERUPS or
// RECOVER_SECONDS, RECOVER_SEED). Lines are also written to .logs/recover.txt.
import { describe, it } from 'vitest';
import { allPairs, cellsOf, RATE_INDEX } from '#convex/lib/compare.ts';
import { isDecision } from '#convex/lib/rules.ts';
import { levelsFor, PLANTED, type Preset } from './model';
import { simulateSession } from './session';

declare const process: { env: Record<string, string | undefined> };
const nodeFs = 'node:fs';
const ENOUGH = 10;

function spearman(a: number[], b: number[]) {
	const rank = (xs: number[]) => {
		const idx = xs.map((x, i) => [x, i]).sort((p, q) => p[0] - q[0]);
		const r = new Array(xs.length);
		for (let i = 0; i < idx.length;) {
			let j = i;
			while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
			for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
			i = j + 1;
		}
		return r as number[];
	};
	const ra = rank(a), rb = rank(b), m = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
	const ma = m(ra), mb = m(rb);
	let n = 0, da = 0, db = 0;
	for (let i = 0; i < ra.length; i++) { n += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
	return da && db ? n / Math.sqrt(da * db) : 0;
}

describe.runIf(process.env.RECOVER)('recover', () => {
	it('planted versus recovered', async () => {
		const preset = (process.env.RECOVER_PRESET ?? 'planted') as Preset;
		const people = +(process.env.RECOVER_PEOPLE ?? 40);
		const powerUps = process.env.RECOVER_POWERUPS ? +process.env.RECOVER_POWERUPS : undefined;
		const seconds = process.env.RECOVER_SECONDS ? +process.env.RECOVER_SECONDS : undefined;
		const seed = +(process.env.RECOVER_SEED ?? 1);
		const cues = PLANTED.map((p) => p.cue);
		const rows: { participantId: string; cue: string; outcome: string }[] = [];
		let trials = 0, minutes = 0;
		for (let i = 0; i < people; i++) {
			const s = simulateSession({
				preset, allCues: cues, cues, run: 'r', runSeed: seed, index: i, participantNumber: i + 1,
				blockPowerUps: powerUps, blockSeconds: seconds
			});
			for (const b of s.blocks) {
				minutes += b.seconds / 60;
				for (const t of b.trials) {
					trials++;
					if (isDecision({ ...t.measures })) rows.push({ participantId: s.pid, cue: b.cue, outcome: t.measures.outcome });
				}
			}
		}
		const planted = levelsFor('planted', cues);
		const per = cues.map((cue) => {
			const d = rows.filter((r) => r.cue === cue);
			const k = (o: string[]) => d.filter((r) => o.includes(r.outcome)).length / Math.max(1, d.length);
			return { cue, noise: planted.find((p) => p.cue === cue)!.noise, n: d.length, wellTimed: k(['timely-retreat']), tooLate: k(['caught', 'overstayed']), tooEarly: k(['early-retreat']) };
		});
		const cells = cellsOf(rows);
		const ranked = per.filter((c) => c.n >= ENOUGH).map((c) => c.cue);
		const clear = (j: number) => allPairs(cells, ranked, j).filter((c) => c.clear).length;
		const of = (ranked.length * (ranked.length - 1)) / 2;
		const rho = (get: (c: (typeof per)[number]) => number) => spearman(per.map((c) => c.noise), per.map(get)).toFixed(2);
		const text = [
			`\n== ${new Date().toISOString()} ${preset} ${people} people, ${powerUps ? `${powerUps} power-ups` : `${seconds ?? 'default'} s`} per block, seed ${seed}`,
			`trials ${trials}, decisions ${rows.length} (${((rows.length / trials) * 100).toFixed(0)}%), ${(rows.length / minutes).toFixed(2)} per minute, block ${((minutes * 60) / (people * cues.length)).toFixed(0)} s on average`,
			`decisions per condition ${Math.min(...per.map((c) => c.n))}-${Math.max(...per.map((c) => c.n))}`,
			`rank correlation with planted noise: in time ${rho((c) => c.wellTimed)}, too late ${rho((c) => c.tooLate)}, too early ${rho((c) => c.tooEarly)}`,
			`pairs clear (paired, Holm): in time ${clear(RATE_INDEX.wellTimed)} of ${of}, too late ${clear(RATE_INDEX.tooLate)}, too early ${clear(RATE_INDEX.tooEarly)}`,
			...per.map((c) => `  ${c.cue.padEnd(17)} noise ${c.noise.toFixed(1)}  n ${String(c.n).padStart(4)}  in time ${(c.wellTimed * 100).toFixed(0).padStart(3)}%  too late ${(c.tooLate * 100).toFixed(0).padStart(3)}%  too early ${(c.tooEarly * 100).toFixed(0).padStart(3)}%`)
		].join('\n');
		console.log(text);
		const fs: { appendFileSync(path: string, text: string): void } = await import(/* @vite-ignore */ nodeFs);
		fs.appendFileSync('.logs/recover.txt', text + '\n');
	}, 3_600_000);
});
