#!/usr/bin/env node
// Fill the database with simulated (bot) study sessions by driving /dev/simulate in a headless
// Chrome, then print planted vs recovered for the run (dashboard.simCheck): the headline rates over
// decision trials with participant-clustered intervals, and their rank correlations with the plant.
//
//   node scripts/simulate.mjs --preset planted --participants 24
//   node scripts/simulate.mjs --preset flat --participants 10 --cues none,timer-bar,heartbeat --seed 7
//   node scripts/simulate.mjs --fresh ...     delete all bot data first
//   node scripts/simulate.mjs --summary       only print the summary (newest run, or --run <id>)
//
// Simulated data is recorded as source: bot and never mixed with human data. A bot cannot see a
// cue: the planted preset only checks that the pipeline can recover a difference we put in.
// The dev server must be running on :5173 (and Convex on :3210). Exits non-zero on failure.
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def; };
const flag = (name) => argv.includes('--' + name);

const preset = opt('preset', 'planted');
const participants = +opt('participants', 24);
const seed = opt('seed', undefined);
const cues = opt('cues', 'all');
const base = opt('url', 'http://localhost:5173');
const timeout = +opt('timeout', 30 * 60) * 1000;

if (!['planted', 'flat'].includes(preset)) fail(`unknown preset "${preset}" (planted or flat)`);
if (!(participants >= 1)) fail('--participants must be at least 1');

function fail(msg) {
	console.error('simulate: ' + msg);
	process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome' });
let code = 0;
try {
	const page = await browser.newPage();
	page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
	page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE ERROR:', m.text().slice(0, 300)); });
	await page.goto(base + '/dev/simulate', { waitUntil: 'networkidle' });
	await page.waitForFunction(() => window.__simulate, null, { timeout: 15000 });

	if (flag('fresh')) {
		process.stdout.write('Deleting existing bot data');
		await page.evaluate(() => window.__simulate.deleteBots());
		for (let i = 0; i < 120; i++) {
			const c = await page.evaluate(() => window.__simulate.counters());
			if (c.trials === 0 && c.sessions === 0) break;
			process.stdout.write('.');
			await page.waitForTimeout(500);
		}
		console.log(' done');
	}

	let result = null;
	if (!flag('summary')) {
		const opts = { preset, participants, ...(seed !== undefined ? { seed: +seed } : {}), ...(cues !== 'all' ? { cues: cues.split(',') } : {}) };
		console.log(`Simulating ${participants} participants, preset ${preset}, ${cues === 'all' ? 'all 13 conditions' : cues}`);
		await page.evaluate((o) => { window.__simRun = window.__simulate.run(o); }, opts);
		const until = Date.now() + timeout;
		let last = -1;
		for (;;) {
			await page.waitForTimeout(500);
			const p = await page.evaluate(() => window.__simulate.progress);
			if (p && p.done !== last) {
				last = p.done;
				console.log(`  ${p.done}/${p.participants} participants, ${p.trials} trials (${p.engaged} engaged, ${p.clips} clips), ${(p.elapsedMs / 1000).toFixed(1)} s`);
			}
			if (p && p.state !== 'running') { result = p; break; }
			if (Date.now() > until) { await page.evaluate(() => window.__simulate.stop()); fail('timed out'); }
		}
		if (result.state !== 'done') {
			console.error(`Run ${result.run} ${result.state}: ${result.error ?? ''}`);
			code = 1;
		} else {
			console.log(`Run ${result.run} (seed ${result.seed}) done in ${(result.elapsedMs / 1000).toFixed(1)} s: ${result.blocks} blocks, ${result.trials} trials, ${result.clips} clips.`);
			console.log('Outcomes: ' + Object.entries(result.outcomes).map(([k, v]) => `${k} ${v}`).join(', '));
		}
	}

	// ----- summary: planted vs recovered for this run (or the newest), as the dashboard computes it -----
	const check = await page.evaluate((run) => window.__simulate.check(run), result?.run ?? opt('run', undefined));
	printCheck(check);
} catch (err) {
	console.error('simulate:', err instanceof Error ? err.message : err);
	code = 1;
} finally {
	await browser.close();
}
process.exit(code);

function printCheck(d) {
	if (!d || !d.run) { console.log('\nNo simulator run found.'); return; }
	console.log(`\nRun ${d.run} (${d.preset}): ${d.trials} trials from ${d.participants} simulated participants. Other runs: ${d.runs.filter((r) => r.run !== d.run).map((r) => `${r.run} (${r.preset})`).join(', ') || 'none'}.`);
	console.log('Rates over decision trials (turned away in time, too early, stayed too long, caught); intervals clustered by participant.');
	const pct = (r) => (r.rate === null ? '  -  ' : `${(r.rate * 100).toFixed(0).padStart(3)}% [${(r.lo * 100).toFixed(0)}-${(r.hi * 100).toFixed(0)}]`);
	const head = ['condition', 'planted noise', 'people', 'counted', 'in time [95% CI]', 'too late [95% CI]', 'caught', 'too early [95% CI]', 'catches (late)', 'turn med'];
	const lines = d.cues.map((c) => [
		c.cue, c.plantedNoise.toFixed(2), String(c.participants), String(c.inRates), pct(c.wellTimed), pct(c.tooLate),
		c.caught.rate === null ? '-' : `${(c.caught.rate * 100).toFixed(0)}%`, pct(c.tooEarly), `${c.catches.n} (${c.catches.late})`,
		c.turnMedian === null ? '-' : c.turnMedian.toFixed(2)
	]);
	const w = head.map((h, i) => Math.max(h.length, ...lines.map((l) => l[i].length)));
	const fmt = (l) => l.map((x, i) => (i === 0 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ');
	console.log(fmt(head));
	console.log(w.map((n) => '-'.repeat(n)).join('  '));
	for (const l of lines) console.log(fmt(l));
	const r = (x) => (x === null ? '-' : x.toFixed(2));
	console.log(`\nSpearman rank correlation with planted noise (recovered if in time is strongly negative, too late and too early positive):`);
	console.log(`  in time ${r(d.rhos.wellTimed)}, too late ${r(d.rhos.tooLate)}, too early ${r(d.rhos.tooEarly)}, caught ${r(d.rhos.caught)}, turn-away median ${r(d.rhos.turnMedian)}, clarity ${r(d.rhos.clarity)}`);
	// Pairs whose intervals do not overlap on the headline rate (the dashboard's "clear" test).
	const ok = d.cues.filter((c) => c.inRates >= 10 && c.wellTimed.rate !== null);
	let clear = 0;
	for (const a of ok) for (const b of ok) if (a !== b && a.wellTimed.lo > b.wellTimed.hi) clear++;
	console.log(`  ${clear} of ${(ok.length * (ok.length - 1)) / 2} pairs of conditions differ clearly on the in-time rate.`);
	console.log('\nSimulated data: bots cannot see a cue. This checks the pipeline, not the cues.');
}

function ranks(xs) {
	const idx = xs.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
	const r = new Array(xs.length);
	for (let i = 0; i < idx.length;) {
		let j = i;
		while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
		for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
		i = j + 1;
	}
	return r;
}
function spearman(a, b) {
	const ra = ranks(a), rb = ranks(b);
	const m = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
	const ma = m(ra), mb = m(rb);
	let num = 0, da = 0, db = 0;
	for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
	return da && db ? num / Math.sqrt(da * db) : 0;
}
