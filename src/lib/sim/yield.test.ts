// Ad hoc: where power-ups go under study rules, and how many end in a decision. Run with YIELD=1
// (YIELD_BLOCKS, default 120 blocks of 90 s). Lines are also written to .logs/yield.txt.
import { describe, it } from 'vitest';
import { measureYield, yieldTable, type YieldOptions } from './yield';

declare const process: { env: Record<string, string | undefined> };
const nodeFs = 'node:fs';

describe.runIf(process.env.YIELD)('yield', () => {
	it('places of power-ups', async () => {
		const blocks = +(process.env.YIELD_BLOCKS ?? 120);
		const variants: Record<string, Partial<YieldOptions>> = JSON.parse(process.env.YIELD_VARIANTS ?? '{"today":{}}');
		const rows = Object.entries(variants).map(([name, v]) => {
			const t0 = performance.now();
			const r = measureYield({ blocks, ...v });
			console.log(`${name}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
			return { name, r };
		});
		const text = `\n== ${new Date().toISOString()} ${blocks} blocks\n` + yieldTable(rows);
		console.log(text);
		const fs: { appendFileSync(path: string, text: string): void } = await import(/* @vite-ignore */ nodeFs);
		fs.appendFileSync('.logs/yield.txt', text + '\n');
	}, 3_600_000);
});
