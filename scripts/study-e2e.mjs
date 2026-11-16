#!/usr/bin/env node
// End-to-end check of the guided study (/study): a scripted participant goes through the welcome,
// practice, every round of a quick session (driven by the engine bot), the ratings and the final
// pick, with a page refresh in the middle of round 2 to test resume. Then everything is read back
// from Convex: session (with its counterbalanced order and setup), blocks in order (practice and
// the abandoned block flagged), trials, clips, ratings, and the summaries without the practice.
//   node scripts/study-e2e.mjs [--fast] [--w 1440 --h 900] [--shots prefix]
//   --fast: shorter rounds (2 power-ups, 30 s cap, 10 s practice) for quick iterations.
// Needs the dev server (:5173) and Convex (:3210). Data is tagged source: 'bot' (webdriver).
import { chromium } from 'playwright';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const fast = args.includes('--fast');
const W = +opt('w', 1440), H = +opt('h', 900);
const prefix = opt('shots', `.shots/study-${W}`);
mkdirSync('.shots', { recursive: true });
const APP = 'http://localhost:5173';
const URL = APP + '/study' + (fast ? '?trials=2&cap=30&practice=10' : '');
const http = new ConvexHttpClient('http://127.0.0.1:3210');
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s]`, ...a);

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
let shot = 0;
const snap = async (name) => { const p = `${prefix}-${String(++shot).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: p }); log('shot', p); };

const progress = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__ccStudy?.progress ?? null)));
const waitStep = async (step, timeout = 400_000) => {
	const until = Date.now() + timeout;
	while (Date.now() < until) {
		const p = await progress();
		if (p?.step === step) return p;
		await page.waitForTimeout(500);
	}
	throw new Error('timed out waiting for step ' + step);
};
// The engine bot plays whatever game is live (it is replaced at each round).
const driveBot = () => page.evaluate(async () => {
	if (window.__botLoop) return;
	window.__botLoop = true;
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	let g = null, bot = null, n = 0;
	const loop = () => {
		const game = window.__cc?.game;
		if (game && game !== g) { g = game; bot = createBot(game, { seed: 5 + n++, skill: 0.95, awarenessNoise: 1.2, caution: 0.2, reaction: 0.3 }); }
		bot?.step();
		requestAnimationFrame(loop);
	};
	loop();
});

// ----- welcome -----
await page.goto(URL, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('cc.study.progress'); localStorage.removeItem('cc.study.outbox'); });
await page.reload({ waitUntil: 'networkidle' });
await snap('welcome');
await page.getByRole('button', { name: 'Play test tone' }).click();
await page.getByLabel('I heard it').check();
await page.locator('input[name="length"][value="quick"]').check({ force: true });
await page.getByLabel('Nickname').fill('Study bot');
await page.screenshot({ path: `${prefix}-welcome-full.png`, fullPage: true });
await page.getByRole('button', { name: 'Start with a practice round' }).click();
let p = await waitStep('practice-intro');
log(`participant ${p.number} (${p.numberFrom}), order row ${p.row}: ${p.rounds.map((r) => r.cue).join(', ')}`);
await snap('practice-intro');

// ----- practice -----
await page.getByRole('button', { name: 'Start practice' }).click();
await driveBot();
await page.waitForTimeout(4000);
await snap('practice-play');
p = await waitStep('intro');
log('practice done');

// ----- rounds -----
let refreshed = null;
for (let i = 0; i < p.rounds.length; i++) {
	await snap(`round${i + 1}-intro`);
	await page.getByRole('button', { name: `Start round ${i + 1}` }).click();
	await driveBot();
	if (i === 1 && !refreshed) {
		// Refresh in the middle of round 2: it must come back to the round's intro, with a new block.
		await page.waitForTimeout(fast ? 5000 : 15000);
		await snap(`round${i + 1}-play`);
		const before = await progress();
		await page.reload({ waitUntil: 'networkidle' });
		await page.evaluate(() => { window.__botLoop = false; });
		const after = await progress();
		refreshed = { oldKey: before.rounds[i].blockKey, newKey: after.rounds[i].blockKey, step: after.step, abandoned: after.rounds[i].abandoned };
		log('refresh mid round 2 ->', JSON.stringify(refreshed));
		if (after.step !== 'intro' || after.index !== 1 || refreshed.oldKey === refreshed.newKey) throw new Error('resume failed');
		await snap('round2-resumed');
		await page.getByRole('button', { name: `Start round ${i + 1}` }).click();
		await driveBot();
	}
	await page.waitForTimeout(6000);
	if (i !== 1) await snap(`round${i + 1}-play`);
	await waitStep('rate');
	log(`round ${i + 1} played`);
	await snap(`round${i + 1}-rate`);
	const fs = page.locator('fieldset.scale');
	await fs.nth(0).locator(`input[value="${2 + (i % 5)}"]`).check({ force: true });
	await fs.nth(1).locator(`input[value="${1 + (i % 3)}"]`).check({ force: true });
	if (i % 2 === 0) await page.getByPlaceholder('In your own words').fill(`round ${i + 1}: the ghosts`);
	await page.getByRole('button', { name: i === p.rounds.length - 1 ? 'Continue' : 'Next round' }).click();
	p = await waitStep(i === p.rounds.length - 1 ? 'pick' : 'intro');
}

// ----- pick -----
await page.waitForTimeout(2500);
await snap('pick');
await page.screenshot({ path: `${prefix}-pick-full.png`, fullPage: true });
await page.locator('input[name="clearest"][value="0"]').check({ force: true });
await page.locator('input[name="least"][value="1"]').check({ force: true });
await page.locator('#study-comment').fill('End-to-end check by the study script.');
await page.getByRole('button', { name: 'Finish and see my results' }).click();
p = await waitStep('done');
await page.waitForFunction(() => (window.__ccStudy.outbox.state.pending === 0), null, { timeout: 30000 }).catch(() => log('outbox still pending'));
await page.waitForTimeout(2500);
await snap('done');
await page.screenshot({ path: `${prefix}-done-full.png`, fullPage: true });

// ----- read back from Convex -----
const res = await http.query(api.study.results, { sessionKey: p.sessionKey });
const sessions = await http.query(api.sessions.overview, { source: 'bot', mode: 'study', limit: 20 });
const s = sessions.find((x) => x._id === res.sessionId);
console.log(`\nSession ${s._id} key ${p.sessionKey}`);
console.log(`  mode ${s.mode}, source ${s.source}, participant #${s.participant?.number} "${s.participant?.nickname}", sound ${s.sound}, input ${s.inputType}`);
console.log(`  cueOrder: ${s.cueOrder.join(', ')}`);
console.log(`  ended: ${s.endedAt ? new Date(s.endedAt).toISOString() : 'no'}`);
console.log('\nBlocks (by orderIndex):');
for (const b of [...res.blocks].sort((a, b) => a.orderIndex - b.orderIndex || 0)) {
	console.log(`  #${String(b.orderIndex).padStart(2)} ${b.cue.padEnd(16)} ${b.practice ? 'PRACTICE ' : ''}${b.abandoned ? 'ABANDONED ' : ''}trials ${b.trials}, engaged ${b.engaged}, counted ${b.counted}, well-timed ${b.wellTimed}, caught ${b.caught}, clips ${b.clips}, pauses ${b.pauses}, clarity ${b.clarity}, distraction ${b.distraction}, note ${JSON.stringify(b.note)}`);
}
console.log(`\nSession rating: clearest ${res.session?.clearest}, least clear ${res.session?.leastClear}, comment ${JSON.stringify(res.session?.comment)}`);
const listed = await http.query(api.trials.list, { source: 'bot', sessionId: s._id, paginationOpts: { numItems: 500, cursor: null } });
const withPractice = await http.query(api.trials.list, { source: 'bot', sessionId: s._id, includePractice: true, paginationOpts: { numItems: 500, cursor: null } });
const practiceTrials = withPractice.page.filter((t) => t.practice);
console.log(`\ntrials.list: ${listed.page.length} trials by default, ${withPractice.page.length} with includePractice (${practiceTrials.length} practice, blockIndex ${[...new Set(practiceTrials.map((t) => t.blockIndex))]})`);
const order = [...listed.page].reverse().map((t) => `${t.blockIndex}:${t.cue}:${t.trialIndex}`);
console.log('  trials in time order (blockIndex:cue:trialIndex):', order.join(' '));
const sum = await http.query(api.summary.byCue, { source: 'bot', sessionId: s._id });
const sumP = await http.query(api.summary.byCue, { source: 'bot', sessionId: s._id, includePractice: true });
console.log(`summary.byCue(session): ${sum.scanned} trials scanned (with practice: ${sumP.scanned}); per cue: ${sum.cues.map((c) => `${c.cue} ${c.trials}/${c.inRates} clarity ${c.clarity.mean ?? '-'}`).join('; ')}`);
const clipCount = withPractice.page.filter((t) => t.clipId).length;
console.log(`clips stored: ${clipCount}`);
const one = listed.page.find((t) => t.clipId);
if (one) { const c = await http.query(api.clips.get, { id: one.clipId }); console.log(`  e.g. clip ${c._id}: cue ${c.cue}, ${c.scenes} scenes, ${(c.size / 1024).toFixed(1)} KB, outcome ${c.outcome}`); }
const counters = await http.query(api.live.counters, { source: 'bot' });
console.log(`live.counters(bot): trials ${counters.trials} (practice excluded)`);
console.log(`\nresume check: ${JSON.stringify(refreshed)}`);
console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(`took ${((Date.now() - t0) / 60000).toFixed(1)} min`);
await browser.close();
