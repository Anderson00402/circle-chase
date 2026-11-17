<script lang="ts">
	/**
	 * One run: the game with telemetry (one block of the participant's session) and, unless the
	 * participant is looking, the live measurement panel beside it. Mount it with a new `blockKey`
	 * for every run. Call `end()` to close the block; `onended` follows once the writes are out.
	 *
	 * Pauses (P, Escape, the window losing focus) are counted by the telemetry client and stored on the block.
	 * Escape pauses and resumes (the game's own keys); it never leaves a run that has started. Before
	 * the first frame (the Ready card) Escape goes back to the console.
	 */
	import { onMount } from 'svelte';
	import { useConvexClient } from 'convex-svelte';
	import Game from '../game/Game.svelte';
	import { STUDY_CONFIG } from '../game/engine/game';
	import type { Cue, Game as GameT, GameConfig, Scene } from '../game/types';
	import { createTelemetry, type Mode, type RecentTrial } from '../telemetry/client.svelte.ts';
	import LivePanel from '../telemetry/LivePanel.svelte';
	import type { Participant } from './run.svelte.ts';
	import { participantName } from '#convex/lib/replayDigest.ts';

	export interface RunEnd { blockKey: string; recent: RecentTrial[]; started: boolean; decisions: number }

	interface Props {
		cue: Cue;
		rules: Mode;
		blockKey: string;
		orderIndex: number;
		participant: Participant;
		showPanel: boolean;
		/** The first frame was played: the run (block) exists from now on. */
		onstarted?: () => void;
		onended: (r: RunEnd) => void;
		/** Escape before the run started (nothing played yet). */
		onexit?: () => void;
		/** Extra line on the paused card (what the play page's keys do). */
		pausedNote?: string;
	}
	let { cue, rules, blockKey, orderIndex, participant, showPanel, onstarted, onended, onexit, pausedNote = '' }: Props = $props();

	const client = useConvexClient();
	// Created once per run; props are read at creation on purpose.
	// svelte-ignore state_referenced_locally
	const tel = createTelemetry(client, {
		cue: cue.id, mode: rules, difficulty: 'normal', pid: participant.pid, nickname: participant.label || undefined,
		session: { key: participant.sessionKey, cueOrder: participant.order }, blockIndex: orderIndex, blockKey,
		sound: () => { try { return localStorage.getItem('cc:sound') !== '0'; } catch { return true; } }
	});
	if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ccTelemetry = tel;

	// Study rules without their fixed seed: every run gets a fresh one, so the sequence of power
	// lengths cannot be learned from one run to the next.
	const { seed: _seed, ...studyRules } = STUDY_CONFIG;
	// svelte-ignore state_referenced_locally
	const config: Partial<GameConfig> = rules === 'study' ? { ...studyRules } : { difficulty: 'normal' };

	let gameRef = $state<ReturnType<typeof Game>>();
	let started = false, ending = false;
	/** The latest frame, read at the moment End run is pressed (the panel's readout lags up to 100 ms). */
	let lastScene: Scene | null = null;

	function onframe(scene: Scene, game: GameT) {
		if (ending) return;
		tel.onFrame(scene, game);
		lastScene = scene;
		if (!started) { started = true; onstarted?.(); }
	}

	/**
	 * A power-up is being measured right now: the telemetry says so, or the latest frame has the power
	 * on (the telemetry readout is refreshed only every 100 ms, so it can still say idle just after
	 * the power dot was eaten).
	 */
	export function measuring(): boolean {
		const r = tel.live.readout;
		if (r && r.state !== 'idle') return true;
		return !!lastScene && lastScene.frame.power.left > 0;
	}

	/** Close the run: the power-up in progress is kept as interrupted, everything else is sent. */
	export async function end() {
		if (ending) return;
		ending = true;
		gameRef?.setPaused(true);
		await tel.endBlock(5000);
		const recent = $state.snapshot(tel.live.recent) as RecentTrial[];
		const decisions = tel.live.decisions;
		tel.destroy();
		onended({ blockKey, recent, started, decisions });
	}

	export function restartGame() { gameRef?.restart(); }

	/** What telemetry sees now (reactive): the play page waits on it to end a run without dropping a trial. */
	export function live() { return tel.live; }

	// Escape before anything was played goes back to the console; once the run has started it only
	// pauses and resumes (the game's own Escape), so pressing it twice never ends a run.
	function onkey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || ending || started) return;
		if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		onexit?.();
	}

	onMount(() => {
		window.addEventListener('keydown', onkey, true);
		return () => {
			window.removeEventListener('keydown', onkey, true);
			if (!ending) { tel.endBlock(0); tel.destroy(); }
		};
	});
</script>

<div class="runboard" class:with-panel={showPanel}>
	<div class="board">
		<Game bind:this={gameRef} {cue} {config} onframe={onframe} onstart={tel.onStart} maxTile={34} {pausedNote} />
	</div>
	{#if showPanel}
		<div class="side">
			<LivePanel live={tel.live} cue={cue.id} cueName={cue.name} participant={participantName({ label: participant.label, runNumber: participant.number })} />
		</div>
	{/if}
</div>

<style>
	.runboard {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-4);
		width: 100%;
		max-width: 1280px;
		margin: 0 auto;
		align-items: start;
	}
	.runboard.with-panel { grid-template-columns: minmax(0, 1fr) 300px; }
	.board { min-width: 0; }
	@media (max-width: 900px) {
		.runboard.with-panel { grid-template-columns: minmax(0, 1fr); }
		.side { max-width: 560px; width: 100%; margin: 0 auto; }
	}
</style>
