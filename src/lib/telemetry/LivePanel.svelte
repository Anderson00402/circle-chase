<script lang="ts">
	/**
	 * The researcher's live panel beside the board: what is being measured, the last results and
	 * what is stored for this case.
	 *
	 * The participant can see the screen, and only the cue may tell them how much power is left. So
	 * while a power-up runs (and during its 3 s aftermath) the panel says only that it is being
	 * measured: no seconds, no guess, nothing that changes as the end gets near. The result appears
	 * once the trial is closed.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import type { TelemetryLive } from './client.svelte.ts';
	import { outcomeColor, outcomeDef, outcomeLabel, turnWords } from '../outcomes';

	interface Props {
		/** The participant as shown everywhere (label and console number); the internal number is never shown. */
		participant?: string;
		live: TelemetryLive;
		cue: string;
		/** Name of the case for headings (defaults to "this case"). */
		cueName?: string;
	}
	let { live, cue, cueName, participant = '' }: Props = $props();

	// What is stored for this case (same source as this player), live from Convex.
	// Running totals for the case (one small document), not a scan of its trials.
	const stored = useQuery(api.summary.cueCounts, () => ({ source: live.source, cue }));
	const here = $derived(stored.data && stored.data.trials > 0 ? stored.data : null);

	const state = $derived(live.readout?.state ?? 'idle');
	const last = $derived(live.recent[0] ?? null);
	const pct = (x: number | null | undefined) => (x === null || x === undefined ? '-' : `${Math.round(x * 100)}%`);
	const name = $derived(cueName ?? 'this case');
</script>

<aside class="panel" aria-label="Live measurement">
	<header>
		<h2>Live measurement</h2>
		<span class="status" class:off={!live.online} title={live.online ? 'Each trial is saved as soon as it ends' : 'Offline: trials are kept and sent when the connection is back'}>
			<span class="led" aria-hidden="true"></span>{live.online ? 'Saving' : 'Offline'}{live.pending > 0 ? ` · ${live.pending} waiting` : ''}
		</span>
	</header>

	<section class="now" class:busy={state !== 'idle'} aria-live="off">
		<h3>Now</h3>
		{#if state === 'idle'}
			<div class="big">Waiting for a power dot</div>
			<p class="hint">Each power-up is one trial, measured from the power dot until 3 s after it runs out.</p>
		{:else}
			<div class="big">Measuring a power-up</div>
			<p class="hint">The result shows here once the trial is over. Nothing about the time left is shown while it runs.</p>
		{/if}
	</section>

	<section>
		<h3>Last trials</h3>
		{#if live.recent.length === 0}
			<p class="hint">None yet. A trial appears here 3 s after its power-up runs out.</p>
		{:else}
			<ol class="recent">
				{#each live.recent as t, i (t.key)}
					{@const when = turnWords(t.outcome, t.turnLeft)}
					<li class:latest={i === 0 && t === last}>
						<span class="dot" style:background={outcomeColor(t.outcome)} aria-hidden="true"></span>
						<span class="what">
							<strong>{outcomeLabel(t.outcome)}</strong>
							<small>{when ? (t.outcome === 'catch' ? `${when[0].toUpperCase()}${when.slice(1)}.` : `Turned away: ${when}.`) : outcomeDef(t.outcome)}</small>
						</span>
						<span class="flag" title={t.saved ? (t.hasClip ? 'Saved, with a replay' : 'Saved') : 'Saving'}>{t.saved ? (t.hasClip ? 'saved, replay' : 'saved') : 'saving'}</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<section class="stored">
		<h3>Stored for {name}{live.source === 'bot' ? ' (simulated players)' : ''}</h3>
		{#if here}
			<dl>
				<div class="row"><dt>Trials</dt><dd class="num">{here.trials}</dd></div>
				<div class="row"><dt>Count toward the rates</dt><dd class="num">{here.decisions}</dd></div>
				<div class="row"><dt>Caught</dt><dd class="num">{pct(here.caught.rate)} <span class="dim">of {here.caught.n}</span></dd></div>
				<div class="row"><dt>Turned away in time</dt><dd class="num">{pct(here.wellTimed.rate)} <span class="dim">of {here.wellTimed.n}</span></dd></div>
			</dl>
			{#if here.notEnoughData}<p class="hint">Not enough data yet: fewer than 10 trials count.</p>{/if}
		{:else}
			<p class="hint">{stored.isLoading ? 'Loading...' : 'Nothing stored yet.'}</p>
		{/if}
		<p class="hint">{live.saved} saved in this run{participant ? ` · ${participant}` : ''}</p>
	</section>

	<details>
		<summary>What do these words mean?</summary>
		<p><strong>Count toward the rates</strong>: the player was chasing in the last 3 s, the power ran out by itself, and they had to decide about the end (turned away, or stayed on). Eating the ghost is not a decision.</p>
		<p><strong>Turned away in time</strong>: {outcomeDef('timely-retreat')} <strong>Caught</strong>: {outcomeDef('caught')}</p>
		<p>Distances are measured along the maze paths, in tiles. Full definitions are on the <a href="/dashboard">dashboard</a>.</p>
	</details>
</aside>

<style>
	.panel {
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 14px;
		background: var(--surface, #111a36);
		border: 1px solid var(--rule, #2a3a66);
		border-radius: var(--radius-md, 10px);
		color: var(--ink, #eef3ff);
		font-size: 13px;
		line-height: 1.4;
		box-sizing: border-box;
	}
	header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
	h2 { margin: 0; font-size: 15px; }
	h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-dim, #9aa8cc); font-weight: 600; }
	dl { margin: 0; display: flex; flex-direction: column; gap: 3px; }
	dd { margin: 0; }
	.status { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--good, #6fdc8c); }
	.led { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
	.status.off { color: var(--bad, #ff6b6b); }
	/* The border does not change between the power and its aftermath: that change would mark the end. */
	.now { padding: 10px; border: 1px solid var(--rule, #2a3a66); border-radius: var(--radius-sm, 6px); }
	.now.busy { border-color: var(--rule-strong, #3a4870); }
	.big { font-size: 16px; font-weight: 650; margin-bottom: 4px; }
	.row { display: flex; justify-content: space-between; gap: 8px; }
	.row > dt { color: var(--ink-dim, #9aa8cc); }
	.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
	.dim { color: var(--ink-faint, #8090b8); }
	.hint { margin: 4px 0 0; color: var(--ink-dim, #9aa8cc); }
	.recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.recent li { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: start; }
	.what { display: flex; flex-direction: column; min-width: 0; }
	.what small { color: var(--ink-dim, #9aa8cc); }
	.flag { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--ink-dim, #9aa8cc); white-space: nowrap; }
	.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: var(--ink-dim, #9aa8cc); }
	details { color: var(--ink-dim, #9aa8cc); font-size: 12px; }
	summary { cursor: pointer; color: var(--ink, #eef3ff); }
	details p { margin: 6px 0 0; }
</style>
