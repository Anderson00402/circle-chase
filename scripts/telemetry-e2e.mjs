#!/usr/bin/env node
// End-to-end check of telemetry: a scripted player plays /play/timer-bar?mode=study in Chrome while
// a second page and a Node subscriber watch the per-cue summary update live; then the stored
// trials and clips are read back from Convex, and one clip is decoded and redrawn in the browser.
//   node scripts/telemetry-e2e.mjs [seconds=100] [--keep]   (--keep: do not clear old bot data first)
// Needs the dev server (:5173) and Convex (:3210). All data is tagged source: 'bot'.
import { chromium } from 'playwright';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const seconds = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const CONVEX = 'http://127.0.0.1:3210', SITE = 'http://127.0.0.1:3211', APP = 'http://localhost:5173';
const PATH = '/play/timer-bar?mode=study';
const stamp = () => new Date().toISOString().slice(11, 19);
const http = new ConvexHttpClient(CONVEX);

if (!args.includes('--keep')) {
	let r = await http.mutation(api.admin.deleteBotData, { confirm: 'delete bot data' });
	console.log('cleared old bot data', r.deleted);
	while (r.continuing) { await new Promise((ok) => setTimeout(ok, 500)); r = { continuing: false }; }
}

// Second watcher: a plain Node subscription to the same query the dashboard will use.
const sub = new ConvexClient(CONVEX);
const subLog = [];
sub.onUpdate(api.summary.byCue, { source: 'bot', cue: 'timer-bar' }, (r) => {
	const c = r.cues.find((x) => x.cue === 'timer-bar');
	subLog.push({ at: stamp(), trials: c?.trials ?? 0 });
	console.log(`[node subscriber ${stamp()}] timer-bar (bot): ${c?.trials ?? 0} trials, ${c?.inRates ?? 0} count toward rates`);
});

const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];
const open = async (label) => {
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
	const page = await ctx.newPage();
	page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
	page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${label} console: ${m.text().slice(0, 200)}`); });
	await page.goto(APP + PATH, { waitUntil: 'networkidle' });
	return page;
};

// The viewer only shows the page (its "Stored for this cue" box is a live Convex query).
const viewer = await open('viewer');
const player = await open('player');
await player.bringToFront();
await player.keyboard.press('Enter');
await player.evaluate(async () => {
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	let g = null, bot = null;
	const loop = () => {
		const game = window.__cc.game;
		if (game !== g) { g = game; bot = createBot(game, { seed: 3, skill: 0.95, awarenessNoise: 1.5, caution: 0.2, reaction: 0.3 }); }
		bot.step();
		requestAnimationFrame(loop);
	};
	loop();
});

const viewerCount = () => viewer.evaluate(() => {
	const box = [...document.querySelectorAll('.stored .row')].find((r) => r.textContent.includes('Trials'));
	return box ? Number(box.querySelector('.num').textContent) : 0;
});
const viewerLog = [];
const t0 = Date.now();
while (Date.now() - t0 < seconds * 1000) {
	await new Promise((ok) => setTimeout(ok, 10_000));
	const s = await player.evaluate(() => {
		const tel = window.__ccTelemetry, f = window.__cc.game.frame();
		return { t: f.t.toFixed(1), score: f.score, saved: tel.live.saved, pending: tel.live.pending, recent: tel.live.recent.map((r) => r.outcome).slice(0, 4) };
	});
	const v = await viewerCount();
	viewerLog.push({ at: stamp(), trials: v });
	console.log(`[player ${stamp()}] game t=${s.t} score=${s.score} saved=${s.saved} pending=${s.pending} recent=${s.recent.join(', ')} | [viewer page] shows ${v} trials`);
}

const keys = await player.evaluate(async () => { await window.__ccTelemetry.endBlock(6000); return window.__ccTelemetry.keys; });
await new Promise((ok) => setTimeout(ok, 1500));
const viewerFinal = await viewerCount();

// ---- read back from Convex ----
const sessions = await http.query(api.sessions.overview, { source: 'bot', limit: 10 });
const session = sessions.find((s) => s.key === keys.sessionKey);
const { page: trials } = await http.query(api.trials.list, { source: 'bot', sessionId: session._id, paginationOpts: { numItems: 200, cursor: null } });
trials.reverse();
console.log(`\nSession ${session._id}: mode=${session.mode} source=${session.source} input=${session.inputType} app=${session.appVersion} blocks=${session.blocks.length} (${session.blocks.map((b) => `${b.cue}: ${b.trialCount} trials, ${b.deaths} deaths, score ${b.score}`).join('; ')})`);
console.log('\n #  len  end        outcome         eng  turn   tdist endD  closing eats(left)       caught after  fps  clip');
const clipSizes = [];
for (const t of trials) {
	let clip = null;
	if (t.clipId) { clip = await http.query(api.clips.get, { id: t.clipId }); clipSizes.push(clip.size); }
	const f = (x, d = 2) => (x === null || x === undefined ? '-' : Number(x).toFixed(d));
	console.log([
		String(t.trialIndex).padStart(2), f(t.total, 1).padStart(4), t.endReason.padEnd(10), t.outcome.padEnd(15), (t.engaged ? 'yes' : 'no').padEnd(4),
		f(t.turnLeft).padStart(5), f(t.turnDist, 1).padStart(5), f(t.endDist, 1).padStart(5), String(t.endClosing ?? '-').padEnd(7),
		(t.eats.map((e) => e.left.toFixed(1)).join(' ') || '-').padEnd(16), String(t.after.caught).padEnd(6), f(t.after.seen, 1).padStart(5),
		f(t.fps, 0).padStart(4), clip ? `${(clip.size / 1024).toFixed(1)} KB ${clip.scenes} scenes` : '-'
	].join(' '));
}
const one = trials.find((t) => t.clipId) ?? trials[0];
const full = await http.query(api.trials.get, { id: one._id });
console.log(`\ntrials:get ${one._id}: series of ${full.series.t.length} samples (t ${full.series.t[0]}..${full.series.t.at(-1)} s, left ${full.series.left[0]}..${full.series.left.at(-1)})`);
if (clipSizes.length) console.log(`clips: ${clipSizes.length}, size min ${(Math.min(...clipSizes) / 1024).toFixed(1)} KB, max ${(Math.max(...clipSizes) / 1024).toFixed(1)} KB, mean ${(clipSizes.reduce((a, b) => a + b, 0) / clipSizes.length / 1024).toFixed(1)} KB`);

const sum = await http.query(api.summary.byCue, { source: 'bot', cue: 'timer-bar' });
const c = sum.cues[0];
console.log(`summary:byCue (bot, timer-bar): trials ${c.trials}, engaged ${c.engaged}, in rates ${c.inRates}, participants ${c.participants}, outcomes ${JSON.stringify(c.outcomes)}`);
console.log(`  caught ${c.caught.k}/${c.caught.n} [${c.caught.lo?.toFixed(2)}-${c.caught.hi?.toFixed(2)}], well timed ${c.wellTimed.k}/${c.wellTimed.n} [${c.wellTimed.lo?.toFixed(2)}-${c.wellTimed.hi?.toFixed(2)}], turn-away median ${c.turnAway.median} (n ${c.turnAway.n}), wasted mean ${c.wasted.mean}, not enough data: ${c.notEnoughData}`);
const counters = await http.query(api.live.counters, { source: 'bot' });
console.log(`live:counters (bot): ${JSON.stringify({ ...counters, playing: counters.playing.length })}`);
const moments = await http.query(api.clips.moments, { source: 'bot', paginationOpts: { numItems: 5, cursor: null } });
console.log(`clips:moments newest: ${moments.page.map((m) => `${m.outcome}@${new Date(m.createdAt).toISOString().slice(11, 19)}`).join(', ')}`);
const csv = await (await fetch(`${SITE}/export/trials.csv?source=bot`)).text();
console.log(`GET /export/trials.csv?source=bot: ${csv.trim().split('\n').length - 1} rows, ${csv.split('\n')[0].split(',').length} columns`);

// ---- decode a clip and redraw it with the real renderer ----
const withClip = trials.filter((t) => t.clipId);
if (withClip.length) {
	const pick = withClip.find((t) => t.outcome === 'caught' || t.outcome === 'overstayed') ?? withClip[0];
	const clip = await http.query(api.clips.get, { id: pick.clipId });
	const b64 = Buffer.from(clip.data).toString('base64');
	const info = await player.evaluate(async ({ clip, b64 }) => {
		const { decodeClip } = await import('/src/lib/telemetry/recorder.ts');
		const { renderScene } = await import('/src/lib/game/render/renderer.ts');
		const { cueById } = await import('/src/lib/game/cues/index.ts');
		const bin = atob(b64), data = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
		const decoded = decodeClip({ ...clip, data: data.buffer });
		const end = decoded.markers.find((m) => m.kind === 'powerEnd').t;
		const at = (t) => decoded.scenes.reduce((a, s) => (Math.abs(s.frame.t - t) < Math.abs(a.frame.t - t) ? s : a));
		const wrap = document.createElement('div');
		wrap.id = 'clipcheck';
		wrap.style.cssText = 'position:fixed;inset:0;z-index:99;background:#05081a;display:flex;gap:12px;padding:12px;align-items:flex-start';
		document.body.append(wrap);
		const shots = [-1.0, 0, 0.8].map((dt) => {
			const s = at(end + dt);
			const c = document.createElement('canvas');
			const label = document.createElement('div');
			label.style.cssText = 'color:#eef3ff;font:13px system-ui;margin-bottom:4px';
			label.textContent = `t = ${(s.frame.t - end).toFixed(2)} s from the end · left ${s.frame.power.left.toFixed(2)} · ${s.frame.ghosts.map((g) => g.scared ? 'scared' : g.mode).join('/')}`;
			const box = document.createElement('div');
			box.append(label, c);
			wrap.append(box);
			renderScene(c, s, { cue: cueById(clip.cue), width: 400, dpr: 1 });
			return label.textContent;
		});
		return { scenes: decoded.scenes.length, markers: decoded.markers.map((m) => m.kind), shots };
	}, { clip: { ...clip, data: null }, b64 });
	await player.locator('#clipcheck').screenshot({ path: '.shots/telemetry-clip-redraw.png' });
	console.log(`\ndecoded clip of trial ${pick.trialIndex} (${pick.outcome}): ${info.scenes} scenes, markers ${info.markers.join(', ')}`);
	for (const s of info.shots) console.log('  drew', s);
	console.log('  saved .shots/telemetry-clip-redraw.png');
}

console.log(`\nlive updates: node subscriber saw ${subLog.length} updates (${subLog.map((u) => u.trials).join(' → ')}); viewer page showed ${viewerLog.map((u) => u.trials).join(' → ')} → ${viewerFinal}`);
if (errors.length) console.log('page errors/warnings:\n  ' + errors.slice(0, 10).join('\n  '));
writeFileSync('.shots/telemetry-e2e.json', JSON.stringify({ keys, trials: trials.length, clipSizes, subLog, viewerLog, viewerFinal }, null, 1));
await browser.close();
await sub.close();
process.exit(0);
