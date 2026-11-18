#!/usr/bin/env node
// Records one short video per condition (the two references, the timer bar and the ten ideas),
// all showing exactly the same scripted power-up, as small MP4 files.
//
//   node scripts/record-cues.mjs                     all 13, into media/countdowns/
//   node scripts/record-cues.mjs --only wall-tide,ink-refill
//   --out media/countdowns   --tile 28   --scale 2   --fps 60   --crf 20   --seed 0 (0 = search)
//
// How it works: the dev server must be running (:5173). A headless page imports the real engine,
// bot and renderer, lets the bot play a seeded study-rules game off screen, and keeps the power-up
// with the most scared ghosts still out when the power ends (one second before the power dot to two
// seconds after the end, a scene per video frame). Drawing is a pure function of a scene, so each
// condition is drawn from the same scenes: the videos differ only in the cue. Frames go straight
// into ffmpeg as PNGs; nothing is written to disk but the MP4.
//
// Why MP4 and not GIF: a GIF of this size and frame rate is around 200 MB (256 colours per frame,
// no motion compression). H.264 gives the same picture in about 1-3 MB and plays everywhere.
// The videos are silent: cue sounds (heartbeat, the count's ticks) are not recorded.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
const out = resolve(opt('out', 'media/countdowns'));
const tile = +opt('tile', 28), scale = +opt('scale', 2), fps = +opt('fps', 60), crf = +opt('crf', 20);
const seedArg = +opt('seed', 0);
const only = (opt('only', '') || '').split(',').filter(Boolean);
const APP = 'http://localhost:5173';

/** File name per condition: references first, then the timer bar (00) and ideas 01-10. */
const fileName = (cue) => {
	const n = cue.role === 'reference' ? `ref-${cue.code}` : String(cue.code).padStart(2, '0');
	return `${n}-${cue.id}.mp4`;
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
await page.goto(APP + '/dev/strip?cue=none', { waitUntil: 'networkidle' });

// Build the scenes once, in the page, with the real engine and bot.
const info = await page.evaluate(async ({ fps, seedArg, tile, scale }) => {
	const { createGame, STUDY_CONFIG } = await import('/src/lib/game/engine/game.ts');
	const { createBot } = await import('/src/lib/game/engine/bot.ts');
	const { CUES } = await import('/src/lib/game/cues/index.ts');
	const { renderScene } = await import('/src/lib/game/render/renderer.ts');
	const STEP = 1 / 120, per = Math.round(1 / fps / STEP), POWER = 6, LEAD = 1, TAIL = 2;
	const leadN = Math.round(LEAD * fps), tailN = Math.round(TAIL * fps);

	function take(seed) {
		const game = createGame({ ...STUDY_CONFIG, seed, frightRange: [POWER, POWER], powerRespawn: 6 });
		// A cautious bot eats a ghost early and then keeps its distance, so scared ghosts survive to the end.
		const bot = createBot(game, { seed, skill: 1, awarenessNoise: 0, caution: 2.5, reaction: 0.3 });
		const recent = [];
		let cur = null, best = null, lastScared = 0;
		const score = (t) => t.scaredAtEnd * 2 + Math.min(t.eats, 2);
		for (let i = 0; i < 80 / STEP; i++) {
			bot.step();
			game.update(STEP);
			if (i % per) continue;
			const s = game.scene(), f = s.frame;
			const snap = { maze: s.maze, dots: s.dots.slice(), frame: f };
			if (f.phase === 'dying') { cur = null; }
			if (f.events.some((e) => e.type === 'power')) cur = { scenes: recent.slice(-leadN), end: -1, scaredAtEnd: 0, eats: 0 };
			recent.push(snap);
			if (recent.length > leadN + 2) recent.shift();
			if (!cur) continue;
			cur.scenes.push(snap);
			cur.eats += f.events.filter((e) => e.type === 'eat').length;
			if (f.power.left > 0) lastScared = f.ghosts.filter((g) => g.scared && g.mode === 'active').length;
			else if (cur.end < 0) {
				if (f.power.endReason !== 'expired') { cur = null; continue; }
				cur.end = cur.scenes.length - 1;
				cur.scaredAtEnd = lastScared;
			}
			if (cur.end >= 0 && cur.scenes.length - cur.end >= tailN) {
				if (!best || score(cur) > score(best)) best = cur;
				cur = null;
			}
		}
		return best && { ...best, score: score(best), seed };
	}

	let best = null;
	for (const seed of seedArg ? [seedArg] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
		const t = take(seed);
		if (t && (!best || t.score > best.score)) best = t;
		if (best && best.scaredAtEnd >= 3 && best.eats >= 1) break;
	}
	if (!best) return null;
	const canvas = document.createElement('canvas');
	document.body.replaceChildren(canvas);
	window.__rec = { scenes: best.scenes, canvas, renderScene, CUES, tile, scale };
	const m = best.scenes[0].maze;
	return {
		frames: best.scenes.length, seed: best.seed, scaredAtEnd: best.scaredAtEnd, eats: best.eats, maze: m.name,
		width: Math.round(m.W * tile * scale), height: Math.round(m.H * tile * scale),
		cues: CUES.map((c) => ({ id: c.id, code: c.code, role: c.role, name: c.name }))
	};
}, { fps, seedArg, tile, scale });

if (!info) { console.error('No complete power-up found.'); await browser.close(); process.exit(1); }
console.log(`Scene: ${info.maze}, seed ${info.seed}, ${info.frames} frames at ${fps} fps (${(info.frames / fps).toFixed(1)} s), ` +
	`${info.eats} ghost(s) eaten, ${info.scaredAtEnd} scared at the end. Frame ${info.width}x${info.height}.`);

const todo = info.cues.filter((c) => !only.length || only.includes(c.id));
for (const cue of todo) {
	const file = join(out, fileName(cue));
	// H.264 needs even dimensions; yuv420p plays everywhere. -tune animation suits flat colours and sharp lines.
	const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
		'-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation',
		'-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', file], { stdio: ['pipe', 'inherit', 'inherit'] });
	const done = new Promise((ok, fail) => ff.on('close', (code) => (code === 0 ? ok() : fail(new Error('ffmpeg exit ' + code)))));
	const BATCH = 12;
	for (let i = 0; i < info.frames; i += BATCH) {
		const pngs = await page.evaluate(async ({ id, from, to }) => {
			const r = window.__rec, cue = r.CUES.find((c) => c.id === id), outp = [];
			for (let k = from; k < to; k++) {
				r.renderScene(r.canvas, r.scenes[k], { cue, tile: r.tile, dpr: r.scale, reduceMotion: false, banners: false });
				outp.push(r.canvas.toDataURL('image/png').slice(22));
			}
			return outp;
		}, { id: cue.id, from: i, to: Math.min(info.frames, i + BATCH) });
		for (const b64 of pngs) if (!ff.stdin.write(Buffer.from(b64, 'base64'))) await new Promise((ok) => ff.stdin.once('drain', ok));
	}
	ff.stdin.end();
	await done;
	console.log(`${fileName(cue).padEnd(28)} ${(statSync(file).size / 1e6).toFixed(2)} MB`);
}
await browser.close();
console.log('Written to', out);
