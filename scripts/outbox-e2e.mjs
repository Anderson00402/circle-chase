#!/usr/bin/env node
// End-to-end check of the write outbox (src/lib/study/outbox.svelte.ts) in Chrome:
//   1. a scripted player plays a run; the network is cut for 20 s while trials keep coming;
//   2. the page is closed while writes are still queued (offline), leaving them in localStorage;
//   3. a fresh page of the console alone (no play page) adopts and delivers them.
// Then every trial the player measured must be in Convex, with the block's pauses and the session's
// endedAt. All data is tagged source: 'bot'.
//   node scripts/outbox-e2e.mjs [seconds=60]
import { chromium } from 'playwright';
import { ConvexHttpClient } from 'convex/browser';
import { anyApi as api } from 'convex/server';

const seconds = Number(process.argv[2] ?? 60);
const APP = 'http://localhost:5173';
const http = new ConvexHttpClient('http://127.0.0.1:3210');
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let failed = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`); if (!ok) failed++; };

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const errors = [];
const watch = (page, label) => {
	page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
	page.on('console', (m) => { if (m.type() === 'error') errors.push(`${label} console: ${m.text().slice(0, 200)}`); });
};

const player = await ctx.newPage();
watch(player, 'player');
await player.goto(`${APP}/play/timer-bar?rules=arcade&bot`, { waitUntil: 'networkidle' });
await player.keyboard.press('Enter');
await player.evaluate(async () => {
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	let g = null, bot = null;
	const loop = () => {
		const game = window.__cc?.game;
		if (game && game !== g) { g = game; bot = createBot(game, { seed: 5, skill: 0.95, awarenessNoise: 1.5, caution: 0.2, reaction: 0.3 }); }
		bot?.step();
		requestAnimationFrame(loop);
	};
	loop();
});
const state = () => player.evaluate(() => {
	const tel = window.__ccTelemetry;
	return { t: window.__cc?.game?.frame().t ?? 0, made: tel?.live.recent.length ?? 0, saved: tel?.live.saved ?? 0, pending: tel?.live.pending ?? 0, keys: tel?.keys, measured: tel ? [...tel.live.recent.map((r) => r.key)] : [] };
});

// Play online, then offline for the rest: trials made offline must survive closing the page.
const t0 = Date.now();
let s = await state();
while (Date.now() - t0 < seconds * 1000) {
	await sleep(5000);
	const el = (Date.now() - t0) / 1000;
	if (el > seconds - 20 && !ctx._off) { await ctx.setOffline(true); ctx._off = true; log('network OFF'); }
	s = await state();
	log(`t=${s.t.toFixed(1)} measured=${s.made} saved=${s.saved} pending=${s.pending}`);
}
// A pause of 2 s (then play on), then close the page while still offline: the block end is
// queued on page hide, with the pause.
await player.evaluate(() => window.__cc.setPaused(true));
await sleep(2000);
await player.evaluate(() => window.__cc.setPaused(false));
await sleep(1500);
s = await state();
const keys = s.keys;
const allKeys = await player.evaluate(() => window.__ccTelemetry.live.recent.map((r) => r.key));
const queued = await player.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cc.outbox.')).length);
log(`closing the player while offline: ${s.pending} writes pending, ${queued} queue entries stored`);
check(s.pending > 0, 'writes were waiting when the page closed (offline)');
await player.close({ runBeforeUnload: true });
await ctx.setOffline(false);
log('network ON; opening the console alone');

// The console alone must deliver them (the root layout starts the outbox and adopts leftovers).
const consolePage = await ctx.newPage();
watch(consolePage, 'console');
await consolePage.goto(`${APP}/?bot`, { waitUntil: 'networkidle' });
let left = 1;
for (let i = 0; i < 40 && left; i++) {
	await sleep(1000);
	left = await consolePage.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('cc.outbox.') || k.startsWith('cc.queue.')).length);
}
check(left === 0, `console delivered the leftovers (${left} queue entries left)`);
await sleep(1500);

// ---- read back ----
const sessions = await http.query(api.sessions.overview, { source: 'bot', limit: 20 });
const session = sessions.find((x) => x.key === keys.sessionKey);
check(!!session, 'session stored');
const { page: trials } = await http.query(api.trials.list, { source: 'bot', sessionId: session._id, paginationOpts: { numItems: 500, cursor: null } });
const stored = new Set(trials.map((t) => t.key));
const missing = allKeys.filter((k) => !stored.has(k));
check(missing.length === 0, `every measured trial stored (${allKeys.length} recent measured, ${trials.length} stored, ${missing.length} missing)`);
const block = session.blocks[0];
check(block?.endedAt !== null, 'block closed');
check(session.endedAt !== null, `session endedAt set (${session.endedAt})`);
const full = await http.query(api.runs.block, { blockKey: keys.blockKey });
log('block', JSON.stringify({ trials: full?.trials, deaths: full?.deaths, score: full?.score }));
const blocks = await (await fetch(`http://127.0.0.1:3211/export/blocks.csv?source=bot&sessionId=${session._id}`)).text();
const [head, row] = blocks.trim().split('\n');
const cols = Object.fromEntries(head.split(',').map((c, i) => [c, row?.split(',')[i]]));
check(Number(cols.pauses) >= 1 && Number(cols.pausedSeconds) >= 1.5, `pauses sent with the block end (pauses=${cols.pauses}, pausedSeconds=${cols.pausedSeconds})`);
check(/^\d+\.\d+\.\d+\+\w+/.test(session.appVersion), `appVersion is a build id (${session.appVersion})`);
check(session.inputType.startsWith('automated'), `input type says automated (${session.inputType})`);
if (errors.length) console.log('page errors:\n ' + [...new Set(errors)].slice(0, 10).join('\n '));
await browser.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
