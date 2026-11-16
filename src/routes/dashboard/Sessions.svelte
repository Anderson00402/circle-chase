<script lang="ts">
	/**
	 * Participants and sessions: who played, how much, and whether the data can be trusted (frame
	 * rate, sound, input type, completion, questionnaire answered).
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { Badge, DataTable, EmptyState } from '#lib/ui/index.ts';
	import { ago, plural } from '#lib/charts/encoding.ts';
	import { modeLabel } from '#lib/outcomes.ts';
	import { DEFS } from './defs';
	import type { DashFilter } from './types';

	interface Props {
		filter: DashFilter;
		now: number;
		onparticipant: (id: string) => void;
	}
	let { filter, now, onparticipant }: Props = $props();
	const sessions = useQuery(api.dashboard.sessions, () => ({
		source: filter.source, mode: filter.mode, participantId: filter.participantId, from: filter.from, run: filter.run
	}));
	/** The replay list filtered to this participant (replays show one person's power-ups, newest first). */
	const replaysHref = (r: Row) => `/replays?${new URLSearchParams({ ...(r.source !== 'human' ? { source: r.source } : {}), ...(r.p !== null ? { p: String(r.p) } : {}) })}`;
	type Row = NonNullable<typeof sessions.data>[number];
	const rows = $derived(sessions.data ?? []);

	const quality = $derived.by(() => {
		const r = rows;
		const study = r.filter((s) => s.mode === 'study');
		const inputs = new Map<string, number>();
		for (const s of r) inputs.set(s.inputType, (inputs.get(s.inputType) ?? 0) + 1);
		return {
			sessions: r.length,
			people: new Set(r.map((s) => s.participantId)).size,
			soundOn: r.filter((s) => s.sound).length,
			reduced: r.filter((s) => s.reducedMotion).length,
			lowFps: r.reduce((a, s) => a + s.lowFps, 0),
			trials: r.reduce((a, s) => a + s.trials, 0),
			complete: study.filter((s) => s.planned > 0 && s.blocksPlayed >= s.planned).length,
			study: study.length,
			inputs: [...inputs.entries()].sort((a, b) => b[1] - a[1])
		};
	});

	const columns = [
		{ key: 'p', label: 'Who', width: '84px' },
		{ key: 'when', label: 'Started', width: '96px' },
		{ key: 'mode', label: 'Rules', width: '108px' },
		{ key: 'blocks', label: 'Runs', numeric: true, info: 'Runs (conditions played) with at least one power-up, out of the conditions planned for the session.', width: '84px' },
		{ key: 'trials', label: 'Power-ups', numeric: true, info: 'All power-ups (counted toward the rates).', width: '100px' },
		{ key: 'fps', label: 'Frame rate', unit: 'fps', numeric: true, info: DEFS.fps, width: '110px' },
		{ key: 'sound', label: 'Sound', width: '70px' },
		{ key: 'input', label: 'Input', width: '90px' },
		{ key: 'ratings', label: 'Answers', info: 'Questionnaires answered after runs, and whether the final question was answered.', width: '90px' },
		{ key: 'replays', label: 'Replays', info: 'Power-ups with a stored replay. Opens the replay list for this participant.', width: '96px' }
	];
</script>

{#if sessions.data && !rows.length}
	<EmptyState compact icon="study" title="No sessions in this filter" />
{:else}
	<ul class="quality" aria-label="Data quality">
		<li><b class="num">{quality.people}</b> {quality.people === 1 ? 'person' : 'people'}, <b class="num">{quality.sessions}</b> {quality.sessions === 1 ? 'session' : 'sessions'}</li>
		<li><b class="num">{quality.complete}</b> of {quality.study} {quality.study === 1 ? 'session' : 'sessions'} under study rules played every condition</li>
		<li>Sound on in <b class="num">{quality.soundOn}</b> of {quality.sessions}</li>
		<li>
			Input:
			{#each quality.inputs as [k, n], i (k)}<b class="num">{n}</b> {k}{i < quality.inputs.length - 1 ? ', ' : ''}{/each}
		</li>
		<li class:warn={quality.lowFps > 0}>
			<b class="num">{quality.lowFps}</b> of {plural(quality.trials, 'power-up')} below 50 fps
		</li>
		{#if quality.reduced}<li><b class="num">{quality.reduced}</b> with reduced motion</li>{/if}
	</ul>
	<DataTable
		caption="Sessions with data-quality columns"
		{rows}
		key={(r: Row) => r.id}
		{columns}
		dense
		maxHeight="460px"
		empty="Loading…"
		onrowclick={(r: Row) => onparticipant(r.participantId)}
	>
		{#snippet cell(r: Row, c)}
			{#if c.key === 'p'}
				<span class="num">{r.label ?? `P${r.p ?? '?'}`}</span>
				{#if r.source === 'bot'}<Badge tone="sim">sim</Badge>{/if}
			{:else if c.key === 'when'}
				<span class="dim" title={new Date(r.startedAt).toLocaleString('en-GB')}>{ago(r.startedAt, now)}</span>
			{:else if c.key === 'mode'}
				{modeLabel(r.mode)}
			{:else if c.key === 'blocks'}
				<span class="num">{r.blocksPlayed}{r.planned ? ` / ${r.planned}` : ''}</span>
			{:else if c.key === 'trials'}
				<span class="num">{r.trials} <span class="dim">({r.inRates})</span></span>
			{:else if c.key === 'fps'}
				<span class="num" class:bad={r.fpsMin !== null && r.fpsMin < 50}>{r.fpsMean ?? '–'}{#if r.fpsMin !== null && r.fpsMin < (r.fpsMean ?? 0) - 3}<span class="dim"> min {r.fpsMin}</span>{/if}</span>
			{:else if c.key === 'sound'}
				{r.sound ? 'On' : 'Off'}
			{:else if c.key === 'input'}
				{r.inputType}
			{:else if c.key === 'ratings'}
				<span class="num">{r.blockRatings}{r.finalRating ? ' + final' : ''}</span>
			{:else if c.key === 'replays'}
				{#if r.clips}
					<a class="link" href={replaysHref(r)} onclick={(e) => e.stopPropagation()}>{r.clips} replays</a>
				{:else}<span class="dim">none</span>{/if}
			{/if}
		{/snippet}
	</DataTable>
	<p class="foot">Click a session to filter the whole page to that participant. Replays opens their power-ups in the replay list.</p>
{/if}

<style>
	.quality {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 20px;
		margin: 0 0 var(--space-3);
		padding: 0 var(--space-5);
		list-style: none;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.quality b {
		color: var(--ink);
	}
	.warn b {
		color: var(--warn);
	}
	.dim {
		color: var(--ink-faint);
	}
	.bad {
		color: var(--warn);
	}
	.link {
		color: var(--focus);
		font-weight: 650;
		white-space: nowrap;
	}
	.foot {
		padding: var(--space-2) var(--space-5) var(--space-4);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	@media (max-width: 520px) {
		.quality { padding: 0 var(--space-4); }
		.foot { padding: var(--space-2) var(--space-4) var(--space-4); }
	}
</style>
