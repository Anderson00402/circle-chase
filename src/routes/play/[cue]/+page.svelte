<script lang="ts">
	/**
	 * Play one case with the current participant: /play/<case> (study rules) or ?rules=arcade.
	 * The end-of-run summary lives at /play/<case>?done=<run>, so Back and refresh find it again.
	 *
	 * Header: back to the console, the case (hidden in participant view), the participant, restart,
	 * previous / next case, participant view, End run. Participant view (no panel, no case name) is
	 * on whenever a run starts. End run lets the power-up in progress finish and its 3 s aftermath
	 * play out, then shows the summary. Keys: E end run (again: end now), R restart, [ ] previous /
	 * next, V participant view, Esc (paused or not started) console, N next case on the summary.
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
	import {
		activeRun, endedLocally, ensureIfNamed, ensureParticipant, nextOrderIndex, playHref, recordRun, run, setActiveRun,
		suggestedNext, summaryHref, uid
	} from '#lib/study/run.svelte.ts';
	import { MODE_LABEL } from '#lib/outcomes.ts';

	const client = useConvexClient();
	const cue = $derived(CUES.find((c) => c.id === page.params.cue) ?? null);
	const rules = $derived<Mode>(page.url.searchParams.get('rules') === 'arcade' ? 'arcade' : 'study');
	/** The run whose summary is shown, from the address. */
	const done = $derived(page.url.searchParams.get('done'));

	// An unknown case goes back to the console.
	$effect(() => { if (!cue) goto('/', { replace: true }); });

	/** A new run (block) for every case, rules change or restart. */
	let blockKey = $state(uid());
	let orderIndex = $state(nextOrderIndex());
	let ending = $state(false);
	/** End run was pressed while a power-up (or its aftermath) was being measured: end when it is over. */
	let finishing = $state<{ last: string | null } | null>(null);
	let participantView = $state(true);
	let board = $state<ReturnType<typeof RunBoard>>();
	let lastRoute = '';
	let firstRun = true;
	let restarting = false;
	$effect(() => {
		const route = `${cue?.id}:${rules}:${done ?? ''}`;
		if (route !== lastRoute) {
			lastRoute = route;
			if (!done) newRun();
		}
	});
	function newRun() {
		// After a refresh, carry on in the run that was being played in this tab.
		const a = firstRun ? activeRun() : null;
		firstRun = false;
		if (a && a.cue === cue?.id && a.rules === rules && run.p.runs.some((r) => r.blockKey === a.blockKey)) {
			blockKey = a.blockKey;
			orderIndex = a.orderIndex;
		} else {
			blockKey = uid();
			orderIndex = nextOrderIndex();
		}
		ending = false;
		finishing = null;
		participantView = true;
	}

	function toggleView() { participantView = !participantView; }

	function started() {
		if (!cue) return;
		recordRun({ blockKey, cue: cue.id, mode: rules, orderIndex, startedAt: Date.now() });
		setActiveRun({ blockKey, cue: cue.id, rules, orderIndex });
		ensureParticipant(client);
	}

	/** End run: wait for the power-up being measured, unless it was already asked for (then end now). */
	function endRun() {
		if (!board || ending || done) return;
		if (finishing) { finishing = null; finish(); return; }
		const live = board.live();
		if (live.readout && live.readout.state !== 'idle') { finishing = { last: live.recent[0]?.key ?? null }; return; }
		finish();
	}
	async function finish() {
		if (!board || ending) return;
		ending = true;
		await board.end();
	}
	// The trial in progress is closed when it is idle again or a new trial landed (a power-up cut short by another).
	$effect(() => {
		if (!finishing || !board) return;
		const live = board.live();
		if (!live.readout || live.readout.state === 'idle' || (live.recent[0]?.key ?? null) !== finishing.last) {
			finishing = null;
			finish();
		}
	});
	/** Seconds of the aftermath still to watch; null while the power is on (that number would give the time left away). */
	const finishLeft = $derived.by(() => {
		if (!finishing || !board) return null;
		const r = board.live().readout;
		return r && r.state === 'after' && typeof r.left === 'number' ? Math.max(1, Math.ceil(3 + r.left)) : null;
	});

	function onended(r: RunEnd) {
		ending = false;
		finishing = null;
		setActiveRun(null);
		if (restarting) return; // Restart starts the next run in place
		if (!r.started || !cue) { goto('/'); return; } // nothing was played: nothing to summarise
		endedLocally.set(r.blockKey, r.recent);
		goto(summaryHref(cue.id, r.blockKey, rules), { replace: true });
	}

	const idx = $derived(cue ? CUES.findIndex((c) => c.id === cue.id) : 0);
	const prev = $derived(CUES[(idx - 1 + CUES.length) % CUES.length]);
	const nextInList = $derived(CUES[(idx + 1) % CUES.length]);
	const suggested = $derived(suggestedNext([...run.p.runs.map((r) => r.cue), ...(cue ? [cue.id] : [])]));
	const nextCase = $derived(suggested ?? nextInList);
	/** Run number of the summary shown (from this machine's run sheet; the summary falls back to the server's). */
	const doneNumber = $derived(done ? (run.p.runs.find((r) => r.blockKey === done)?.orderIndex ?? null) : null);

	function go(id: string) { goto(playHref(id, rules)); }
	async function restart() {
		if (done) { if (cue) goto(playHref(cue.id, rules)); return; }
		restarting = true;
		try { if (board) await board.end(); } finally { restarting = false; }
		setActiveRun(null);
		newRun();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if ((e.target as HTMLElement).closest('input, textarea, select, dialog')) return;
		const k = e.key.toLowerCase();
		if (done) {
			if (k === 'n') { e.preventDefault(); go(nextCase.id); }
			else if (e.key === 'Escape') { e.preventDefault(); goto('/'); }
			else if (k === 'v') { e.preventDefault(); toggleView(); }
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
		// Leaving the page inside the app ends the run (RunBoard closes it); a refresh does not run this.
		return () => setActiveRun(null);
	});
</script>

<svelte:head><title>{done ? 'Run summary' : 'Run'}{cue && !participantView ? ` · ${cue.code} ${cue.name}` : ''} · Circle Chase</title></svelte:head>
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
				{#if rules === 'arcade'}<span class="tag">{MODE_LABEL.arcade}</span>{/if}
			</div>
			<span class="who" title="Participant (change it on the console)"><span class="dim">Participant</span> <strong class="num">{run.p.label || '-'}</strong>{#if !done}<span class="dim">run {orderIndex + 1}</span>{/if}</span>

			<div class="tools" role="toolbar" aria-label="Run controls">
				{#if !done}
					<button class="tool" onclick={restart} title="Restart: end this run and start a new one of the same case (R)">Restart <Kbd>R</Kbd></button>
				{/if}
				<button class="tool" onclick={() => go(prev.id)} title="Previous case{participantView ? '' : `: ${prev.code} ${prev.name}`} ([)" aria-label="Previous case">
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
				</button>
				<button class="tool" onclick={() => go(nextInList.id)} title="Next case{participantView ? '' : `: ${nextInList.code} ${nextInList.name}`} (])" aria-label="Next case">
					<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
				</button>
				<button class="tool" aria-pressed={participantView} onclick={toggleView} title="Participant view hides the measurement panel and the case name. On whenever a run starts (V)">
					Participant view <Kbd>V</Kbd>
				</button>
				{#if !done}
					{#if finishing}
						<span class="finishing" role="status">Measuring the last power-up...{finishLeft !== null ? ` ${finishLeft} s` : ''}</span>
						<button class="tool" onclick={endRun} title="End now: the power-up in progress is not counted (E)">End now <Kbd>E</Kbd></button>
					{:else}
						<button class="tool end" onclick={endRun} disabled={ending} title="End run: a power-up in progress is measured to its end first (E)">{ending ? 'Saving...' : 'End run'} <Kbd>E</Kbd></button>
					{/if}
				{/if}
			</div>
		</header>

		<div class="body">
			{#if done}
				{#key done}
					<RunSummary
						{cue} {rules} blockKey={done} label={run.p.label} number={doneNumber === null ? null : doneNumber + 1}
						recent={endedLocally.get(done) ?? []} hideCase={participantView}
						next={nextCase} onnext={() => go(nextCase.id)} onagain={() => go(cue.id)}
					/>
				{/key}
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
	.finishing { font-size: var(--text-sm); font-weight: 650; color: var(--accent); font-variant-numeric: tabular-nums; }
	.body { flex: 1; min-height: 0; overflow: auto; padding: var(--space-3) var(--gutter); }
	@media (max-width: 760px) {
		.tool :global(kbd) { display: none; }
		.who .dim:last-child { display: none; }
		.tools { margin-left: 0; width: 100%; }
		.tool.end { margin-left: auto; }
	}
</style>
