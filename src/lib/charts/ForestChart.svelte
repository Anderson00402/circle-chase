<script lang="ts" module>
	import type { Condition } from './encoding';
	export interface Interval {
		rate: number | null;
		lo: number | null;
		hi: number | null;
		k: number;
		n: number;
	}
	export interface ForestRow {
		id: string;
		cond: Condition;
		/** One interval per column key; null when there is nothing to show. */
		values: Record<string, Interval | null>;
		/** Fewer trials than the honesty threshold: drawn hollow and faint, never ranked. */
		thin: boolean;
		/** Draw a divider and this caption above the row (e.g. "Not enough data yet"). */
		group?: string;
		/** Extra line for the tooltip. */
		note?: string;
		/** Text in place of a value when a column has nothing counted (default "none yet"). */
		empty?: string;
	}
	export interface ForestRef {
		id: string;
		code: string;
		name: string;
		value: number;
		color: string;
		dash?: string;
	}
	export interface ForestColumn {
		key: string;
		title: string;
		/** Which direction is good, said in the header. */
		better: 'higher' | 'lower';
		/** Yardstick lines drawn across every row of this column. */
		refs: ForestRef[];
		/** Text for the n under the value, e.g. "counted". */
		noun?: string;
	}
</script>

<script lang="ts">
	/**
	 * A forest plot built from HTML rows: one row per condition, one column per rate, each a point
	 * estimate with its 95% interval on a fixed 0-100% scale, plus vertical yardstick lines (the
	 * references and the timer bar) so "is this above no signal / the blink / the timer bar?" can be
	 * read straight off the page. Rows are buttons: activate one to select that condition.
	 * When the chart is narrow (a phone), it shows one column at a time with a picker above, so each
	 * plot keeps a readable width.
	 */
	import type { Snippet } from 'svelte';
	import { pct, pctRange } from './encoding';
	import RoleMark from './RoleMark.svelte';
	import Tooltip from './Tooltip.svelte';
	import { shapePath } from './shapes';

	interface Props {
		rows: ForestRow[];
		columns: ForestColumn[];
		/** The row label (a chip). */
		label: Snippet<[ForestRow]>;
		selected?: string | null;
		onselect?: (id: string) => void;
		caption: string;
	}
	let { rows, columns, label, selected = null, onselect, caption }: Props = $props();

	const TICKS = [0, 0.25, 0.5, 0.75, 1];
	let box = $state<HTMLDivElement>();
	let boxW = $state(0);
	let hover = $state<{ row: ForestRow; col: ForestColumn; x: number; y: number } | null>(null);
	let plotW = $state(0);
	let active = $state(0);
	const narrow = $derived(boxW > 0 && boxW < 600 && columns.length > 1);
	const shown = $derived(narrow ? [columns[Math.min(active, columns.length - 1)]] : columns);

	function move(e: PointerEvent, row: ForestRow, col: ForestColumn) {
		if (!box) return;
		const r = box.getBoundingClientRect();
		hover = { row, col, x: e.clientX - r.left, y: e.clientY - r.top };
	}

	/** Yardstick code labels in the header, nudged apart so close values do not overlap. */
	function refLabels(refs: ForestRef[], width: number) {
		const minGap = 16;
		const pts = refs.map((r) => ({ r, x: r.value * width })).sort((a, b) => a.x - b.x);
		for (let i = 1; i < pts.length; i++) if (pts[i].x - pts[i - 1].x < minGap) pts[i].x = pts[i - 1].x + minGap;
		return pts.map((p) => ({ ...p, x: Math.min(width - 6, Math.max(6, p.x)) }));
	}
</script>

<div class="forest" class:narrow bind:this={box} bind:clientWidth={boxW}>
	{#if narrow}
		<div class="picker" role="group" aria-label="Column shown">
			{#each columns as col, i (col.key)}
				<button type="button" class:on={i === active} aria-pressed={i === active} onclick={() => (active = i)}>{col.title}</button>
			{/each}
		</div>
	{/if}
	<table>
		<caption class="visually-hidden">{caption}</caption>
		<thead>
			<tr>
				<th scope="col" class="lab"><span class="visually-hidden">Condition</span></th>
				{#each shown as col (col.key)}
					<th scope="col" class="plot-h">
						<div class="col-title">
							{col.title}
							<span class="better">{col.better === 'higher' ? 'higher is better' : 'lower is better'}</span>
						</div>
						<div class="axis" bind:clientWidth={plotW}>
							{#each refLabels(col.refs, plotW) as p (p.r.id)}
								<span class="ref-code" style:left="{p.x}px" title="{p.r.name}: {pct(p.r.value)}">{p.r.code}</span>
							{/each}
							{#each TICKS as t (t)}
								<span class="tick" style:left="{t * 100}%">{Math.round(t * 100)}{t === 1 ? '%' : ''}</span>
							{/each}
						</div>
					</th>
					<th scope="col" class="val-h"><span class="visually-hidden">{col.title} value</span></th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.id)}
				{#if row.group}
					<tr class="group"><td colspan={1 + shown.length * 2}>{row.group}</td></tr>
				{/if}
				<tr
					class="row"
					class:thin={row.thin}
					class:selected={selected === row.id}
					tabindex={onselect ? 0 : undefined}
					onclick={() => onselect?.(row.id)}
					onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onselect?.(row.id))}
					aria-label={onselect ? `Show details for ${row.cond.name}` : undefined}
				>
					<th scope="row" class="lab">{@render label(row)}</th>
					{#each shown as col (col.key)}
						{@const v = row.values[col.key]}
						<td
							class="plot"
							onpointermove={(e) => move(e, row, col)}
							onpointerleave={() => (hover = null)}
						>
							<div class="track">
								{#each TICKS as t (t)}<span class="grid" style:left="{t * 100}%"></span>{/each}
								{#each col.refs as r (r.id)}
									<span
										class="ref"
										class:dashed={!!r.dash}
										style:left="{r.value * 100}%"
										style:--c={r.color}
										style:--dash={r.dash === '1.5 3.5' ? '2px' : '4px'}
									></span>
								{/each}
								{#if v && v.rate !== null && v.lo !== null && v.hi !== null}
									<span class="ci" style:left="{v.lo * 100}%" style:width="{(v.hi - v.lo) * 100}%" style:--c={row.cond.color}></span>
									<svg class="pt" style:left="{v.rate * 100}%" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
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
							{#if v && v.n > 0}
								<span class="num rate">{pct(v.rate)}</span>
								<span class="num kn">{v.k}/{v.n}</span>
							{:else}
								<span class="none">{row.empty ?? 'none yet'}</span>
							{/if}
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
	{#if hover}
		{@const v = hover.row.values[hover.col.key]}
		<Tooltip x={hover.x} y={hover.y} width={boxW}>
			<div class="t-title">
				<RoleMark shape={hover.row.cond.shape} color={hover.row.cond.color} hollow={hover.row.thin} />
				{hover.row.cond.code}. {hover.row.cond.name}
			</div>
			{#if v && v.n > 0}
				<div class="t-row">{hover.col.title} <b>{pct(v.rate)}</b></div>
				<div class="t-row">95% interval <b>{pctRange(v.lo, v.hi)}</b></div>
				<div class="t-row">Power-ups <b>{v.k} of {v.n}</b></div>
				{#each hover.col.refs.filter((r) => r.id !== hover?.row.id) as r (r.id)}
					<div class="t-row">vs {r.code}. {r.name} <b>{pct(r.value)}</b></div>
				{/each}
			{:else}
				<div class="t-row">No counted power-ups yet</div>
			{/if}
			{#if hover.row.thin && v && v.n > 0}<div class="t-note">Fewer than 10 counted power-ups: not enough data to rank.</div>{/if}
			{#if hover.row.note}<div class="t-note">{hover.row.note}</div>{/if}
		</Tooltip>
	{/if}
</div>

<style>
	.forest {
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
		width: 34%;
		padding-right: var(--space-3);
	}
	.val-h,
	.val {
		width: 76px;
	}
	.plot-h {
		vertical-align: bottom;
		padding-bottom: 6px;
	}
	.col-title {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 8px;
		margin-bottom: 18px;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 700;
	}
	.better {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-weight: 400;
	}
	.axis {
		position: relative;
		height: 16px;
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
	.ref-code {
		position: absolute;
		bottom: 20px;
		translate: -50% 0;
		color: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
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
	.row {
		cursor: pointer;
	}
	.row > * {
		padding-top: 3px;
		padding-bottom: 3px;
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
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
		padding-left: 6px;
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
	.ref {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 0;
		border-left: 1.5px solid var(--c);
		opacity: 0.75;
	}
	.ref.dashed {
		border-left: 0;
		width: 1.5px;
		background: repeating-linear-gradient(to bottom, var(--c) 0 var(--dash), transparent var(--dash) calc(var(--dash) * 2));
	}
	.ci {
		position: absolute;
		top: 50%;
		height: 2px;
		margin-top: -1px;
		min-width: 1px;
		background: var(--c);
		border-radius: 1px;
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
	.thin .ci {
		opacity: 0.45;
	}
	.pt {
		position: absolute;
		top: 50%;
		translate: -50% -50%;
		overflow: visible;
	}
	.val {
		padding-left: 4px;
		line-height: 1.1;
		white-space: nowrap;
	}
	.rate {
		display: block;
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 650;
	}
	.thin .rate {
		color: var(--ink-dim);
	}
	.kn {
		display: block;
		color: var(--ink-faint);
		font-size: 11px;
	}
	.none {
		display: block;
		color: var(--ink-faint);
		font-size: 11px;
		line-height: 1.15;
		white-space: normal;
	}

	/* Narrow: one column at a time, picked above the chart. */
	.picker {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: var(--space-3);
	}
	.picker button {
		padding: 4px 10px;
		border: 1px solid var(--rule);
		border-radius: 999px;
		background: none;
		color: var(--ink-dim);
		font-size: var(--text-xs);
		cursor: pointer;
	}
	.picker button.on {
		border-color: var(--ink-dim);
		background: var(--surface-3);
		color: var(--ink);
	}
	.narrow .lab {
		width: 40%;
	}
	.narrow .val-h,
	.narrow .val {
		width: 64px;
	}
</style>
