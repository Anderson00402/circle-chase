<script lang="ts">
	/** The newest power-ups of the filter, live. Each row opens its replay when one was stored. */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { Badge, CueChip, DataTable, EmptyState } from '#lib/ui/index.ts';
	import { ago, condition, outcomeStyle } from '#lib/charts/encoding.ts';
	import { outcomeLabel } from '#lib/outcomes.ts';
	import RoleMark from '#lib/charts/RoleMark.svelte';
	import { DEFS } from './defs';
	import type { DashFilter } from './types';

	interface Props {
		filter: DashFilter;
		now: number;
		limit?: number;
		/** Hide the condition column (inside a condition's detail). */
		hideCue?: boolean;
		maxHeight?: string;
	}
	let { filter, now, limit = 30, hideCue = false, maxHeight = '420px' }: Props = $props();
	const recent = useQuery(api.dashboard.recent, () => ({ ...filter, limit }));
	type Row = NonNullable<typeof recent.data>[number];

	const columns = $derived([
		{ key: 'at', label: 'When', width: '104px' },
		{ key: 'p', label: 'Who', width: '108px' },
		...(hideCue ? [] : [{ key: 'cue', label: 'Condition' }]),
		{ key: 'outcome', label: 'Outcome', info: 'See "How this is measured" for the outcome classes. Not counted: no decision about the end, the player left during the 3 s after, or recorded before the current rules.' },
		{ key: 'turn', label: 'Turned away', unit: 's left', numeric: true, info: DEFS.turnAway, width: '120px' },
		{ key: 'total', label: 'Power', unit: 's', numeric: true, width: '76px' },
		{ key: 'replay', label: 'Replay', width: '84px' }
	]);
</script>

{#if recent.data && recent.data.length === 0}
	<EmptyState compact icon="replay" title="No power-ups in this filter yet">New power-ups show up here the moment they are played.</EmptyState>
{:else}
	<DataTable
		caption="Most recent power-ups"
		rows={recent.data ?? []}
		key={(r: Row) => r.id}
		{columns}
		{maxHeight}
		dense
		empty="Loading…"
	>
		{#snippet cell(r: Row, c)}
			{#if c.key === 'at'}
				<span class="dim nowrap" title={new Date(r.at).toLocaleString('en-GB')}>{ago(r.at, now)}</span>
			{:else if c.key === 'p'}
				<span class="nowrap"><span class="num">P{r.p ?? '?'}</span>{#if r.source === 'bot'} <Badge tone="sim">sim</Badge>{/if}</span>
			{:else if c.key === 'cue'}
				<CueChip cue={condition(r.cue)} size="sm" />
			{:else if c.key === 'outcome'}
				{@const o = outcomeStyle(r.outcome)}
				<span class="outcome">
					<RoleMark shape="square" color={o.color} size={10} hollow={o.hatch} />
					{outcomeLabel(r.outcome)}
					{#if !r.inRates}<span class="dim">{r.oldRules ? '(older rules: not counted)' : o.inRates ? '(left before the end: not counted)' : '(not counted)'}</span>{/if}
				</span>
			{:else if c.key === 'turn'}
				<span class="num">{r.turnLeft === null ? '–' : r.turnLeft.toFixed(2)}</span>
			{:else if c.key === 'total'}
				<span class="num">{r.total.toFixed(1)}</span>
			{:else if c.key === 'replay'}
				{#if r.clip}<a href="/replays/{r.id}" class="replay">Watch</a>{:else}<span class="dim" title="Clips are kept for engaged or caught power-ups">none</span>{/if}
			{/if}
		{/snippet}
	</DataTable>
{/if}

<style>
	.dim {
		color: var(--ink-faint);
	}
	.nowrap {
		white-space: nowrap;
	}
	.outcome {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.replay {
		color: var(--focus);
		font-weight: 650;
	}
</style>
