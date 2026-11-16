<script lang="ts">
	/**
	 * What telemetry sees right now, in words a spectator can follow: the power-up in progress, the
	 * closest scared ghost, whether the player is chasing it, how the trial is shaping up, the last
	 * few trials and what is stored for this cue.
	 *
	 * The seconds left are hidden unless `showTime` is on: a number beside the board would tell the
	 * player what the cue is supposed to tell them.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import type { TelemetryLive } from './client.svelte.ts';
	import { OUTCOME_LABEL, type Outcome } from './types';

	interface Props {
		live: TelemetryLive;
		cue: string;
		/** Name of the cue for headings (defaults to "this cue"). */
		cueName?: string;
		/** Show the power's seconds left. Bindable; off by default. */
		showTime?: boolean;
	}
	let { live, cue, cueName, showTime = $bindable(false) }: Props = $props();

	/** One line in plain words per outcome. */
	const SAYS: Record<Outcome, string> = {
		caught: 'Kept chasing and was caught just after the power ran out',
		'late-catch': 'Caught a ghost in the last 1.5 s',
		overstayed: 'Still chasing when it ran out, but got away',
		'timely-retreat': 'Backed off 0.2 to 2 s before the end',
		'early-retreat': 'Gave up with more than 2 s to spare',
		'not-engaged': 'Was not chasing near the end',
		other: 'Chased, but no clear ending',
		interrupted: 'Cut short (death, new level or left the page)'
	};
	const TONE: Record<Outcome, 'good' | 'bad' | 'dim'> = {
		caught: 'bad', 'late-catch': 'good', overstayed: 'bad', 'timely-retreat': 'good', 'early-retreat': 'bad',
		'not-engaged': 'dim', other: 'dim', interrupted: 'dim'
	};

	// What is stored for this cue (same source as this player), live from Convex.
	const stored = useQuery(api.summary.byCue, () => ({ source: live.source, cue }));
	const here = $derived(stored.data?.cues.find((c) => c.cue === cue) ?? null);

	const r = $derived(live.readout);
	const headline = $derived(
		r.state === 'idle'
			? 'Waiting for a power dot'
			: r.state === 'power'
				? showTime ? `Power on: ${r.left.toFixed(1)} s left` : 'Power on'
				: `Power ran out ${(-r.left).toFixed(1)} s ago`
	);
	const pct = (x: number | null) => (x === null ? '-' : `${Math.round(x * 100)}%`);
	const name = $derived(cueName ?? 'this cue');
</script>

<aside class="panel" aria-label="Live measurement">
	<header>
		<h2>Live measurement</h2>
		<span class="status" class:off={!live.online} title={live.online ? 'Each trial is saved as soon as it ends' : 'Offline: trials are kept and sent when the connection is back'}>
			<span class="led" aria-hidden="true"></span>{live.online ? 'Saving' : 'Offline'}{live.pending > 0 ? ` · ${live.pending} waiting` : ''}
		</span>
	</header>

	<section class="now" class:power={r.state === 'power'} class:after={r.state === 'after'} aria-live="off">
		<h3>This power-up</h3>
		<div class="big">{headline}</div>
		{#if r.state === 'idle'}
			<p class="hint">Every power-up is measured as one trial, from the power dot until 3 s after it runs out.</p>
		{:else}
			<dl>
				<div class="row">
					<dt>{r.state === 'after' ? 'Closest ghost that just turned back' : 'Closest scared ghost'}</dt>
					<dd class="num">{r.nearest ? `${r.nearest.dist.toFixed(1)} tiles` : 'none out'}</dd>
				</div>
				<div class="row">
					<dt>Closing in on it</dt>
					<dd class="num" class:yes={r.chasing}>{r.chasing ? 'yes' : 'no'}</dd>
				</div>
				<div class="row">
					<dt>Chasing near the end</dt>
					<dd class="num" class:yes={r.engaged}>{r.engaged ? 'yes' : 'not yet'}</dd>
				</div>
				<div class="row">
					<dt>Looks like</dt>
					<dd class="num">{r.guess ? OUTCOME_LABEL[r.guess] : 'too early to say'}</dd>
				</div>
			</dl>
			{#if r.state === 'after'}<p class="hint">Watching 3 more seconds: is the player caught?</p>{/if}
		{/if}
		<label class="toggle">
			<input type="checkbox" bind:checked={showTime} />
			Show seconds left <span class="dim">(spoils the cue)</span>
		</label>
	</section>

	<section>
		<h3>Last trials</h3>
		{#if live.recent.length === 0}
			<p class="hint">None yet. Eat a power dot to start one.</p>
		{:else}
			<ol class="recent">
				{#each live.recent as t (t.key)}
					<li>
						<span class="dot {TONE[t.outcome]}" aria-hidden="true"></span>
						<span class="what">
							<strong>{OUTCOME_LABEL[t.outcome]}</strong>
							<small>{SAYS[t.outcome]}{t.turnLeft !== null && t.outcome !== 'interrupted' ? `. Turned away ${t.turnLeft >= 0 ? `with ${t.turnLeft.toFixed(1)} s left` : `${(-t.turnLeft).toFixed(1)} s late`}` : ''}.</small>
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
				<div class="row"><dt>Count toward the rates</dt><dd class="num">{here.inRates}</dd></div>
				<div class="row"><dt>Caught after the end</dt><dd class="num">{pct(here.caught.rate)} <span class="dim">of {here.caught.n}</span></dd></div>
				<div class="row"><dt>Well timed</dt><dd class="num">{pct(here.wellTimed.rate)} <span class="dim">of {here.wellTimed.n}</span></dd></div>
			</dl>
			{#if here.notEnoughData}<p class="hint">Not enough data yet: fewer than 10 trials count.</p>{/if}
		{:else}
			<p class="hint">{stored.isLoading ? 'Loading...' : 'Nothing stored yet.'}</p>
		{/if}
		<p class="hint">{live.saved} saved from this page{live.participantNumber ? ` · you are player ${live.participantNumber}` : ''}</p>
	</section>

	<details>
		<summary>What do these words mean?</summary>
		<p><strong>Counts toward the rates</strong>: the player was chasing in the last 3 s and the power ran out by itself.</p>
		<p><strong>Well timed</strong>: a late catch or a timely retreat. <strong>Caught</strong>: caught within 3 s after the end by a ghost that had been scared.</p>
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
	.now { padding: 10px; border: 1px solid var(--rule, #2a3a66); border-radius: var(--radius-sm, 6px); }
	.now.power { border-color: var(--scared, #6aa8ff); }
	.now.after { border-color: var(--bad, #ff6b6b); }
	.big { font-size: 17px; font-weight: 650; margin-bottom: 6px; font-variant-numeric: tabular-nums; }
	.row { display: flex; justify-content: space-between; gap: 8px; }
	.row > dt { color: var(--ink-dim, #9aa8cc); }
	.num { font-family: var(--font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
	.num.yes { color: var(--accent, #ff8a4c); }
	.dim { color: var(--ink-faint, #8090b8); }
	.hint { margin: 4px 0 0; color: var(--ink-dim, #9aa8cc); }
	.toggle { display: flex; align-items: center; gap: 6px; margin-top: 8px; color: var(--ink-dim, #9aa8cc); font-size: 12px; cursor: pointer; }
	.recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.recent li { display: grid; grid-template-columns: 10px 1fr auto; gap: 8px; align-items: start; }
	.what { display: flex; flex-direction: column; min-width: 0; }
	.what small { color: var(--ink-dim, #9aa8cc); }
	.flag { font-family: var(--font-mono, ui-monospace, monospace); font-size: 11px; color: var(--ink-dim, #9aa8cc); white-space: nowrap; }
	.dot { width: 8px; height: 8px; border-radius: 50%; margin-top: 5px; background: var(--ink-dim, #9aa8cc); }
	.dot.good { background: var(--good, #6fdc8c); }
	.dot.bad { background: var(--bad, #ff6b6b); }
	details { color: var(--ink-dim, #9aa8cc); font-size: 12px; }
	summary { cursor: pointer; color: var(--ink, #eef3ff); }
	details p { margin: 6px 0 0; }
</style>
