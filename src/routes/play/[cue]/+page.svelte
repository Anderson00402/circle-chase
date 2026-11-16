<script lang="ts">
	/**
	 * Play one case with the current participant: /play/<case> (study rules) or ?rules=arcade.
	 *
	 * Header: back to the console, the case (hidden in participant view), the participant, restart,
	 * previous / next case, participant view, End run. End run closes the block and shows the run
	 * summary; Next case goes to the suggested one. Keys: E end run, R restart, [ ] previous / next,
	 * V participant view, Esc (paused or not started) console, N next case on the summary.
	 */
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { useConvexClient } from 'convex-svelte';
	import { CUES } from '#lib/game/cues/index.ts';
	import type { Mode } from '#lib/telemetry/client.svelte.ts';
	import { CueChip, Kbd } from '#lib/ui/index.ts';
	import RunBoard, { type RunEnd } from '#lib/study/RunBoard.svelte';
	import RunSummary from '#lib/study/RunSummary.svelte';
	import { ensureIfNamed, ensureParticipant, nextOrderIndex, persist, playHref, recordRun, run, suggestedNext, uid } from '#lib/study/run.svelte.ts';

	const client = useConvexClient();
	const cue = $derived(CUES.find((c) => c.id === page.params.cue) ?? null);
	const rules = $derived<Mode>(page.url.searchParams.get('rules') === 'arcade' ? 'arcade' : 'study');

	// An unknown case goes back to the console.
	$effect(() => { if (!cue) goto('/', { replace: true }); });

	/** A new run (block) for every case, rules change or restart. */
	let blockKey = $state(uid());
	let orderIndex = $state(nextOrderIndex());
	let ended = $state<RunEnd | null>(null);
	let ending = $state(false);
	let board = $state<ReturnType<typeof RunBoard>>();
	let lastRoute = '';
	$effect(() => {
		const route = `${cue?.id}:${rules}`;
		if (route !== lastRoute) { lastRoute = route; newRun(); }
	});
	function newRun() {
		blockKey = uid();
		orderIndex = nextOrderIndex();
		ended = null;
		ending = false;
	}

	const participantView = $derived(run.settings.participantView);
	function toggleView() {
		run.settings.participantView = !run.settings.participantView;
		persist();
	}

	function started() {
		if (!cue) return;
		recordRun({ blockKey, cue: cue.id, mode: rules, orderIndex, startedAt: Date.now() });
		ensureParticipant(client);
	}

	async function endRun() {
		if (!board || ending || ended) return;
		ending = true;
		await board.end();
	}
	function onended(r: RunEnd) {
		ending = false;
		if (!r.started) { goto('/'); return; } // nothing was played: nothing to summarise
		ended = r;
	}

	const idx = $derived(cue ? CUES.findIndex((c) => c.id === cue.id) : 0);
	const prev = $derived(CUES[(idx - 1 + CUES.length) % CUES.length]);
	const nextInList = $derived(CUES[(idx + 1) % CUES.length]);
	const suggested = $derived(suggestedNext([...run.p.runs.map((r) => r.cue), ...(cue ? [cue.id] : [])]));
	const nextCase = $derived(suggested ?? nextInList);

	function go(id: string) { goto(playHref(id, rules)); }
	async function restart() {
		if (ended) { newRun(); return; }
		if (board) { await board.end(); }
		newRun();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
		const k = e.key.toLowerCase();
		if (ended) {
			if (k === 'n') { e.preventDefault(); go(nextCase.id); }
			else if (e.key === 'Escape') { e.preventDefault(); goto('/'); }
			return;
		}
		if (k === 'e') { e.preventDefault(); endRun(); }
		else if (k === 'r') { e.preventDefault(); restart(); }
		else if (e.key === '[') { e.preventDefault(); go(prev.id); }
		else if (e.key === ']') { e.preventDefault(); go(nextInList.id); }
		else if (k === 'v') { e.preventDefault(); toggleView(); }
	}

	onMount(() => {
		ensureIfNamed(client);
		tick().then(() => (document.querySelector('.board canvas[tabindex="0"]') as HTMLElement | null)?.focus());
	});
</script>

<svelte:head><title>{cue && !participantView ? `${cue.code} · ${cue.name}` : 'Run'} · Circle Chase</title></svelte:head>
<svelte:window {onkeydown} />

{#if cue}
	<div class="play">
		<header class="head" aria-label="Run">
			<a class="back" href="/" title="Back to the console (Esc while paused)">
				<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
				Console
			</a>
			<div class="case">
				{#if participantView}
					<span class="hidden-case">Case hidden</span>
				{:else}
					<CueChip {cue} size="sm" />
				{/if}
				{#if rules === 'arcade'}<span class="tag">Arcade rules</span>{/if}
			</div>
			<span class="who" title="Participant (change it on the console)"><span class="dim">Participant</span> <strong class="num">{run.p.label || '-'}</strong> <span class="dim">run {orderIndex + 1}</span></span>

			<div class="tools" role="toolbar" aria-label="Run controls">
				{#if !ended}
					<button class="tool" onclick={restart} title="Restart: end this run and start a new one of the same case (R)">Restart <Kbd>R</Kbd></button>
				{/if}
				<button class="tool" onclick={() => go(prev.id)} title="Previous case{participantView ? '' : `: ${prev.code} ${prev.name}`} ([)" aria-label="Previous case">
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
				</button>
				<button class="tool" onclick={() => go(nextInList.id)} title="Next case{participantView ? '' : `: ${nextInList.code} ${nextInList.name}`} (])" aria-label="Next case">
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
				</button>
				<button class="tool" aria-pressed={participantView} onclick={toggleView} title="Participant view hides the measurement panel and the case name (V)">
					Participant view <Kbd>V</Kbd>
				</button>
				{#if !ended}
					<button class="tool end" onclick={endRun} disabled={ending}>{ending ? 'Saving...' : 'End run'} <Kbd>E</Kbd></button>
				{/if}
			</div>
		</header>

		<div class="body">
			{#if ended}
				<RunSummary
					{cue} blockKey={ended.blockKey} label={run.p.label} number={orderIndex + 1} recent={ended.recent}
					hideCase={participantView} next={nextCase} onnext={() => go(nextCase.id)} onagain={newRun}
				/>
			{:else}
				{#key blockKey}
					<RunBoard
						bind:this={board} {cue} {rules} {blockKey} {orderIndex} participant={run.p} showPanel={!participantView}
						onstarted={started} {onended} onexit={() => goto('/')}
					/>
				{/key}
			{/if}
		</div>
	</div>
{/if}

<style>
	.play { flex: 1; min-height: 0; display: flex; flex-direction: column; }
	.head {
		display: flex;
		align-items: center;
		gap: var(--space-2) var(--space-4);
		flex-wrap: wrap;
		padding: var(--space-2) var(--gutter);
		border-bottom: 1px solid var(--rule);
		background: var(--surface);
	}
	.back { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-dim); font-size: var(--text-sm); font-weight: 600; text-decoration: none; }
	.back:hover { color: var(--ink); }
	.case { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
	.hidden-case { color: var(--ink-faint); font-size: var(--text-sm); }
	.tag { padding: 1px 8px; border-radius: var(--radius-pill); background: var(--warn-soft); color: var(--warn); font-size: var(--text-xs); font-weight: 650; }
	.who { font-size: var(--text-sm); }
	.who strong { margin: 0 4px; }
	.dim { color: var(--ink-faint); }
	.tools { margin-left: auto; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.tool:hover { border-color: var(--ink-faint); }
	.tool:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.tool[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
	.tool.end { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
	.tool.end :global(kbd) { background: transparent; color: inherit; border-color: currentColor; }
	.tool:disabled { opacity: 0.6; cursor: default; }
	.body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-3) var(--gutter); }
	@media (max-width: 760px) {
		.tool :global(kbd) { display: none; }
		.who .dim:last-child { display: none; }
		.tools { margin-left: 0; width: 100%; }
		.tool.end { margin-left: auto; }
	}
</style>
