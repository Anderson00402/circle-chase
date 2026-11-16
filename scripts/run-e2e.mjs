#!/usr/bin/env node
// End-to-end check of the run console (/) and the play page (/play/[cue]), driven like a researcher
// with the keyboard while the engine bot plays:
//   console: enter a participant label, pick the suggested case with its number key, Enter
//   run 1: play, then refresh in the middle (saved trials must stay; a new run starts)
//   run 2: same case after the refresh, participant view on, End run (E), answer the two questions
//   run 3: Next case (N) from the summary, End run, skip the questions, Esc to the console
//   run 4: Arcade rules, case B, End run, back to the console
// then reads everything back from Convex (session, blocks in order, trials, clips, ratings).
//   node scripts/run-e2e.mjs [--seconds 40] [--w 1440 --h 900] [--shots .shots/run-1440]
// Needs the dev server (:5173) and Convex (:3210). Data is tagged source: 'bot' (webdriver).
import { chromium } from 'playwright';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const SECONDS = +opt('seconds', 40), W = +opt('w', 1440), H = +opt('h', 900);
const prefix = opt('shots', `.shots/run-${W}`);
const APP = 'http://localhost:5173';
const http = new ConvexHttpClient('http://127.0.0.1:3210');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

const browser = await chromium.launch({ channel: 'chrome' });
const page = await (await browser.newContext({ viewport: { width: W, height: H } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let shot = 0;
const snap = async (name, full = false) => { const p = `${prefix}-${String(++shot).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: p, fullPage: full }); log('shot', p); };
const participant = () => page.evaluate(() => JSON.parse(localStorage.getItem('cc.run.participant') ?? 'null'));
const driveBot = () => page.evaluate(async () => {
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	let g = null, bot = null, n = 0;
	const loop = () => {
		const game = window.__cc?.game;
		if (game && game !== g) { g = game; bot = createBot(game, { seed: 9 + n++, skill: 0.95, awarenessNoise: 1.2, caution: 0.2, reaction: 0.3 }); }
		bot?.step();
		requestAnimationFrame(loop);
	};
	loop();
});
const startGame = async () => { await page.waitForSelector('.board canvas'); await page.waitForTimeout(600); await page.keyboard.press('Enter'); await driveBot(); };
const pressCode = async (code) => { for (const ch of code) await page.keyboard.press(ch === 'A' || ch === 'B' ? ch.toLowerCase() : ch); };

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
await page.locator('body').click({ position: { x: 5, y: 300 } });
// Pick the suggested case with its number key (codes are on the cards).
const sugg = await page.evaluate(() => document.querySelector('.suggest .link .num')?.textContent?.trim());
await pressCode(sugg);
await page.waitForTimeout(800);
await snap('console-selected');
const selectedId = await page.evaluate(() => JSON.parse(localStorage.getItem('cc.run.settings')).selected);
log(`picked suggested case ${sugg} (${selectedId}) with the keyboard`);

// ----- run 1: refresh in the middle -----
await page.keyboard.press('Enter');
await page.waitForURL(`**/play/${selectedId}`);
await startGame();
await page.waitForTimeout(SECONDS * 1000);
await snap('run1-playing');
const before = await page.evaluate(() => ({ saved: window.__ccTelemetry.live.saved, recent: window.__ccTelemetry.live.recent.length, block: window.__ccTelemetry.keys.blockKey }));
log(`run 1: ${before.recent} power-ups measured, ${before.saved} saved; refreshing now`);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const run1 = await http.query(api.runs.block, { blockKey: before.block });
log(`after refresh: run 1 block in Convex has ${run1?.trials} trials (saved before refresh: ${before.saved}), ended ${!!run1?.endedAt}`);

// ----- run 2: participant view, End run, ratings -----
await startGame();
await page.waitForTimeout(SECONDS * 1000);
await snap('run2-playing');
await page.keyboard.press('v');
await page.waitForTimeout(600);
await snap('run2-participant-view');
await page.keyboard.press('v');
await page.keyboard.press('e');
await page.waitForSelector('.summary');
await page.waitForTimeout(3000);
await snap('run2-summary');
const fs = page.locator('fieldset.scale');
await fs.nth(0).locator('input[value="5"]').check({ force: true });
await fs.nth(1).locator('input[value="2"]').check({ force: true });
await page.getByRole('button', { name: 'Save answers' }).click();
await page.waitForTimeout(1500);
await snap('run2-summary-rated', true);
const run2Key = (await participant()).runs.at(-1).blockKey;

// ----- run 3: next case, skip the questions, back to the console -----
await page.keyboard.press('n');
await page.waitForTimeout(1500);
log('run 3 on', page.url());
await startGame();
await page.waitForTimeout(SECONDS * 0.75 * 1000);
await page.keyboard.press('e');
await page.waitForSelector('.summary');
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
await snap('run4-arcade');
await page.keyboard.press('e');
await page.waitForSelector('.summary');
await page.waitForTimeout(2500);
await page.keyboard.press('Escape');
await page.waitForURL(APP + '/');
await page.waitForTimeout(2500);
await snap('console-after');

// ----- read back -----
p = await participant();
const s = await http.query(api.runs.session, { sessionKey: p.sessionKey });
const sessions = await http.query(api.sessions.overview, { source: 'bot', limit: 30 });
const so = sessions.find((x) => x._id === s.sessionId);
console.log(`\nSession ${s.sessionId} (key ${p.sessionKey})`);
console.log(`  participant #${s.participant?.number} "${s.participant?.nickname}", run info ${JSON.stringify(s.run)}, session mode ${so?.mode}, source ${so?.source}`);
console.log(`  suggested order stored on the session: ${so?.cueOrder.join(', ')}`);
console.log('Runs (blocks) in order:');
for (const r of s.runs.sort((a, b) => a.orderIndex - b.orderIndex)) {
	console.log(`  #${r.orderIndex + 1} ${r.cue.padEnd(14)} ${r.mode.padEnd(6)} trials ${r.trials}, decisions ${r.counted}, timely ${r.wellTimed}, caught ${r.caught}, catches ${r.catches}, clips ${r.clips}, ended ${r.endedAt ? 'yes' : 'no'}, rating ${r.clarity ?? '-'}/${r.distraction ?? '-'} outcomes ${JSON.stringify(Object.fromEntries(Object.entries(r.outcomes).filter(([, n]) => n)))}`);
}
const b2 = await http.query(api.runs.block, { blockKey: run2Key });
console.log(`runs.block(run 2): ${b2.rows.length} trial rows, e.g. ${b2.rows.slice(0, 3).map((t) => `#${t.trialIndex + 1} ${t.outcome} ${t.total.toFixed(1)} s${t.clipId ? ' +clip' : ''}`).join('; ')}`);
const trials = await http.query(api.trials.list, { source: 'bot', sessionId: s.sessionId, paginationOpts: { numItems: 500, cursor: null } });
console.log(`trials.list(session): ${trials.page.length} trials; modes ${JSON.stringify(trials.page.reduce((m, t) => ((m[t.mode] = (m[t.mode] ?? 0) + 1), m), {}))}; blockIndex values ${[...new Set(trials.page.map((t) => t.blockIndex))].sort().join(',')}`);
const withClip = trials.page.find((t) => t.clipId);
if (withClip) { const c = await http.query(api.clips.get, { id: withClip.clipId }); console.log(`  clip ${c._id}: ${c.cue}, mode ${c.mode}, ${c.scenes} scenes, ${(c.size / 1024).toFixed(1)} KB`); }
const run1After = await http.query(api.runs.block, { blockKey: before.block });
console.log(`refresh check: run 1 had ${before.saved} saved before the refresh; Convex now holds ${run1After.trials} trials for it (block ended: ${!!run1After.endedAt})`);
console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(`took ${((Date.now() - t0) / 60000).toFixed(1)} min`);
await browser.close();
