#!/usr/bin/env node
// End-to-end check of the run console (/) and the play page (/play/[cue]), driven like a researcher
// with the keyboard while the engine bot plays:
//   console: enter a participant label, pick the suggested case with its number key, Enter
//   run 1: play while a Node subscriber watches the run sheet update live, then refresh in the
//          middle (saved trials must stay; a new run starts)
//   run 2: same case after the refresh; the decision tally shows outside participant view only;
//          End run (E), answer the two questions
//   run 3: Next case (N) from the summary, End run, skip the questions, Esc to the console
//   run 4: Arcade rules, case B, End run, back to the console
//   run 5: run length 8 on the console: the run ends by itself after 8 power-ups
// then reads everything back from Convex (session, blocks in order, trials, clips, ratings, CSV
// export), decodes one clip and redraws it with the real renderer. Prints PASS / FAIL per check and
// exits non-zero when one fails. Adds data (source: 'bot', from webdriver); never deletes any.
//   node scripts/run-e2e.mjs [--seconds 30] [--w 1440 --h 900] [--shots .shots/run-1440] [--no-length]
// Needs the dev server (:5173) and Convex (:3210).
import { chromium } from 'playwright';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SECONDS = +opt('seconds', 30), W = +opt('w', 1440), H = +opt('h', 900);
const prefix = opt('shots', `.shots/run-${W}`);
const APP = 'http://localhost:5173', CONVEX = 'http://127.0.0.1:3210', SITE = 'http://127.0.0.1:3211';
const http = new ConvexHttpClient(CONVEX);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let shot = 0;
const snap = async (name, full = false) => { const p = `${prefix}-${String(++shot).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: p, fullPage: full }); log('shot', p); };
const participant = () => page.evaluate(() => JSON.parse(localStorage.getItem('cc.run.participant') ?? 'null'));
const live = () => page.evaluate(() => {
	const t = window.__ccTelemetry;
	return t ? { saved: t.live.saved, measured: t.live.measured, decisions: t.live.decisions, recent: t.live.recent.length, block: t.keys.blockKey } : null;
});
const driveBot = () => page.evaluate(async () => {
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	let g = null, bot = null, n = 0;
	const loop = () => {
		const game = window.__cc?.game;
		if (game && game !== g) { g = game; bot = createBot(game, { seed: 9 + n++, skill: 0.95, awarenessNoise: 1.2, caution: 0.2, reaction: 0.3, chase: 'eager' }); }
		bot?.step();
		requestAnimationFrame(loop);
	};
	loop();
});
const startGame = async () => { await page.waitForSelector('.board canvas'); await page.waitForTimeout(600); await page.keyboard.press('Enter'); await driveBot(); };
const pressCode = async (code) => { for (const ch of code) await page.keyboard.press(ch === 'A' || ch === 'B' ? ch.toLowerCase() : ch); };
const tallyText = () => page.evaluate(() => document.querySelector('.head .tally')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);

try {
	// ----- console -----
	await page.goto(APP + '/', { waitUntil: 'networkidle' });
	await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('cc.run.')) localStorage.removeItem(k); });
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	await snap('console-empty');
	const label = 'E2E-' + String(Date.now()).slice(-4);
	await page.locator('#participant').fill(label);
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('cc.run.participant') ?? '{}').number > 0, null, { timeout: 15000 });
	let p = await participant();
	log(`participant ${p.label} #${p.number}, Latin square row ${p.row}; suggested order: ${p.order.join(', ')}`);
	check(p.order.length === 13, 'the participant got a number and a suggested order of all 13 cases');
	const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('cc.run.settings') ?? '{}'));
	check(settings.runLength === 16, `default run length is 16 power-ups (${settings.runLength})`);
	await page.locator('body').click({ position: { x: 5, y: 300 } });
	// Pick the suggested case with its number key (codes are on the cards).
	const sugg = await page.evaluate(() => document.querySelector('.suggest .link .num')?.textContent?.trim());
	await pressCode(sugg);
	await page.waitForTimeout(800);
	await snap('console-selected');
	const selectedId = await page.evaluate(() => JSON.parse(localStorage.getItem('cc.run.settings')).selected);
	check(selectedId === p.order[0], `picked the suggested case ${sugg} (${selectedId}) with the keyboard`);

	// A second watcher: a plain Node subscription to the run sheet the console shows.
	const sub = new ConvexClient(CONVEX);
	const sheetUpdates = [];
	sub.onUpdate(api.runs.session, { sessionKey: p.sessionKey }, (r) => {
		const n = (r?.runs ?? []).reduce((a, x) => a + x.trials, 0);
		if (sheetUpdates.at(-1) !== n) sheetUpdates.push(n);
	});

	// ----- run 1: refresh in the middle -----
	await page.keyboard.press('Enter');
	await page.waitForURL(`**/play/${selectedId}`);
	await startGame();
	await page.waitForTimeout(SECONDS * 1000);
	await snap('run1-playing');
	const before = await live();
	check(before && before.measured > 0, `run 1 measured power-ups while playing (${before?.measured}, ${before?.saved} saved)`);
	check(await tallyText() === null, 'participant view (on when a run starts) hides the decision tally');
	log('refreshing now');
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	const run1 = await http.query(api.runs.block, { blockKey: before.block });
	check(run1 && run1.trials >= before.saved, `after the refresh run 1 keeps its trials in Convex (${run1?.trials} >= ${before.saved} saved)`);
	check(sheetUpdates.length >= 2 && sheetUpdates.at(-1) > 0, `the run sheet updated live while playing (${sheetUpdates.join(' -> ')})`);

	// ----- run 2: tally outside participant view, End run, ratings -----
	await startGame();
	await page.waitForTimeout(SECONDS * 1000);
	await page.keyboard.press('v');
	await page.waitForTimeout(600);
	const l2 = await live(), tally = await tallyText();
	log(`tally outside participant view: "${tally}"`);
	check(!!tally && tally.includes(`Decisions measured this run: ${l2.decisions}`) && tally.includes(`${l2.measured} of 16`), 'outside participant view the header shows the decisions measured and the power-ups of the run length');
	await snap('run2-researcher-view');
	await page.keyboard.press('v');
	await page.keyboard.press('e');
	await page.waitForSelector('.summary', { timeout: 20000 });
	await page.waitForTimeout(3000);
	await snap('run2-summary');
	const fs = page.locator('fieldset.scale');
	await fs.nth(0).locator('input[value="5"]').check({ force: true });
	await fs.nth(1).locator('input[value="2"]').check({ force: true });
	await page.getByRole('button', { name: 'Save answers' }).click();
	await page.waitForTimeout(1500);
	const run2Key = (await participant()).runs.at(-1).blockKey;

	// ----- run 3: next case, skip the questions, back to the console -----
	await page.keyboard.press('n');
	await page.waitForTimeout(1500);
	log('run 3 on', page.url());
	await startGame();
	await page.waitForTimeout(SECONDS * 0.75 * 1000);
	await page.keyboard.press('e');
	await page.waitForSelector('.summary', { timeout: 20000 });
	await page.waitForTimeout(2500);
	await page.getByRole('button', { name: 'Skip' }).click();
	await page.keyboard.press('Escape');
	await page.waitForURL(APP + '/');
	await page.waitForTimeout(2000);

	// ----- run 4: arcade rules, case B -----
	await page.getByRole('radio', { name: 'Arcade' }).check({ force: true });
	await page.locator('body').click({ position: { x: 5, y: 300 } });
	await page.keyboard.press('b');
	await page.keyboard.press('Enter');
	await page.waitForURL('**/play/classic-blink?rules=arcade');
	await startGame();
	await page.waitForTimeout(SECONDS * 0.6 * 1000);
	await page.keyboard.press('e');
	await page.waitForSelector('.summary', { timeout: 20000 });
	await page.waitForTimeout(2500);
	await page.keyboard.press('Escape');
	await page.waitForURL(APP + '/');
	await page.waitForTimeout(2000);
	await page.getByRole('radio', { name: 'Study rules' }).check({ force: true });

	// ----- run 5: the run ends itself at the run length -----
	let run5Key = null;
	if (!args.includes('--no-length')) {
		await page.getByRole('radio', { name: '8', exact: true }).check({ force: true });
		await page.locator('body').click({ position: { x: 5, y: 300 } });
		await page.keyboard.press('0');
		await page.keyboard.press('Enter');
		await page.waitForURL('**/play/timer-bar');
		await startGame();
		await page.waitForURL('**done=**', { timeout: 6 * 60 * 1000 });
		run5Key = new URL(page.url()).searchParams.get('done');
		await page.waitForTimeout(3000);
		await snap('run5-ended-by-length');
		const b5 = await http.query(api.runs.block, { blockKey: run5Key });
		check(b5?.trials === 8, `run 5 ended by itself after 8 power-ups (${b5?.trials} stored)`);
		check(b5?.rows.at(-1)?.reason !== 'The run ended while the power was on', 'the last power-up was measured to its end');
		await page.keyboard.press('Escape');
		await page.waitForURL(APP + '/');
		await page.getByRole('radio', { name: '16', exact: true }).check({ force: true });
	}
	await page.waitForTimeout(2500);
	await snap('console-after');

	// ----- read back -----
	p = await participant();
	const s = await http.query(api.runs.session, { sessionKey: p.sessionKey });
	const sessions = await http.query(api.sessions.overview, { source: 'bot', limit: 30 });
	const so = sessions.find((x) => x._id === s.sessionId);
	console.log(`\nSession ${s.sessionId} (key ${p.sessionKey})`);
	console.log(`  participant #${s.participant?.number} "${s.participant?.nickname}", run info ${JSON.stringify(s.run)}, session mode ${so?.mode}, source ${so?.source}`);
	console.log('Runs (blocks) in order:');
	const runs = s.runs.sort((a, b) => a.orderIndex - b.orderIndex);
	for (const r of runs) {
		console.log(`  #${r.orderIndex + 1} ${r.cue.padEnd(14)} ${r.mode.padEnd(6)} trials ${r.trials}, decisions ${r.counted}, timely ${r.wellTimed}, caught ${r.caught}, catches ${r.catches}, clips ${r.clips}, ended ${r.endedAt ? 'yes' : 'no'}, rating ${r.clarity ?? '-'}/${r.distraction ?? '-'}`);
	}
	// A refresh carries on in the same run, so runs 1 and 2 may be one block: compare with the run sheet kept on this machine.
	check(runs.length === p.runs.length && runs.length >= (args.includes('--no-length') ? 3 : 4), `every run played is stored, in order (${runs.map((r) => r.orderIndex + 1).join(',')}; ${p.runs.length} on this machine)`);
	check(runs.every((r) => r.endedAt), 'every run closed');
	check(so?.source === 'bot', 'automated play is stored as simulated (source bot)');
	check(s.run?.participantLabel === label, `the label is stored on the session (${s.run?.participantLabel})`);
	const b2 = await http.query(api.runs.block, { blockKey: run2Key });
	check(b2?.clarity === 5 && b2?.distraction === 2, `run 2 rating stored (${b2?.clarity}/${b2?.distraction})`);
	check(runs.some((r) => r.mode === 'arcade' && r.cue === 'classic-blink'), 'the arcade run of case B is stored with its rules');
	const trials = await http.query(api.trials.list, { source: 'bot', sessionId: s.sessionId, paginationOpts: { numItems: 500, cursor: null } });
	check(trials.page.length === runs.reduce((a, r) => a + r.trials, 0), `trials.list matches the run sheet (${trials.page.length})`);

	// ----- a clip decodes and redraws with the real renderer -----
	const withClip = trials.page.filter((t) => t.clipId);
	check(withClip.length > 0, `replay clips stored (${withClip.length})`);
	if (withClip.length) {
		const pick = withClip.find((t) => t.outcome === 'caught' || t.outcome === 'overstayed') ?? withClip[0];
		const clip = await http.query(api.clips.get, { id: pick.clipId });
		const b64 = Buffer.from(clip.data).toString('base64');
		const info = await page.evaluate(async ({ clip, b64 }) => {
			const { decodeClip } = await import('/src/lib/telemetry/recorder.ts');
			const { renderScene } = await import('/src/lib/game/render/renderer.ts');
			const { cueById } = await import('/src/lib/game/cues/index.ts');
			const bin = atob(b64), data = new Uint8Array(bin.length);
			for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
			const decoded = decodeClip({ ...clip, data: data.buffer });
			const end = decoded.markers.find((m) => m.kind === 'powerEnd')?.t ?? decoded.scenes.at(-1).frame.t;
			const at = (t) => decoded.scenes.reduce((a, s) => (Math.abs(s.frame.t - t) < Math.abs(a.frame.t - t) ? s : a));
			const wrap = document.createElement('div');
			wrap.id = 'clipcheck';
			wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:#05081a;display:flex;gap:12px;padding:12px;align-items:flex-start';
			document.body.append(wrap);
			for (const dt of [-1, 0, 0.8]) {
				const c = document.createElement('canvas');
				wrap.append(c);
				renderScene(c, at(end + dt), { cue: cueById(clip.cue), width: 400, dpr: 1 });
			}
			return { scenes: decoded.scenes.length, markers: decoded.markers.map((m) => m.kind) };
		}, { clip: { ...clip, data: null }, b64 });
		await page.locator('#clipcheck').screenshot({ path: `${prefix}-clip-redraw.png` });
		check(info.scenes > 20 && info.markers.includes('powerEnd'), `clip of trial ${pick.trialIndex} (${pick.outcome}) decodes: ${info.scenes} scenes, markers ${info.markers.join(', ')}`);
	}

	// ----- export -----
	const csv = await (await fetch(`${SITE}/export/trials.csv?source=bot&sessionId=${s.sessionId}`)).text();
	const csvRows = csv.trim().split('\n').length - 1;
	check(csvRows === trials.page.length, `CSV export has the session's trials (${csvRows} rows, ${csv.split('\n')[0].split(',').length} columns)`);
	await sub.close();
} catch (e) {
	check(false, `the run flow went through (${e instanceof Error ? e.message : e})`);
	await snap('error').catch(() => {});
}
check(errors.length === 0, `no page errors${errors.length ? `: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : ''}`);
console.log(`took ${((Date.now() - t0) / 60000).toFixed(1)} min`);
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
