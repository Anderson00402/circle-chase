<script lang="ts">
	/**
	 * One study round: the game with telemetry, played until enough power-ups have run their course
	 * or the time cap is reached, whichever comes first. A power-up in progress, and its 3 s
	 * aftermath, are always finished before the round stops, so no trial is cut short.
	 *
	 * Shows nothing about the cue: only "Round n of N" and a slim progress bar that moves with
	 * play time and finished power-ups (never with the power-up's own time left).
	 */
	import { onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import Game from '../game/Game.svelte';
	import { STUDY_CONFIG } from '../game/engine/game';
	import type { Cue, Game as GameT, Scene } from '../game/types';
	import { createTelemetry } from '../telemetry/client.svelte.ts';

	export interface BlockResult {
		completed: number;
		playTime: number;
		pauses: number;
		pausedSeconds: number;
	}

	interface Props {
		cue: Cue;
		label: string;
		sessionKey: string;
		cueOrder: string[];
		blockIndex: number;
		blockKey: string;
		seed: number;
		practice?: boolean;
		nickname?: string;
		sound: boolean;
		/** Power-ups that ran out by themselves before the round may end. */
		target: number;
		/** Seconds of play after which the round ends (once no power-up is running). */
		cap: number;
		ondone: (r: BlockResult) => void;
	}
	let {
		cue, label, sessionKey, cueOrder, blockIndex, blockKey, seed, practice = false, nickname, sound = $bindable(),
		target, cap, ondone
	}: Props = $props();

	/** Hard stop, in case a power-up never seems to finish (it always does, but never trap anyone). */
	const HARD_EXTRA = 30;
	const AFTER = 3.1;

	// Created once per round; props are read at creation on purpose.
	// svelte-ignore state_referenced_locally
	const tel = createTelemetry(useConvexClient(), {
		cue: cue.id, mode: 'study', difficulty: 'normal', sound: () => sound !== false,
		session: { key: sessionKey, cueOrder }, blockIndex, blockKey, practice, nickname: nickname || undefined
	});
	// svelte-ignore state_referenced_locally
	const config = { ...STUDY_CONFIG, seed };

	let gameRef = $state<ReturnType<typeof Game>>();
	let progress = $state(0);
	let finishing = $state(false);
	let completed = 0, t0 = -1, playTime = 0, lastWall = 0, pauses = 0, pausedSeconds = 0, lastUi = 0;
	/** Power-up serial when the round was due to end; -1 until then. */
	let closingSerial = -1;

	function onframe(scene: Scene, game: GameT) {
		if (finishing) return;
		tel.onFrame(scene, game);
		const f = scene.frame;
		const wall = performance.now();
		// The game stops sending frames while paused (P, Escape, or the window losing focus).
		if (lastWall && wall - lastWall > 400) { pauses++; pausedSeconds += (wall - lastWall) / 1000; }
		lastWall = wall;
		if (t0 < 0) t0 = f.t;
		playTime = f.t - t0;
		for (const e of f.events) if (e.type === 'powerEnd' && e.reason === 'expired') completed++;
		const inTrial = f.power.left > 0 || (f.power.endedAt >= 0 && f.t - f.power.endedAt < AFTER);
		if (wall - lastUi > 250) {
			lastUi = wall;
			progress = Math.min(1, Math.max(completed / target, playTime / cap));
		}
		if (closingSerial < 0 && (completed >= target || playTime >= cap)) closingSerial = f.power.serial;
		// Once due, end as soon as the power-up in progress (and its aftermath) is over. A power dot eaten
		// after that moment ends the round at once: its trial is stored as interrupted, outside the rates,
		// so a player who chains power-ups cannot keep a round going.
		const due = closingSerial >= 0 && (!inTrial || f.power.serial > closingSerial);
		if (due || playTime >= cap + HARD_EXTRA) finish();
	}

	async function finish() {
		if (finishing) return;
		finishing = true;
		progress = 1;
		gameRef?.setPaused(true);
		await tel.endBlock(5000);
		tel.destroy();
		ondone({ completed, playTime, pauses, pausedSeconds: Math.round(pausedSeconds * 10) / 10 });
	}

	onMount(() => {
		// Skip the game's own start card: the round's intro screen was the start.
		gameRef?.restart();
		if (import.meta.env.DEV) {
			(window as unknown as Record<string, unknown>).__ccStudyBlock = {
				get completed() { return completed; }, get playTime() { return playTime; }, finish, tel
			};
		}
		return () => {
			if (!finishing) { tel.endBlock(0); tel.destroy(); }
		};
	});
</script>

<div class="block" class:finishing>
	<div class="strip">
		<span class="label">{label}</span>
		<span
			class="bar"
			role="progressbar"
			aria-label="Round progress"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={Math.round(progress * 100)}
		><span style:transform="scaleX({progress})"></span></span>
		{#if !tel.live.online}<span class="off" title="Your answers and play are kept and sent when the connection is back">Offline, saving later</span>{/if}
	</div>
	<div class="board">
		<Game bind:this={gameRef} {cue} {config} bind:sound onframe={onframe} onstart={tel.onStart} maxTile={32} />
		{#if finishing}
			<div class="done" role="status"><p>Round complete</p></div>
		{/if}
	</div>
</div>

<style>
	.block { display: flex; flex-direction: column; gap: var(--space-3); min-height: 0; flex: 1; }
	.strip {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		width: min(100%, 680px);
		margin: 0 auto;
	}
	.label { font-weight: 650; white-space: nowrap; }
	.bar {
		flex: 1;
		height: 6px;
		border-radius: var(--radius-pill);
		background: var(--surface-2);
		overflow: hidden;
	}
	.bar > span {
		display: block;
		height: 100%;
		background: var(--ink-dim);
		transform-origin: left;
		transition: transform 0.25s linear;
	}
	.off { color: var(--warn); font-size: var(--text-sm); white-space: nowrap; }
	.board { position: relative; }
	.done {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: color-mix(in srgb, var(--bg) 70%, transparent);
		font-family: var(--font-display);
		font-size: var(--text-xl);
	}
	@media (prefers-reduced-motion: reduce) {
		.bar > span { transition: none; }
	}
</style>
