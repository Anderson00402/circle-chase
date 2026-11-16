<script lang="ts">
	/**
	 * Development tool: a film strip of one power-up drawn with a cue.
	 *
	 *   /dev/strip?cue=ink-refill              one bot-played power-up, frames from start to after the end
	 *   &seed=3  &level=2  &tile=16  &reduce=1  &dense=1 (more frames in the last 2 s)
	 *
	 * A bot plays a seeded study-mode game off screen; the power-up with the most scared ghosts
	 * still out when the timer ends is shown. Because drawing is a pure function of the scene, this
	 * is exactly what a player would see at each moment.
	 */
	import { page } from '$app/state';
	import { cueById, CUES } from '#lib/game/cues/index.ts';
	import { createGame, STUDY_CONFIG } from '#lib/game/engine/game.ts';
	import { createBot } from '#lib/game/engine/bot.ts';
	import { SceneView } from '#lib/game/render/index.ts';
	import type { Scene } from '#lib/game/types.ts';

	const q = $derived(page.url.searchParams);
	const cue = $derived(cueById(q.get('cue')));
	const tile = $derived(+(q.get('tile') ?? 15));
	const reduce = $derived(q.get('reduce') === '1');

	interface Shot { label: string; scene: Scene }

	function build(seed: number, level: number, dense: boolean): { shots: Shot[]; note: string } {
		const game = createGame({ ...STUDY_CONFIG, seed, startLevel: level });
		// Cautious bot: it eats a ghost or two early, then keeps away, so scared ghosts survive to the end.
		const bot = createBot(game, { seed, skill: 1, awarenessNoise: 0, caution: 3 });
		const STEP = 1 / 120;
		type Take = { scenes: Scene[]; scaredAtEnd: number; total: number; endT: number };
		let cur: Take | null = null, best: Take | null = null, after = 0, lastScared = 0;
		for (let i = 0; i < 240 / STEP; i++) {
			bot.step();
			game.update(STEP);
			if (i % 4) continue; // 30 Hz
			const s = game.scene();
			const f = s.frame;
			if (f.events.some((e) => e.type === 'power')) { cur = { scenes: [], scaredAtEnd: 0, total: f.power.total, endT: -1 }; after = 0; }
			if (!cur) continue;
			cur.scenes.push({ maze: s.maze, dots: s.dots.slice(), frame: f });
			if (f.power.left > 0) lastScared = f.ghosts.filter((g) => g.scared).length;
			else if (cur.endT < 0) {
				if (f.power.endReason !== 'expired') { cur = null; continue; }
				cur.endT = f.power.endedAt;
				cur.scaredAtEnd = lastScared;
			}
			if (cur.endT >= 0 && (after += STEP * 4) >= 1.6) {
				if (!best || cur.scaredAtEnd > best.scaredAtEnd) best = cur;
				cur = null;
				if (best.scaredAtEnd >= 3) break;
			}
		}
		if (!best) return { shots: [], note: 'No complete power-up found for this seed.' };
		const b = best;
		// Moments to show, as seconds left (negative = after the end).
		const lefts = dense
			? [b.total - 0.05, 2.4, 2.0, 1.8, 1.6, 1.4, 1.2, 1.0, 0.8, 0.6, 0.4, 0.3, 0.2, 0.1, 0.03, -0.05, -0.15, -0.3, -0.6, -1.2]
			: [b.total - 0.05, b.total - 0.5, b.total * 0.75, b.total * 0.5, 3, 2, 1.5, 1, 0.6, 0.3, 0.1, -0.1, -0.4, -1.2];
		const timeLeft = (s: Scene) => (s.frame.power.left > 0 ? s.frame.power.left : b.endT >= 0 && s.frame.t >= b.endT ? b.endT - s.frame.t : s.frame.power.left);
		const shots = lefts.map((want) => {
			let pick = b.scenes[0], err = Infinity;
			for (const s of b.scenes) { const e = Math.abs(timeLeft(s) - want); if (e < err) { err = e; pick = s; } }
			const l = timeLeft(pick);
			return { label: l >= 0 ? `${l.toFixed(2)} s left` : `${(-l).toFixed(2)} s after`, scene: pick };
		});
		return { shots, note: `${b.total.toFixed(1)} s power-up, ${b.scaredAtEnd} scared at the end, maze ${b.scenes[0].maze.name}, seed ${seed}` };
	}

	const result = $derived(build(+(q.get('seed') ?? 1), +(q.get('level') ?? 1), q.get('dense') === '1'));
</script>

<svelte:head><title>Film strip · {cue.name} · Circle Chase</title></svelte:head>

<div class="dev">
	<h1>{cue.code} · {cue.name} <small>{result.note}{reduce ? ' · reduced motion' : ''}</small></h1>
	<nav>
		{#each CUES as c (c.id)}
			<a href="?cue={c.id}" class:on={c.id === cue.id}>{c.code} {c.name}</a>
		{/each}
	</nav>
	<div class="grid">
		{#each result.shots as shot, i (i)}
			<figure>
				<SceneView scene={shot.scene} {cue} {tile} reduceMotion={reduce} banners={false} />
				<figcaption>{shot.label}</figcaption>
			</figure>
		{/each}
	</div>
</div>

<style>
	.dev { padding: 12px 16px 32px; }
	h1 { font: 600 16px var(--font-body, system-ui); margin: 0 0 6px; }
	h1 small { font-weight: 400; opacity: 0.7; margin-left: 10px; }
	nav { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 12px; margin-bottom: 12px; }
	nav a { color: inherit; opacity: 0.7; text-decoration: none; }
	nav a.on { opacity: 1; text-decoration: underline; }
	.grid { display: flex; flex-wrap: wrap; gap: 10px; }
	figure { margin: 0; max-width: 100%; }
	/* Phones: frames shrink to the screen instead of scrolling the page sideways. */
	figure :global(canvas) { max-width: 100%; height: auto !important; }
	h1 { overflow-wrap: anywhere; }
	figcaption { font: 12px var(--font-mono, monospace); opacity: 0.85; padding-top: 3px; text-align: center; }
</style>
