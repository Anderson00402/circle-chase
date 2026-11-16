<script lang="ts" module>
	import type { Condition } from './encoding';
	export interface DiffRow {
		id: string;
		cond: Condition;
		/** Mean difference in points (percentage points); null when nobody played both. */
		diff: number | null;
		lo: number | null;
		hi: number | null;
		/** People with counted power-ups under both. */
		people: number;
		/** Clear after the family's adjustment. */
		clear: boolean;
		/** Drawn hollow and faint (too few people for an interval). */
		thin?: boolean;
		group?: string;
		/** Tooltip lines: [label, value]. */
		info: [string, string][];
	}
</script>

<script lang="ts">
	/**
	 * Differences against a reference, one row per condition: a point (the mean difference) with its
	 * 95% interval, around a zero line ("same as the reference"). The scale is symmetric and in
	 * points. Clear differences (after adjusting for every comparison in the chart) are drawn solid
	 * and named in the value column; the rest are drawn lighter. Rows are buttons when `onselect` is set.
	 */
	import type { Snippet } from 'svelte';
	import { shapePath } from './shapes';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		rows: DiffRow[];
		/** Half-width of the scale in points (e.g. 40 draws -40 to +40). */
		span: number;
		/** Words at the left and right ends ("worse", "better"). */
		ends: [string, string];
		/** What zero means, e.g. "same as the timer bar". */
		zeroLabel: string;
		label: Snippet<[DiffRow]>;
		selected?: string | null;
		onselect?: (id: string) => void;
		caption: string;
	}
	let { rows, span, ends, zeroLabel, label, selected = null, onselect, caption }: Props = $props();

	const step = $derived(span > 60 ? 25 : span > 30 ? 20 : 10);
	const ticks = $derived.by(() => {
		const out: number[] = [];
		for (let v = -Math.floor(span / step) * step; v <= span + 1e-9; v += step) out.push(v);
		return out;
	});
	const pos = (v: number) => `${((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * 100}%`;
	const fmt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`;

	let box = $state<HTMLDivElement>();
	let boxW = $state(0);
	let hover = $state<{ row: DiffRow; x: number; y: number } | null>(null);
	function move(e: PointerEvent, row: DiffRow) {
		if (!box) return;
		const r = box.getBoundingClientRect();
		hover = { row, x: e.clientX - r.left, y: e.clientY - r.top };
	}
</script>

<div class="diff" bind:this={box} bind:clientWidth={boxW}>
	<table>
		<caption class="visually-hidden">{caption}</caption>
		<thead>
			<tr>
				<th scope="col" class="lab"><span class="visually-hidden">Condition</span></th>
				<th scope="col" class="plot-h">
					<div class="ends"><span>← {ends[0]}</span><span class="zero-l">{zeroLabel}</span><span>{ends[1]} →</span></div>
					<div class="axis">
						{#each ticks as t (t)}<span class="tick" style:left={pos(t)}>{t === 0 ? '0' : fmt(t)}</span>{/each}
					</div>
				</th>
				<th scope="col" class="val-h"><span class="visually-hidden">Difference</span></th>
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.id)}
				{#if row.group}
					<tr class="group"><td colspan="3">{row.group}</td></tr>
				{/if}
				<tr
					class="row"
					class:thin={row.thin}
					class:clear={row.clear}
					class:selected={selected === row.id}
					tabindex={onselect ? 0 : undefined}
					onclick={() => onselect?.(row.id)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onselect?.(row.id))}
					aria-label={onselect ? `Show details for ${row.cond.name}` : undefined}
				>
					<th scope="row" class="lab">{@render label(row)}</th>
					<td class="plot" onpointermove={(e) => move(e, row)} onpointerleave={() => (hover = null)}>
						<div class="track">
							{#each ticks as t (t)}<span class="grid" class:zero={t === 0} style:left={pos(t)}></span>{/each}
							{#if row.diff !== null && row.lo !== null && row.hi !== null}
								<span class="ci" style:left={pos(row.lo * 100)} style:width="calc({pos(row.hi * 100)} - {pos(row.lo * 100)})" style:--c={row.cond.color}></span>
							{/if}
							{#if row.diff !== null}
								<svg class="pt" style:left={pos(row.diff * 100)} width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
									<path
										d={shapePath(row.cond.shape, 8, 8, 5.5)}
										fill={row.thin ? 'var(--surface)' : row.cond.color}
										stroke={row.thin ? row.cond.color : 'var(--surface)'}
										stroke-width={row.thin ? 1.6 : 2}
									/>
								</svg>
							{/if}
						</div>
					</td>
					<td class="val">
						{#if row.diff !== null}
							<span class="num d">{fmt(row.diff * 100)} pts</span>
							<span class="kn">{row.clear ? 'clear' : row.lo === null ? `${row.people} ${row.people === 1 ? 'person' : 'people'}` : 'could be chance'}</span>
						{:else}
							<span class="none">nobody played both</span>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
	{#if hover}
		<Tooltip x={hover.x} y={hover.y} width={boxW}>
			<div class="t-title">{hover.row.cond.code}. {hover.row.cond.name}</div>
			{#each hover.row.info as [k, v] (k)}<div class="t-row">{k} <b>{v}</b></div>{/each}
		</Tooltip>
	{/if}
</div>

<style>
	.diff {
		position: relative;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	th,
	td {
		padding: 0;
		font-weight: 400;
		text-align: left;
	}
	.lab {
		width: 30%;
		padding-right: var(--space-3);
	}
	.val-h,
	.val {
		width: 104px;
	}
	.plot-h {
		vertical-align: bottom;
		padding-bottom: 6px;
	}
	.ends {
		display: flex;
		justify-content: space-between;
		gap: 6px;
		margin: 0 8px 6px;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.zero-l {
		color: var(--ink-dim);
		text-align: center;
	}
	.axis {
		position: relative;
		height: 14px;
		margin: 0 8px;
	}
	.tick {
		position: absolute;
		bottom: 0;
		translate: -50% 0;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1;
	}
	.group td {
		padding: var(--space-4) 0 var(--space-2);
		border-top: 1px solid var(--rule);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.row > * {
		padding-top: 3px;
		padding-bottom: 3px;
	}
	.row[tabindex] {
		cursor: pointer;
	}
	.row:hover > *,
	.row:focus-visible > * {
		background: color-mix(in srgb, var(--surface-3) 55%, transparent);
	}
	.row.selected > * {
		background: var(--accent-soft);
	}
	.row:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.row > :first-child {
		padding-left: 6px;
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
	}
	.row > :last-child {
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}
	.track {
		position: relative;
		height: 26px;
		margin: 0 8px;
	}
	.grid {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 1px;
		background: var(--chart-grid);
	}
	.grid.zero {
		width: 1.5px;
		background: var(--ink-faint);
	}
	.ci {
		position: absolute;
		top: 50%;
		height: 2px;
		margin-top: -1px;
		min-width: 1px;
		background: var(--c);
		border-radius: 1px;
		opacity: 0.5;
	}
	.clear .ci {
		opacity: 1;
	}
	.ci::before,
	.ci::after {
		content: '';
		position: absolute;
		top: -4px;
		width: 2px;
		height: 10px;
		background: var(--c);
		border-radius: 1px;
	}
	.ci::before { left: -1px; }
	.ci::after { right: -1px; }
	.pt {
		position: absolute;
		top: 50%;
		translate: -50% -50%;
		overflow: visible;
	}
	.row:not(.clear) .pt {
		opacity: 0.7;
	}
	.val {
		padding-left: 6px;
		line-height: 1.1;
		white-space: nowrap;
	}
	.d {
		display: block;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 650;
	}
	.kn {
		display: block;
		color: var(--ink-faint);
		font-size: 11px;
	}
	.clear .kn {
		color: var(--ink);
		font-weight: 650;
	}
	.thin .d {
		color: var(--ink-dim);
	}
	.none {
		color: var(--ink-faint);
		font-size: 11px;
		white-space: normal;
	}
	@media (max-width: 640px) {
		.lab {
			width: 36%;
		}
		.val-h,
		.val {
			width: 84px;
		}
		.zero-l {
			display: none;
		}
	}
</style>
