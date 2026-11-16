<script lang="ts" module>
	export interface StackSegment {
		id: string;
		label: string;
		color: string;
		hatch?: boolean;
		/** Definition shown in the tooltip. */
		def?: string;
	}
	export interface StackRow {
		id: string;
		counts: Record<string, number>;
		/** Rows below the honesty threshold are drawn faint. */
		thin?: boolean;
		group?: string;
	}
</script>

<script lang="ts">
	/**
	 * 100% stacked horizontal bars, one per row, segments in a fixed order with a 2 px gap between
	 * them. Hover a segment for its count and share. The total sits at the right of every bar.
	 */
	import type { Snippet } from 'svelte';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		rows: StackRow[];
		segments: StackSegment[];
		label: Snippet<[StackRow]>;
		/** Noun for the total, e.g. "trials". */
		noun?: string;
		caption: string;
		selected?: string | null;
		onselect?: (id: string) => void;
	}
	let { rows, segments, label, noun = 'trials', caption, selected = null, onselect }: Props = $props();
	// Row height in px (taller for a single bar).
	const tall = $derived(rows.length === 1);
	const pid = $props.id();

	let box = $state<HTMLDivElement>();
	let boxW = $state(0);
	let hover = $state<{ row: StackRow; seg: StackSegment; x: number; y: number } | null>(null);
	const total = (r: StackRow) => segments.reduce((a, s) => a + (r.counts[s.id] ?? 0), 0);

	function move(e: PointerEvent, row: StackRow, seg: StackSegment) {
		if (!box) return;
		const b = box.getBoundingClientRect();
		hover = { row, seg, x: e.clientX - b.left, y: e.clientY - b.top };
	}
</script>

<div class="stack" bind:this={box} bind:clientWidth={boxW}>
	<svg width="0" height="0" class="defs" aria-hidden="true">
		<defs>
			{#each segments.filter((s) => s.hatch) as s (s.id)}
				<pattern id="{pid}-{s.id}" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
					<rect width="5" height="5" fill={s.color} opacity="0.3" />
					<line x1="0" y1="0" x2="0" y2="5" stroke={s.color} stroke-width="2.6" />
				</pattern>
			{/each}
		</defs>
	</svg>
	<table class:tall>
		<caption class="visually-hidden">{caption}</caption>
		<colgroup><col class="c-lab" /><col /><col class="c-n" /></colgroup>
		<tbody>
			{#each rows as row (row.id)}
				{@const n = total(row)}
				{#if row.group}
					<tr class="group"><td colspan="3">{row.group}</td></tr>
				{/if}
				<tr
					class="row"
					class:thin={row.thin}
					class:selected={selected === row.id}
					onclick={() => onselect?.(row.id)}
				>
					<th scope="row" class="lab">{@render label(row)}</th>
					<td class="bar-cell">
						{#if n > 0}
							<div class="bar" role="img" aria-label={segments.filter((s) => row.counts[s.id]).map((s) => `${s.label} ${row.counts[s.id]}`).join(', ')}>
								{#each segments as s (s.id)}
									{@const c = row.counts[s.id] ?? 0}
									{#if c > 0}
										<svg
											class="seg"
											style:flex-grow={c}
											preserveAspectRatio="none"
											viewBox="0 0 10 10"
											onpointermove={(e) => move(e, row, s)}
											onpointerleave={() => (hover = null)}
											role="presentation"
										>
											<rect width="10" height="10" fill={s.hatch ? `url(#${pid}-${s.id})` : s.color} />
										</svg>
									{/if}
								{/each}
							</div>
						{:else}
							<span class="none">no trials yet</span>
						{/if}
					</td>
					<td class="num n">{n}</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if hover}
		{@const n = total(hover.row)}
		{@const c = hover.row.counts[hover.seg.id] ?? 0}
		<Tooltip x={hover.x} y={hover.y} width={boxW}>
			<div class="t-title">{hover.seg.label}</div>
			<div class="t-row">Trials <b>{c} of {n}</b></div>
			<div class="t-row">Share <b>{Math.round((c / Math.max(1, n)) * 100)}%</b></div>
			{#if hover.seg.def}<div class="t-note">{hover.seg.def}</div>{/if}
		</Tooltip>
	{/if}
	<p class="foot">Total {noun} at the right of each bar.</p>
</div>

<style>
	.stack {
		position: relative;
	}
	.defs {
		position: absolute;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	th,
	td {
		padding: 3px 0;
		font-weight: 400;
		text-align: left;
	}
	.c-lab {
		width: 34%;
	}
	.c-n {
		width: 48px;
	}
	.lab {
		padding-right: var(--space-3);
		padding-left: 6px;
	}
	.n {
		padding-left: 8px;
		color: var(--ink-dim);
		font-size: var(--text-xs);
		text-align: right;
	}
	.row:hover > *,
	.row.selected > * {
		background: color-mix(in srgb, var(--surface-3) 55%, transparent);
	}
	.row.selected > * {
		background: var(--accent-soft);
	}
	.bar {
		display: flex;
		gap: 2px;
		height: 18px;
		border-radius: 4px;
		overflow: hidden;
	}
	.seg {
		display: block;
		flex-basis: 0;
		min-width: 2px;
		height: 100%;
		width: auto;
	}
	.tall .bar {
		height: 28px;
	}
	.thin .bar {
		opacity: 0.55;
	}
	.none {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.group td {
		padding: var(--space-4) 0 var(--space-2);
		border-top: 1px solid var(--rule);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.foot {
		margin-top: var(--space-2);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	@media (max-width: 640px) {
		table, tbody {
			display: block;
		}
		.row {
			display: grid;
			grid-template-columns: 1fr 40px;
			align-items: center;
		}
		.group, .group td {
			display: block;
		}
		.row .lab {
			grid-column: 1 / -1;
			width: auto;
		}
		.bar-cell {
			padding-left: 6px;
		}
	}
</style>
