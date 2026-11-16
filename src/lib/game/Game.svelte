<script lang="ts">
	/**
	 * The playable board: owns the game loop, input, sizing, sound and the start/pause/over overlay.
	 * Everything outside (telemetry, pages) listens through `onframe`.
	 */
	import { onMount } from 'svelte';
	import type { Cue, Facing, Frame, Game, GameConfig, Scene } from './types';
	import { createGame, DIFFICULTY } from './engine/game';
	import { createRenderer, type Renderer } from './render/renderer';
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
		sound?: boolean;
	}
	let { cue, config = {}, onframe, onstart, maxTile = 34, sound = true }: Props = $props();

	const STEP = 1 / 120;
	const KEYS: Record<string, Facing> = {
		ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowDown: 2, KeyS: 2, ArrowRight: 3, KeyD: 3
	};

	let canvas: HTMLCanvasElement;
	let wrap: HTMLDivElement;
	// Not reactive on purpose: the loop reads it every frame.
	// svelte-ignore non_reactive_update, state_referenced_locally
	let game: Game = createGame(config);
	let renderer: Renderer | null = null;
	const sfx = createSfx();
	let prev: Frame | null = null;

	let overlay = $state<'title' | 'paused' | 'over' | null>('title');
	let running = $state(false);
	let hud = $state({ score: 0, level: 1, lives: 3 });
	let readyLabel = 'READY';

	$effect(() => sfx.setEnabled(sound));

	function fit() {
		if (!renderer || !wrap) return;
		const m = game.maze;
		const room = Math.max(280, window.innerHeight - 190);
		const t = Math.max(10, Math.min(maxTile, Math.floor(Math.min(wrap.clientWidth / m.W, room / m.H))));
		renderer.resize(m, t, Math.min(window.devicePixelRatio || 1, 3));
	}

	function newGame() {
		game = createGame({ ...config, seed: config.seed ?? (Math.random() * 2 ** 31) | 0 });
		prev = null;
		readyLabel = 'READY';
		fit();
		onstart?.(game);
	}

	function begin() {
		sfx.wake();
		running = true;
		overlay = null;
		canvas?.focus();
	}

	export function restart() {
		newGame();
		begin();
	}

	function setPaused(p: boolean) {
		if (!running && !p) return;
		overlay = p ? 'paused' : null;
	}

	function primary() {
		if (overlay === 'over') restart();
		else if (overlay === 'paused') setPaused(false);
		else begin();
	}

	function onkeydown(ev: KeyboardEvent) {
		if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
		const tag = (ev.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (ev.code in KEYS) {
			ev.preventDefault();
			if (running && !overlay) game.steer(KEYS[ev.code]);
			return;
		}
		if (ev.code === 'KeyP' || ev.code === 'Escape') {
			if (running) setPaused(overlay !== 'paused');
		} else if (ev.code === 'Space' || ev.code === 'Enter') {
			if (tag === 'BUTTON' || tag === 'A') return;
			ev.preventDefault();
			if (overlay) primary();
			else if (ev.code === 'Space') setPaused(true);
		}
	}

	let swipe: { x: number; y: number; id: number } | null = null;
	function pointerdown(ev: PointerEvent) { swipe = { x: ev.clientX, y: ev.clientY, id: ev.pointerId }; }
	function pointermove(ev: PointerEvent) {
		if (!swipe || ev.pointerId !== swipe.id) return;
		const dx = ev.clientX - swipe.x, dy = ev.clientY - swipe.y;
		if (Math.hypot(dx, dy) < 18) return;
		const d: Facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 3 : 1) : dy > 0 ? 2 : 0;
		if (running && !overlay) game.steer(d);
		swipe.x = ev.clientX;
		swipe.y = ev.clientY;
	}

	onMount(() => {
		renderer = createRenderer(canvas);
		newGame();
		// Development hook for automated checks: `window.__cc.game` is the live game.
		if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__cc = { get game() { return game; }, begin, restart };
		const reduce = matchMedia('(prefers-reduced-motion: reduce)');
		let last = performance.now(), acc = 0, raf = 0;
		const tick = (now: number) => {
			raf = requestAnimationFrame(tick);
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
					if (e.type === 'over') { running = false; overlay = 'over'; }
				}
				onframe?.(scene, game);
				prev = f;
			}
			if (f.score !== hud.score || f.level !== hud.level || f.lives !== hud.lives) hud = { score: f.score, level: f.level, lives: f.lives };
			renderer!.draw(scene, { cue, reduceMotion: reduce.matches, readyLabel });
		};
		raf = requestAnimationFrame(tick);
		const ro = new ResizeObserver(fit);
		ro.observe(wrap);
		const onblur = () => { if (running && !overlay) setPaused(true); };
		window.addEventListener('blur', onblur);
		window.addEventListener('resize', fit);
		return () => {
			cancelAnimationFrame(raf);
			ro.disconnect();
			window.removeEventListener('blur', onblur);
			window.removeEventListener('resize', fit);
		};
	});
</script>

<svelte:window {onkeydown} />

<div class="game" bind:this={wrap}>
	<div class="stack">
		<div class="hud" role="group" aria-label="Score">
			<div><span class="label">Score</span><span class="value">{hud.score.toLocaleString('en-US')}</span></div>
			<div><span class="label">Level</span><span class="value">{hud.level}</span></div>
			<div>
				<span class="label">Lives</span>
				<span class="value">{game.config.infiniteLives ? '∞' : hud.lives}</span>
			</div>
		</div>
		<div class="board">
			<canvas
				bind:this={canvas}
				tabindex="0"
				aria-label="Game board"
				onpointerdown={pointerdown}
				onpointermove={pointermove}
				onpointerup={() => (swipe = null)}
				onpointercancel={() => (swipe = null)}
			></canvas>
			{#if overlay}
				<div class="overlay">
					<div class="card">
						{#if overlay === 'title'}
							<h2>Ready?</h2>
							<p>Eat every dot. Ghosts can only be caught after a power dot.</p>
						{:else if overlay === 'paused'}
							<h2>Paused</h2>
							<p>The game is on hold.</p>
						{:else}
							<h2>Game over</h2>
							<p>You scored {hud.score.toLocaleString('en-US')} on {DIFFICULTY[game.config.difficulty].label} and reached level {hud.level}.</p>
						{/if}
						<button class="primary" onclick={primary}>
							{overlay === 'title' ? 'Start' : overlay === 'paused' ? 'Resume' : 'Play again'}
						</button>
						<p class="hint">Arrow keys or WASD to move. P to pause.</p>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.game { display: flex; justify-content: center; min-width: 0; }
	.stack { display: flex; flex-direction: column; gap: 8px; width: min-content; }
	.hud { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--rule, #2a3a66); }
	.hud > div { padding: 6px 10px; border-left: 1px solid var(--rule, #2a3a66); }
	.hud > div:first-child { border-left: 0; }
	.label { display: block; font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.7; }
	.value { display: block; font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
	.board { position: relative; line-height: 0; }
	canvas { display: block; touch-action: none; outline: none; }
	.overlay { position: absolute; inset: 0; display: grid; place-items: center; background: rgba(5, 8, 20, 0.7); line-height: 1.5; text-align: center; }
	.card { padding: 18px 22px; max-width: 320px; }
	.card h2 { margin: 0 0 6px; }
	.card p { margin: 0 0 12px; opacity: 0.8; }
	.card .hint { margin: 12px 0 0; font-size: 13px; }
	.primary { font: inherit; font-weight: 700; padding: 9px 18px; border-radius: 4px; border: 0; background: var(--accent, #ff8a4c); color: #1d0d03; cursor: pointer; }
</style>
