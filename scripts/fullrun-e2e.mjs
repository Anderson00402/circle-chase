#!/usr/bin/env node
// End-to-end check of the full-run recording (src/lib/telemetry/runrec.ts, convex/runRecordings.ts,
// /replays/run/<blockKey>), driven like a researcher while the engine bot plays:
//   console: a participant label, run length 8, the suggested case, Enter
//   play: refresh once in the middle (the recording must carry on with the next chunk index on the
//         same run clock), the run ends itself after 8 power-ups
//   Convex: the chunks (one per ~5 s, numbered 0..n-1 once each) and the index document, with sizes
//   player: the board at three random times equals a scene rebuilt from the chunks and drawn with
//           the real renderer; every jump point lands on its power-up; 4x playback moves at 4x
//   links: the summary, the console's run sheet and a trial's replay arrive at the right time
// Prints PASS / FAIL per check and exits non-zero when one fails. Adds data (source: 'bot', from
// webdriver); never deletes any. Screenshots in .shots/fullrun/.
//   node scripts/fullrun-e2e.mjs [--power-ups 8] [--w 1440 --h 900]
// Needs the dev server (:5173) and Convex (:3210).
import { chromium } from 'playwright';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const POWER_UPS = +opt('power-ups', 8), W = +opt('w', 1440), H = +opt('h', 900);
const APP = 'http://localhost:5173', CONVEX = 'http://127.0.0.1:3210', SITE = 'http://127.0.0.1:3211';
const DIR = '.shots/fullrun';
mkdirSync(DIR, { recursive: true });
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
const snap = async (name) => { const p = `${DIR}/${String(++shot).padStart(2, '0')}-${name}.png`; await page.screenshot({ path: p }); log('shot', p); };
const live = () => page.evaluate(() => {
	const t = window.__ccTelemetry;
	return t ? { measured: t.live.measured, chunks: t.live.chunks, block: t.keys.blockKey } : null;
});
const driveBot = () => page.evaluate(async () => {
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	let g = null, bot = null, n = 0;
	const loop = () => {
		const game = window.__cc?.game;
		if (game && game !== g) { g = game; bot = createBot(game, { seed: 21 + n++, skill: 0.95, awarenessNoise: 1.2, caution: 0.2, reaction: 0.3, chase: 'eager' }); }
		bot?.step();
		requestAnimationFrame(loop);
	};
	loop();
});
const startGame = async () => { await page.waitForSelector('.board canvas'); await page.waitForTimeout(600); await page.keyboard.press('Enter'); await driveBot(); };
const hashT = () => page.evaluate(() => Number(new URLSearchParams(location.hash.slice(1)).get('t')));
/** Sample the header's save indicator while playing: how often it said "Saving". */
const sampleIndicator = (ms) => page.evaluate(async (ms) => {
	const seen = { saving: 0, saved: 0, other: 0 };
	const until = performance.now() + ms;
	while (performance.now() < until) {
		const el = document.querySelector('.conn-slot');
		const text = (el?.textContent ?? '') + ' ' + (el?.querySelector('[title]')?.getAttribute('title') ?? '');
		if (/Saving \d/.test(text)) seen.saving++; else if (/Saved/.test(text)) seen.saved++; else seen.other++;
		await new Promise((r) => setTimeout(r, 100));
	}
	return seen;
}, ms);

let blockKey = null;
try {
	// ----- console: label, run length, case -----
	await page.goto(APP + '/', { waitUntil: 'networkidle' });
	await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('cc.run.')) localStorage.removeItem(k); });
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForTimeout(1200);
	const label = 'FULLRUN-' + String(Date.now()).slice(-4);
	await page.locator('#participant').fill(label);
	await page.keyboard.press('Enter');
	await page.waitForFunction(() => JSON.parse(localStorage.getItem('cc.run.participant') ?? '{}').number > 0, null, { timeout: 15000 });
	await page.getByRole('radio', { name: String(POWER_UPS), exact: true }).check({ force: true });
	await page.locator('body').click({ position: { x: 5, y: 300 } });
	await page.keyboard.press('0'); // case 0, the timer bar
	await page.keyboard.press('Enter');
	await page.waitForURL('**/play/timer-bar');

	// ----- play, refresh in the middle -----
	await startGame();
	const half = Math.ceil(POWER_UPS / 2);
	const indicator = await sampleIndicator(12000);
	log(`save indicator while playing (12 s, every 0.1 s): ${JSON.stringify(indicator)}`);
	await page.waitForFunction((n) => (window.__ccTelemetry?.live.measured ?? 0) >= n, half, { timeout: 4 * 60_000, polling: 500 });
	const before = await live();
	blockKey = before.block;
	log(`refreshing after ${before.measured} power-ups, ${before.chunks} chunks sent`);
	check(before.chunks >= 2, `chunks were sent while playing (${before.chunks}, one every 5 s of play)`);
	check(indicator.saving <= indicator.saved * 0.25, `the save indicator does not flicker every 5 s (${indicator.saving} of ${indicator.saving + indicator.saved} samples said "Saving")`);
	await page.reload({ waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	const firstPage = await http.query(api.runRecordings.progress, { blockKey });
	await startGame();
	await page.waitForURL('**done=**', { timeout: 6 * 60_000 });
	check(new URL(page.url()).searchParams.get('done') === blockKey, 'the run carried on in the same block after the refresh and ended itself');
	await page.waitForTimeout(3000);

	// ----- Convex: chunks and the index document -----
	const o = await http.query(api.runRecordings.outline, { key: blockKey });
	const idx = o.chunks.map((c) => c.i);
	check(idx.length > 4 && idx.every((x, i) => x === i), `chunks numbered 0..${idx.length - 1} once each`);
	const spans = o.chunks.map((c) => +(c.t1 - c.t0).toFixed(2));
	const full = spans.slice(0, -1).filter((s) => s >= 4.7 && s <= 5.0).length;
	check(full >= spans.length - 4, `chunks cover about 5 s of game time each (${spans.join(', ')})`);
	// The first page's last (partial) chunk is flushed on page hide and may arrive after the reload.
	const p2 = o.chunks.findIndex((c) => c.base > 0);
	const last1 = o.chunks[p2 - 1], first2 = o.chunks[p2];
	check(!!firstPage && p2 > 0 && last1.i >= firstPage.next - 1 && first2.i === last1.i + 1 && first2.t0 > last1.t1 && o.chunks.slice(p2).every((c) => c.base === first2.base),
		`after the refresh the recording carries on: page 1 ended with chunk ${last1?.i} at ${last1?.t1} s (its last ${last1 ? (last1.t1 - last1.t0).toFixed(1) : '?'} s flushed on page hide), page 2 starts with chunk ${first2?.i} at ${first2?.t0} s`);
	const bytes = o.chunks.reduce((a, c) => a + c.bytes, 0);
	const dur = o.chunks.at(-1).t1 - o.chunks[0].t0;
	check(!!o.recording && o.recording.chunks === o.chunks.length && o.recording.bytes === bytes, `index document: ${o.recording?.chunks} chunks, ${o.recording?.bytes} bytes, ${o.recording?.duration} s`);
	console.log(`\nRecording of ${blockKey}: ${o.chunks.length} chunks, ${bytes} bytes for ${dur.toFixed(1)} s of play and ${o.trials.length} power-ups`);
	console.log(`  ${(bytes / dur).toFixed(0)} B/s, ${(bytes / dur * 60 / 1024).toFixed(1)} KB per minute, ${(bytes / o.chunks.length).toFixed(0)} B per chunk (min ${Math.min(...o.chunks.map((c) => c.bytes))}, max ${Math.max(...o.chunks.map((c) => c.bytes))})`);
	console.log(`  about ${(bytes / o.trials.length * 16 / 1024).toFixed(0)} KB for a 16-power-up run\n`);
	check(bytes / dur < 512, `under 0.5 KB per second of play (${(bytes / dur).toFixed(0)} B/s)`);
	check(o.trials.length >= POWER_UPS, `the run's ${o.trials.length} power-ups are there`);

	// ----- summary -> whole run -----
	await page.keyboard.press('v');
	await page.waitForTimeout(800);
	await snap('summary');
	await page.getByRole('link', { name: 'Watch the whole run' }).click();
	await page.waitForURL(`**/replays/run/${blockKey}**`);
	await page.waitForFunction(() => /All loaded/.test(document.querySelector('.legend')?.textContent ?? ''), null, { timeout: 30000 });
	await page.keyboard.press(' '); // it starts playing: stop it
	await page.waitForTimeout(500);
	check((await hashT()) < 2, `from the summary the whole run opens at its start (t=${await hashT()})`);
	await snap('player-start');

	// ----- the board at three random times equals a scene rebuilt from the chunks -----
	const all = await http.query(api.runRecordings.chunks, { blockKey, from: 0, to: 12 });
	for (let from = 12; from < o.chunks.length; from += 12) all.push(...await http.query(api.runRecordings.chunks, { blockKey, from, to: from + 12 }));
	const packed = all.map((c) => ({ i: c.i, mazeId: c.mazeId, b64: Buffer.from(c.data).toString('base64') }));
	const t0r = o.chunks[0].t0, t1r = o.chunks.at(-1).t1;
	const times = [0.23, 0.51, 0.87].map((k) => +(t0r + k * (t1r - t0r)).toFixed(2));
	for (const t of times) {
		await page.evaluate((t) => { location.hash = `t=${t}`; }, t);
		await page.waitForTimeout(700);
		const diff = await page.evaluate(async ({ packed, t, cueId }) => {
			const { decodeChunk } = await import('/src/lib/telemetry/runrec.ts');
			const { sceneAt } = await import('/src/lib/replay/interp.ts');
			const { renderScene } = await import('/src/lib/game/render/index.ts');
			const { cueById } = await import('/src/lib/game/cues/index.ts');
			const scenes = packed.flatMap((p) => {
				const bin = atob(p.b64), data = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
				return decodeChunk({ i: p.i, mazeId: p.mazeId, data: data.buffer }).scenes;
			});
			const scene = sceneAt(scenes, t);
			const board = document.querySelector('.board-wrap canvas');
			const tile = parseFloat(board.style.width) / scene.maze.W;
			const ref = document.createElement('canvas');
			renderScene(ref, scene, { cue: cueById(cueId), tile, reduceMotion: false, banners: true });
			if (ref.width !== board.width || ref.height !== board.height) return { size: [ref.width, ref.height, board.width, board.height] };
			const a = board.getContext('2d').getImageData(0, 0, board.width, board.height).data;
			const b = ref.getContext('2d').getImageData(0, 0, ref.width, ref.height).data;
			let off = 0;
			for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) off++;
			return { share: off / (a.length / 4), player: [scene.frame.player.x.toFixed(2), scene.frame.player.y.toFixed(2)], score: scene.frame.score };
		}, { packed, t, cueId: 'timer-bar' });
		check(diff.share !== undefined && diff.share < 0.002, `the board at t=${t} s matches the scene rebuilt from the chunks (${diff.share !== undefined ? (diff.share * 100).toFixed(3) + '% pixels differ' : 'size ' + diff.size}; player at ${diff.player}, score ${diff.score})`);
	}
	await snap('player-middle');

	// ----- jump points -----
	const expected = await page.evaluate(async (o) => {
		const { spansOf } = await import('/src/lib/replay/runline.ts');
		return spansOf(o.trials, o.chunks).map((s) => ({ jump: s.jump, n: s.trial.n, id: s.trial._id, start: s.start, until: s.until, base: s.base, kind: s.keyKind }));
	}, o);
	await page.keyboard.press('Home');
	await page.waitForTimeout(400);
	let landed = 0;
	for (const e of expected) {
		await page.keyboard.press('.');
		await page.waitForTimeout(450);
		const t = await hashT();
		const now = await page.evaluate(() => document.querySelector('.now')?.textContent?.replace(/\s+/g, ' ') ?? '');
		if (Math.abs(t - e.jump) < 0.011 && now.includes(`Power-up ${e.n}`)) landed++;
		else log(`jump ${e.n}: at ${t}, expected ${e.jump.toFixed(2)}; panel "${now.slice(0, 60)}"`);
	}
	check(landed === expected.length, `every jump point (${landed} of ${expected.length}) lands 2 s before its power-up's turn-away or end, inside that power-up`);
	await page.keyboard.press(',');
	await page.waitForTimeout(450);
	check(Math.abs((await hashT()) - expected.at(-2).jump) < 0.011, 'previous moment goes back one jump point');
	await page.locator('.moments .jumpto').nth(2).click();
	await page.waitForTimeout(450);
	check(Math.abs((await hashT()) - expected[2].jump) < 0.011, 'clicking a moment in the list jumps to it');
	await snap('player-moment');

	// ----- 4x -----
	await page.evaluate((t) => { location.hash = `t=${t}`; }, +(t0r + 2).toFixed(2));
	await page.waitForTimeout(500);
	await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
	await page.keyboard.press('5');
	const wall0 = Date.now();
	await page.keyboard.press(' ');
	await page.waitForTimeout(2500);
	await page.keyboard.press(' ');
	const wall = (Date.now() - wall0) / 1000;
	await page.waitForTimeout(500);
	const moved = (await hashT()) - (t0r + 2);
	check(moved > wall * 4 * 0.8 && moved < wall * 4 * 1.1, `4x playback: ${moved.toFixed(1)} s of run in ${wall.toFixed(1)} s`);
	await snap('player-4x');

	// ----- run sheet -> whole run -----
	await page.goto(APP + '/', { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	await page.locator(`.runs a.whole[href="/replays/run/${blockKey}"]`).click();
	await page.waitForURL(`**/replays/run/${blockKey}**`);
	await page.waitForTimeout(1500);
	check(page.url().includes(`/replays/run/${blockKey}`), 'the run sheet row opens the whole run');

	// ----- a trial's replay -> the whole run at that moment, and back -----
	const withClip = o.trials.find((t) => t.clipId) ?? o.trials[0];
	const exp = expected.find((e) => e.id === withClip._id);
	const clockEnd = withClip.endReason === 'expired' ? withClip.endedAt : withClip.startedAt + withClip.total;
	await page.goto(`${APP}/replays/${withClip._id}#left=1.00`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(2000);
	await snap('trial-replay');
	await page.getByRole('link', { name: 'Watch in the whole run' }).click();
	await page.waitForURL(`**/replays/run/${blockKey}**`);
	await page.waitForTimeout(2500);
	const want = exp.base + clockEnd - 1;
	const got = await hashT();
	check(Math.abs(got - want) < 0.06, `from a trial's replay the whole run opens at the same moment (t=${got}, expected ${want.toFixed(2)})`);
	await snap('player-from-trial');
	await page.locator('.now a.more').click();
	await page.waitForURL(`**/replays/${withClip._id}**`);
	check(page.url().includes(`/replays/${withClip._id}`), 'from the whole run, the detailed replay of that power-up');

	// ----- a replay card's link, and the whole-runs list -----
	await page.goto(`${APP}/replays/run/${withClip._id}`, { waitUntil: 'networkidle' });
	await page.waitForURL(`**/replays/run/${blockKey}**`, { timeout: 10000 });
	await page.waitForTimeout(1200);
	check(Math.abs((await hashT()) - exp.jump) < 0.06, 'a replay card\'s "Whole run" link (by trial id) opens the run at that power-up');
	await page.goto(`${APP}/replays?view=runs&source=bot`, { waitUntil: 'networkidle' });
	await page.waitForTimeout(1500);
	check(await page.locator(`a[href="/replays/run/${blockKey}"]`).count() === 1, 'the run is listed under Whole runs');
	await snap('whole-runs-list');

	// ----- export -----
	const json = await (await fetch(`${SITE}/export/run.json?blockKey=${blockKey}`)).json();
	const scenes = json.chunks.reduce((a, c) => a + c.scenes.length, 0), inputs = json.chunks.reduce((a, c) => a + c.inputs.length, 0);
	const events = json.chunks.flatMap((c) => c.events.map((e) => e.type));
	const marks = json.chunks.flatMap((c) => c.marks.map((m) => m.k));
	check(json.chunks.length === o.chunks.length && scenes > dur * 9 && inputs > 10 && events.includes('power') && events.includes('dot'),
		`JSON export: ${scenes} scenes, ${inputs} steer inputs, ${events.length} events, notes ${[...new Set(marks)].join(', ')}`);
	check(marks.filter((m) => m === 'page').length === 2 && marks.filter((m) => m === 'trial').length >= POWER_UPS, 'the export notes both pages of the run and every trial stored');
} catch (e) {
	check(false, `the full-run flow went through (${e instanceof Error ? e.message : e})`);
	await snap('error').catch(() => {});
}
check(errors.length === 0, `no page errors${errors.length ? `: ${[...new Set(errors)].slice(0, 5).join(' | ')}` : ''}`);
if (blockKey) console.log(`\nWhole run: ${APP}/replays/run/${blockKey}`);
console.log(`took ${((Date.now() - t0) / 60000).toFixed(1)} min`);
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
