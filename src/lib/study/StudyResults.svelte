<script lang="ts">
	/** Thank-you screen: the participant's own results per round, now with the condition names. */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { cueById } from '../game/cues/index';
	import { Badge, Button, CueChip, Page, Panel } from '#lib/ui/index.ts';

	interface Props {
		sessionKey: string;
		/** Writes still waiting to be sent (answers saved locally first). */
		pending: number;
		clearest: string | null;
		leastClear: string | null;
		onrestart: () => void;
	}
	let { sessionKey, pending, clearest, leastClear, onrestart }: Props = $props();

	const res = useQuery(api.study.results, () => ({ sessionKey }));
	const rounds = $derived((res.data?.blocks ?? []).filter((b) => !b.practice && !b.abandoned).sort((a, b) => a.orderIndex - b.orderIndex));
	const totals = $derived(rounds.reduce((t, b) => ({ counted: t.counted + b.counted, well: t.well + b.wellTimed, caught: t.caught + b.caught }), { counted: 0, well: 0, caught: 0 }));
	const pct = (k: number, n: number) => (n ? `${Math.round((k / n) * 100)}%` : '-');
</script>

<Page width="narrow">
	<div class="done">
		<p class="eyebrow">Study complete</p>
		<h1>Thank you!</h1>
		<p class="lead">
			Your play and answers are saved. Here is how each round went, and which signal it used.
			{#if pending > 0}<span class="saving">Still sending {pending} answer{pending === 1 ? '' : 's'}; keep this page open a moment.</span>{/if}
		</p>

		<Panel title="Your rounds" sub="Only power-ups where you were chasing near the end count (as on the dashboard)." level={2} flush>
			{#if res.isLoading}
				<p class="pad">Loading your results...</p>
			{:else if !res.data}
				<p class="pad">Your results are not on the server yet. They are kept on this device and will appear when the connection is back.</p>
			{:else}
				<div class="table-wrap">
					<table>
						<thead>
							<tr><th scope="col">Round</th><th scope="col">Signal</th><th scope="col" class="n" title="Power-ups that count toward the rates, out of all power-ups in the round">Counted</th><th scope="col" class="n">Well timed</th><th scope="col" class="n">Caught</th><th scope="col" class="n">Clarity</th></tr>
						</thead>
						<tbody>
							{#each rounds as b, i (b.key)}
								{@const cue = cueById(b.cue)}
								<tr>
									<td class="num">{i + 1}</td>
									<td>
										<CueChip {cue} href="/cues#{cue.id}" size="sm" wrap />
										{#if b.cue === clearest}<Badge tone="good">Your clearest</Badge>{/if}
										{#if b.cue === leastClear}<Badge tone="bad">Your least clear</Badge>{/if}
									</td>
									<td class="n num">{b.counted}<span class="dim">&nbsp;of {b.trials}</span></td>
									<td class="n num">{b.wellTimed} <span class="dim">{pct(b.wellTimed, b.counted)}</span></td>
									<td class="n num">{b.caught} <span class="dim">{pct(b.caught, b.counted)}</span></td>
									<td class="n num">{b.clarity ?? '-'}<span class="dim">/7</span></td>
								</tr>
							{/each}
						</tbody>
						<tfoot>
							<tr><th scope="row" colspan="2">All rounds</th><td class="n num">{totals.counted}</td><td class="n num">{totals.well} <span class="dim">{pct(totals.well, totals.counted)}</span></td><td class="n num">{totals.caught} <span class="dim">{pct(totals.caught, totals.counted)}</span></td><td></td></tr>
						</tfoot>
					</table>
				</div>
			{/if}
		</Panel>
		<p class="note">
			<strong>Well timed</strong>: you caught a ghost in the last 1.5 s or backed off 0.2 to 2 s before the end.
			<strong>Caught</strong>: a ghost that had been scared caught you within 3 s after the end. A handful of
			power-ups per round says little on its own; the study compares many players.
		</p>

		<div class="links">
			<Button variant="primary" href="/dashboard">See everyone's results</Button>
			{#if res.data}<Button href="/replays?session={res.data.sessionId}">Watch my replays</Button>{/if}
			<Button variant="ghost" href="/cues">All the signals</Button>
		</div>
		<p class="again"><button class="link" onclick={onrestart}>Start a new session</button> (for another person on this device)</p>
	</div>
</Page>

<style>
	.done { display: flex; flex-direction: column; gap: var(--space-4); padding-bottom: var(--space-7); }
	.eyebrow { color: var(--good); }
	h1 { font-size: var(--text-3xl); font-weight: 600; }
	.lead { color: var(--ink-dim); font-size: var(--text-lg); }
	.saving { display: block; margin-top: var(--space-2); color: var(--warn); font-size: var(--text-sm); }
	.pad { padding: var(--space-4); color: var(--ink-dim); }
	.table-wrap { overflow-x: auto; }
	table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
	th, td { padding: 10px 14px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: middle; }
	thead th { color: var(--ink-dim); font-weight: 600; font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; }
	td :global(.badge) { margin: 4px 4px 0 0; }
	.n { text-align: right; white-space: nowrap; }
	.dim { color: var(--ink-faint); }
	tfoot th, tfoot td { border-bottom: 0; font-weight: 700; }
	.note { color: var(--ink-dim); font-size: var(--text-sm); }
	.links { display: flex; flex-wrap: wrap; gap: var(--space-3); }
	.again { color: var(--ink-faint); font-size: var(--text-sm); }
	.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
	@media (max-width: 520px) {
		th, td { padding: 8px 8px; }
		.links :global(.btn) { flex: 1 1 100%; }
	}
</style>
