<script lang="ts">
	/**
	 * Compact readout of what telemetry sees right now: the power-up, the nearest scared ghost,
	 * whether the player is chasing, a guess at the outcome, the last few trials and what is stored
	 * for this cue. Plain CSS variables with fallbacks so the shell can restyle it.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import type { TelemetryLive } from './client.svelte.ts';
	import { OUTCOME_LABEL, type Outcome } from './types';

	interface Props {
		live: TelemetryLive;
		cue: string;
	}
	let { live, cue }: Props = $props();

	/** One line in plain words per outcome. */
	const SAYS: Record<Outcome, string> = {
		caught: 'Caught just after the power ran out',
		'late-catch': 'Ate a ghost in the last 1.5 s',
		overstayed: 'Still chasing when it ran out',
		'timely-retreat': 'Backed off in time',
		'early-retreat': 'Gave up with time to spare',
		'not-engaged': 'No chase near the end',
		other: 'Chased, but no clear ending',
		interrupted: 'Cut short before it ran out'
	};
	const TONE: Record<Outcome, 'good' | 'bad' | 'dim'> = {
		caught: 'bad', 'late-catch': 'good', overstayed: 'bad', 'timely-retreat': 'good', 'early-retreat': 'bad',
		'not-engaged': 'dim', other: 'dim', interrupted: 'dim'
	};

	// What is stored for this cue (same source as this player), live from Convex.
	const stored = useQuery(api.summary.byCue, () => ({ source: live.source, cue }));
	const here = $derived(stored.data?.cues.find((c) => c.cue === cue) ?? null);

	const r = $derived(live.readout);
	const left = $derived(r.state === 'after' ? `ran out ${(-r.left).toFixed(1)} s ago` : r.state === 'power' ? `${r.left.toFixed(1)} s left` : 'No power-up');
	const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
</script>

<aside class="panel" aria-label="Measurement">
	<header>
		<h2>What we measure</h2>
		<span class="status" class:off={!live.online} title={live.online ? 'Connected' : 'Offline, saving later'}>
			{live.online ? 'Live' : 'Offline'}{live.pending > 0 ? ` · ${live.pending} to send` : ''}
		</span>
	</header>

	<section class="now" class:power={r.state === 'power'} class:after={r.state === 'after'}>
		<div class="big">{left}</div>
		{#if r.state !== 'idle'}
			<div class="row">
				<span>Nearest {r.state === 'after' ? 'chaser' : 'scared ghost'}</span>
				<span class="num">{r.nearest ? `${r.nearest.dist.toFixed(1)} tiles` : 'none'}</span>
			</div>
			<div class="row">
				<span>Chasing</span>
				<span class="num" class:yes={r.chasing}>{r.chasing ? 'yes' : 'no'}</span>
			</div>
			<div class="row">
				<span>So far</span>
				<span class="num">{r.guess ? OUTCOME_LABEL[r.guess] : r.engaged ? 'chasing near the end' : 'waiting'}</span>
			</div>
		{:else}
			<p class="hint">Eat a power dot. Each power-up is one trial.</p>
		{/if}
	</section>

	<section>
		<h3>Last power-ups</h3>
		{#if live.recent.length === 0}
			<p class="hint">None yet.</p>
		{:else}
			<ol class="recent">
				{#each live.recent as t (t.key)}
					<li>
						<span class="dot {TONE[t.outcome]}" aria-hidden="true"></span>
						<span class="what">
							<strong>{OUTCOME_LABEL[t.outcome]}</strong>
							<small>{SAYS[t.outcome]}{t.turnLeft !== null ? ` · turned at ${t.turnLeft.toFixed(1)} s` : ''}</small>
						</span>
						<span class="flag" title={t.saved ? 'Saved' : 'Saving'}>{t.saved ? (t.hasClip ? 'saved + clip' : 'saved') : '...'}</span>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<section class="stored">
		<h3>Stored for this cue{live.source === 'bot' ? ' (simulated)' : ''}</h3>
		{#if here}
			<div class="row"><span>Trials</span><span class="num">{here.trials}</span></div>
			<div class="row"><span>Count toward rates</span><span class="num">{here.inRates}</span></div>
			<div class="row"><span>Caught rate</span><span class="num">{pct(here.caught.rate)} of {here.caught.n}</span></div>
			<div class="row"><span>Well timed</span><span class="num">{pct(here.wellTimed.rate)} of {here.wellTimed.n}</span></div>
			{#if here.notEnoughData}<p class="hint">Not enough data yet (fewer than 10 trials count).</p>{/if}
		{:else}
			<p class="hint">{stored.isLoading ? 'Loading...' : 'Nothing stored yet.'}</p>
		{/if}
		<p class="hint">This session: {live.saved} saved{live.participantNumber ? ` · player ${live.participantNumber}` : ''}</p>
	</section>
</aside>

<style>
	.panel {
		width: 100%;
		max-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 14px;
		background: var(--surface, #111a36);
		border: 1px solid var(--rule, #2a3a66);
		color: var(--ink, #eef3ff);
		font-size: 13px;
		line-height: 1.4;
		box-sizing: border-box;
	}
	header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
	h2 { margin: 0; font-size: 14px; }
	h3 { margin: 0 0 6px; font-size: 12px; color: var(--ink-dim, #9aa8cc); font-weight: 600; }
	.status { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--good, #6fdc8c); }
	.status.off { color: var(--bad, #ff6b6b); }
	.now { padding: 10px; border: 1px solid var(--rule, #2a3a66); }
	.now.power { border-color: var(--accent, #ff8a4c); }
	.now.after { border-color: var(--bad, #ff6b6b); }
	.big { font-family: var(--font-mono, ui-monospace, monospace); font-size: 20px; font-weight: 600; margin-bottom: 6px; font-variant-numeric: tabular-nums; }
	.row { display: flex; justify-content: space-between; gap: 8px; }
	.row > span:first-child { color: var(--ink-dim, #9aa8cc); }
	.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; text-align: right; }
	.num.yes { color: var(--accent, #ff8a4c); }
	.hint { margin: 4px 0 0; color: var(--ink-dim, #9aa8cc); }
	.recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.recent li { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: start; }
	.what { display: flex; flex-direction: column; min-width: 0; }
	.what small { color: var(--ink-dim, #9aa8cc); }
	.flag { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--ink-dim, #9aa8cc); white-space: nowrap; }
	.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: var(--ink-dim, #9aa8cc); }
	.dot.good { background: var(--good, #6fdc8c); }
	.dot.bad { background: var(--bad, #ff6b6b); }
</style>
