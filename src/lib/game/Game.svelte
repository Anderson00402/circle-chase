<script lang="ts">
	/**
	 * The playable board: owns the game loop, input, sizing, sound, HUD and the start / pause /
	 * game over overlays. Everything outside (telemetry, pages) listens through `onframe`.
	 *
	 *   <Game {cue} />                                 the normal game
	 *   <Game {cue} compact controls={false} onframe={(s, g) => bot(g)} />   a preview driven from outside
	 */
	import { onMount, tick } from 'svelte';
	import type { Cue, Facing, Frame, Game, GameConfig, Scene } from './types';
	import { createGame, DIFFICULTY } from './engine/game';
	import { createRenderer, paletteFor, type Renderer } from './render/renderer';
	import { drawHero } from './render/actors';
	import { bonusName, drawBonus } from './render/items';
	import { createSfx } from './audio/sfx';

	interface Props {
		cue: Cue;
		config?: Partial<GameConfig>;
		/** Called with every drawn frame while the game is running (not while paused). */
		onframe?: (scene: Scene, game: Game) => void;
		/** Called when a new game starts, including the first. */
		onstart?: (game: Game) => void;
		/** Largest tile size in CSS pixels. */
		maxTile?: number;
		/** Sound on or off. Bindable; starts from the player's saved choice. */
		sound?: boolean;
		/** No HUD and no overlays; the board fills its container (previews). */
		compact?: boolean;
		/** Keyboard and swipe input, overlays, pause on blur. Off: runs at once and is driven from outside via `game.steer`. */
		controls?: boolean;
	}
	let {
		cue, config = {}, onframe, onstart, maxTile = 34, sound = $bindable(), compact = false, controls = true
	}: Props = $props();

	const STEP = 1 / 120;
	const KEYS: Record<string, Facing> = {
		ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3
	};
	const SOUND_KEY = 'cc:sound';
	const store = {
		get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
		set(key: string, v: string) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }
	};

	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	let primaryBtn = $state<HTMLButtonElement>();
	// Not reactive on purpose: the loop reads it every frame.
	// svelte-ignore non_reactive_update, state_referenced_locally
	let game: Game = createGame(config);
	let renderer: Renderer | null = null;
	const sfx = createSfx();
	let prev: Frame | null = null;

	let overlay = $state<'title' | 'paused' | 'over' | null>(null);
	let running = $state(false);
	let hud = $state({ score: 0, level: 1, lives: 3, maze: '', best: 0 });
	let bonuses = $state<number[]>([]);
	let newBest = $state(false);
	let readyLabel = 'READY';
	let lastBonusKind = 0;
	let jinglePending = true;

	// svelte-ignore state_referenced_locally
	if (sound === undefined) sound = store.get(SOUND_KEY) !== '0';
	$effect(() => sfx.setEnabled(!!sound));

	const arcade = () => game.config.mode === 'arcade';
	const bestKey = () => `cc:best:${game.config.difficulty}`;
	const readBest = () => (arcade() ? Number(store.get(bestKey())) || 0 : 0);
	function saveBest() {
		if (arcade() && hud.score > readBest()) store.set(bestKey(), String(hud.score));
	}

	function toggleSound() {
		sound = !sound;
		store.set(SOUND_KEY, sound ? '1' : '0');
		if (sound) sfx.wake();
	}

	function fit() {
		if (!renderer || !wrap) return;
		const m = game.maze;
		const ratio = Math.min(window.devicePixelRatio || 1, 3);
		let roomW = wrap.clientWidth, roomH: number;
		if (compact) roomH = wrap.clientHeight || Infinity;
		else {
			// Whatever is left of the viewport below the board's top edge, so nothing scrolls.
			const top = canvas.getBoundingClientRect().top + window.scrollY;
			roomH = Math.max(160, window.innerHeight - Math.max(0, top - window.scrollY) - 16);
		}
		const t = Math.max(6, Math.min(maxTile, Math.floor(Math.min(roomW / m.W, roomH / m.H))));
		renderer.resize(m, t, ratio);
	}

	function syncHud(f: Frame) {
		const best = Math.max(readBest(), arcade() ? f.score : 0);
		if (f.score !== hud.score || f.level !== hud.level || f.lives !== hud.lives || game.maze.name !== hud.maze || best !== hud.best) {
			hud = { score: f.score, level: f.level, lives: f.lives, maze: game.maze.name, best };
		}
	}

	function newGame() {
		saveBest();
		sfx.reset();
		game = createGame({ ...config, seed: config.seed ?? (Math.random() * 2 ** 31) | 0 });
		prev = null;
		readyLabel = 'READY';
		bonuses = [];
		newBest = false;
		jinglePending = true;
		syncHud(game.frame());
		fit();
		onstart?.(game);
	}

	async function begin() {
		sfx.wake();
		running = true;
		overlay = null;
		if (jinglePending) { sfx.jingle(); jinglePending = false; }
		sfx.suspend(false);
		await tick();
		if (controls) canvas?.focus();
	}

	export function restart() {
		newGame();
		begin();
	}

	export function setPaused(p: boolean) {
		if (!running) return;
		overlay = p ? 'paused' : null;
		sfx.suspend(p);
		if (p) saveBest();
		else tick().then(() => controls && canvas?.focus());
	}

	function primary() {
		if (overlay === 'over') restart();
		else if (overlay === 'paused') setPaused(false);
		else begin();
	}

	// Move focus into the overlay when it opens, so Enter / Space work and screen readers announce it.
	$effect(() => {
		if (overlay && primaryBtn) primaryBtn.focus();
	});

	function onkeydown(ev: KeyboardEvent) {
		if (!controls || ev.metaKey || ev.ctrlKey || ev.altKey) return;
		const tag = (ev.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (ev.code in KEYS) {
			ev.preventDefault();
			if (running && !overlay) game.steer(KEYS[ev.code]);
			return;
		}
		if (ev.code === 'KeyM') { toggleSound(); return; }
		if (ev.code === 'KeyP' || ev.code === 'Escape') {
			if (running && overlay !== 'over') setPaused(overlay !== 'paused');
		} else if (ev.code === 'Space' || ev.code === 'Enter') {
			if (tag === 'BUTTON' || tag === 'A') return;
			ev.preventDefault();
			if (overlay) primary();
			else if (ev.code === 'Space' && running) setPaused(true);
		}
	}

	let swipe: { x: number; y: number; id: number } | null = null;
	function pointerdown(ev: PointerEvent) {
		if (!controls) return;
		swipe = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
		if (ev.pointerType !== 'mouse') sfx.wake();
	}
	function pointermove(ev: PointerEvent) {
		if (!swipe || ev.pointerId !== swipe.id) return;
		const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
		if (Math.hypot(dx, dy) < 16) return;
		const d: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : dy > 0 ? 2 : 0;
		if (running && !overlay) game.steer(d);
		swipe.x = ev.clientX;
		swipe.y = ev.clientY;
	}

	/** Paints a small HUD icon (a life or a bonus item) on a canvas. */
	function icon(node: HTMLCanvasElement, what: { life?: boolean; bonus?: number }) {
		const paint = (w: typeof what) => {
			const css = node.clientWidth || 18, r = Math.min(window.devicePixelRatio || 1, 3);
			node.width = Math.round(css * r);
			node.height = Math.round(css * r);
			const c = node.getContext('2d')!;
			c.setTransform(r, 0, 0, r, 0, 0);
			c.clearRect(0, 0, css, css);
			if (w.life) drawHero(c, paletteFor(game.maze), css * 0.98, css / 2, css / 2 + css * 0.06, 3, 0.25, false, 0, { open: 0.35 });
			else drawBonus(c, w.bonus ?? 0, css / 2, css / 2, css * 0.92);
		};
		paint(what);
		return { update: paint };
	}

	onMount(() => {
		renderer = createRenderer(canvas);
		newGame();
		if (controls) overlay = 'title';
		else { running = true; overlay = null; }
		// Development hook for automated checks: `window.__cc.game` is the live game.
		if (import.meta.env.DEV) {
			(window as unknown as Record<string, unknown>).__cc = {
				get game() { return game; }, begin, restart, setPaused, get renderer() { return renderer; }, sfx
			};
		}
		const reduce = matchMedia('(prefers-reduced-motion: reduce)');
		let last = performance.now(), acc = 0, raf = 0;
		const frameLoop = (now: number) => {
			raf = requestAnimationFrame(frameLoop);
			const dt = Math.min(0.25, (now - last) / 1000);
			last = now;
			const live = running && !overlay;
			if (live) {
				acc += dt;
				while (acc >= STEP) { game.update(STEP); acc -= STEP; }
			} else acc = 0;
			const scene = game.scene();
			const f = scene.frame;
			if (live) {
				sfx.play(f);
				if (prev) cue.sound?.(prev, f, sfx);
				for (const e of f.events) {
					if (e.type === 'level') { readyLabel = `LEVEL ${e.level}`; fit(); }
					if (e.type === 'die') readyLabel = 'READY';
					if (e.type === 'bonusShow') lastBonusKind = e.kind;
					if (e.type === 'bonus') bonuses = [...bonuses, lastBonusKind];
					if (e.type === 'over') {
						running = false;
						newBest = arcade() && f.score > readBest() && f.score > 0;
						saveBest();
						if (controls) overlay = 'over';
					}
				}
				onframe?.(scene, game);
				prev = f;
			}
			syncHud(f);
			renderer!.draw(scene, { cue, reduceMotion: reduce.matches, readyLabel });
		};
		raf = requestAnimationFrame(frameLoop);
		const ro = new ResizeObserver(fit);
		ro.observe(wrap);
		const onblur = () => { if (controls && running && !overlay) setPaused(true); };
		const onvis = () => { if (document.hidden) onblur(); };
		window.addEventListener('blur', onblur);
		document.addEventListener('visibilitychange', onvis);
		window.addEventListener('resize', fit);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			saveBest();
			sfx.reset();
			window.removeEventListener('blur', onblur);
			document.removeEventListener('visibilitychange', onvis);
			window.removeEventListener('resize', fit);
		};
	});

	const diffLabel = $derived(DIFFICULTY[game.config.difficulty]?.label ?? '');
</script>

<svelte:window {onkeydown} />

<div class="game" class:compact bind:this={wrap}>
	<div class="stack">
		{#if !compact}
			<div class="hud" role="group" aria-label="Game status">
				<div class="cell score">
					<span class="label">Score</span>
					<span class="value" aria-live="off">{hud.score.toLocaleString('en-US')}</span>
				</div>
				{#if arcade()}
					<div class="cell">
						<span class="label">Best <span class="dim">{diffLabel}</span></span>
						<span class="value">{hud.best.toLocaleString('en-US')}</span>
					</div>
				{/if}
				<div class="cell">
					<span class="label">Level</span>
					<span class="value">{hud.level} <span class="maze">{hud.maze}</span></span>
				</div>
				<div class="cell">
					<span class="label">Lives</span>
					<span class="icons" aria-label={game.config.infiniteLives ? 'Unlimited lives' : `${hud.lives} lives`}>
						{#if game.config.infiniteLives}
							<canvas class="icon" use:icon={{ life: true }} aria-hidden="true"></canvas><span class="value inf">∞</span>
						{:else}
							{#each { length: Math.min(hud.lives, 6) } as _, i (i)}
								<canvas class="icon" use:icon={{ life: true }} aria-hidden="true"></canvas>
							{/each}
						{/if}
					</span>
				</div>
				<div class="cell grow">
					<span class="label">Items</span>
					<span class="icons" aria-label={bonuses.length ? bonuses.map(bonusName).join(', ') : 'None yet'}>
						{#each bonuses.slice(-6) as b, i (i)}
							<canvas class="icon" use:icon={{ bonus: b }} title={bonusName(b)} aria-hidden="true"></canvas>
						{/each}
					</span>
				</div>
				<button
					class="sound"
					onclick={toggleSound}
					aria-pressed={!!sound}
					aria-label={sound ? 'Sound on. Turn sound off (M)' : 'Sound off. Turn sound on (M)'}
					title={sound ? 'Sound on (M)' : 'Sound off (M)'}
				>
					<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
						<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
						{#if sound}
							<path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" />
						{:else}
							<path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
						{/if}
					</svg>
				</button>
			</div>
		{/if}
		<div class="board">
			<canvas
				bind:this={canvas}
				tabindex={controls ? 0 : -1}
				aria-label="Game board"
				onpointerdown={pointerdown}
				onpointermove={pointermove}
				onpointerup={() => (swipe = null)}
				onpointercancel={() => (swipe = null)}
			></canvas>
			{#if overlay && controls && !compact}
				<div class="overlay" role="dialog" aria-modal="false" aria-labelledby="cc-overlay-title">
					<div class="card">
						{#if overlay === 'title'}
							<h2 id="cc-overlay-title">Ready?</h2>
							<p>Eat every dot. After a power dot the wisps turn blue and you can catch them, for a while.</p>
						{:else if overlay === 'paused'}
							<h2 id="cc-overlay-title">Paused</h2>
							<p>The game is on hold.</p>
						{:else}
							<h2 id="cc-overlay-title">{newBest ? 'New best score' : 'Game over'}</h2>
							<p>You scored {hud.score.toLocaleString('en-US')} on {diffLabel} and reached level {hud.level}.</p>
						{/if}
						<button class="primary" bind:this={primaryBtn} onclick={primary}>
							{overlay === 'title' ? 'Start' : overlay === 'paused' ? 'Resume' : 'Play again'}
						</button>
						<p class="hint">Arrow keys, WASD or swipe to move. P to pause, M for sound.</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.game { display: flex; justify-content: center; min-width: 0; }
	.game.compact { width: 100%; height: 100%; align-items: center; }
	.stack { display: flex; flex-direction: column; gap: 8px; width: min-content; }
	.hud {
		display: flex;
		align-items: stretch;
		min-width: 100%;
		width: 0;
		container-type: inline-size;
		border: 1px solid var(--rule, #2a3a66);
		border-radius: 6px;
		background: var(--surface, rgba(255, 255, 255, 0.02));
		color: var(--ink, #eef3ff);
		font-family: var(--font-body, system-ui, sans-serif);
	}
	.cell { padding: 5px 12px 6px; border-left: 1px solid var(--rule, #2a3a66); white-space: nowrap; display: flex; flex-direction: column; justify-content: center; }
	.cell:first-child { border-left: 0; }
	.cell.grow { flex: 1; min-width: 0; overflow: hidden; }
	.label { display: block; font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-dim, #a3b6de); }
	.label .dim { opacity: 0.7; letter-spacing: 0.04em; text-transform: none; }
	.value { display: block; font-family: var(--font-display, var(--font-body, system-ui)); font-size: 20px; line-height: 1.15; font-weight: 700; font-variant-numeric: tabular-nums; }
	.score .value { min-width: 5.5ch; }
	.maze { font-family: var(--font-body, system-ui); font-size: 13px; font-weight: 500; color: var(--ink-dim, #a3b6de); }
	.icons { display: flex; align-items: center; gap: 3px; min-height: 23px; }
	.icon { width: 20px; height: 20px; display: block; }
	.inf { font-size: 18px; margin-left: 2px; }
	.sound {
		align-self: center;
		margin: 0 8px;
		width: 34px;
		height: 34px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		border: 1px solid var(--rule, #2a3a66);
		background: transparent;
		color: var(--ink, #eef3ff);
		cursor: pointer;
	}
	.sound[aria-pressed='false'] { color: var(--ink-dim, #a3b6de); }
	.sound:hover { border-color: var(--accent, #ff8a4c); }
	.sound:focus-visible, .primary:focus-visible { outline: 2px solid var(--accent, #ff8a4c); outline-offset: 2px; }
	.board { position: relative; line-height: 0; border-radius: 4px; overflow: hidden; }
	canvas:not(.icon) { display: block; touch-action: none; outline: none; }
	.overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--bg, #05081a) 72%, transparent);
		backdrop-filter: blur(2px);
		line-height: 1.5;
		text-align: center;
		color: var(--ink, #eef3ff);
	}
	.card {
		padding: 22px 26px;
		max-width: 340px;
		margin: 16px;
		border: 1px solid var(--rule, #2a3a66);
		border-radius: 10px;
		background: var(--surface, #0d1430);
		font-family: var(--font-body, system-ui, sans-serif);
	}
	.card h2 { margin: 0 0 6px; font-family: var(--font-display, inherit); font-size: 26px; }
	.card p { margin: 0 0 14px; color: var(--ink-dim, #a3b6de); }
	.card .hint { margin: 14px 0 0; font-size: 13px; }
	.primary {
		font: inherit;
		font-weight: 700;
		padding: 10px 22px;
		border-radius: 6px;
		border: 0;
		background: var(--accent, #ff8a4c);
		color: var(--on-accent, #1d0d03);
		cursor: pointer;
	}
	/* Narrow boards: tighter cells, drop the extras before anything wraps. */
	@container (max-width: 640px) {
		.cell { padding: 4px 8px; }
		.label .dim { display: none; }
		.icon { width: 16px; height: 16px; }
	}
	@container (max-width: 520px) {
		.value { font-size: 17px; }
		.maze { display: none; }
		.sound { margin: 0 4px; width: 30px; height: 30px; }
	}
</style>
