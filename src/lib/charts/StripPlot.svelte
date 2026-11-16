<script lang="ts" module>
	import type { Condition } from './encoding';
	export interface StripPoint {
		key: string;
		v: number;
		/** Link opened on click (a replay). */
		href?: string;
		/** Tooltip lines: [label, value]. */
		info: [string, string][];
		/** Colour of this point (defaults to the row's condition colour). */
		color?: string;
	}
	export interface StripRow {
		id: string;
		cond: Condition;
		points: StripPoint[];
		median: number | null;
		q25: number | null;
		q75: number | null;
		thin?: boolean;
		group?: string;
	}
</script>

<script lang="ts">
	/**
	 * Every trial as a point, one row per condition, with the middle half (box) and the median
	 * (tick) drawn over it. An optional shaded window marks the ideal range, and a line marks zero.
	 * Points are spread vertically by a hash of their key so they do not move when new data arrives.
	 * Click a point to open its replay.
	 */
	import { hash01, ticks } from './encoding';
	import { shapePath } from './shapes';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		rows: StripRow[];
		/** [left, right] of the x axis; may run high to low. */
		domain: [number, number];
		window?: { from: number; to: number; label: string } | null;
		zero?: { label: string } | null;
		/** Axis caption, with unit. */
		xLabel: string;
		/** Words at the left and right ends of the axis ("earlier", "later"). */
		ends?: [string, string];
		format?: (v: number) => string;
		caption: string;
		/** Show the condition name next to the code when there is room. */
		names?: boolean;
		/** Height of one row in px. */
		rowHeight?: number;
	}
	let {
		rows, domain, window = null, zero = null, xLabel, ends, format = (v) => v.toFixed(1), caption, names = true, rowHeight = 30
	}: Props = $props();

	let width = $state(0);
	const ROW_H = $derived(rowHeight);
	const GROUP_H = 26;
	const narrow = $derived(width < 560);
	const labelW = $derived(narrow ? 36 : names ? 170 : 44);
	const padR = 14;
	const top = 26;
	const plotW = $derived(Math.max(60, width - labelW - padR));

	/** Vertical position of each row, leaving room for group captions. */
	const layout = $derived.by(() => {
		let y = top;
		return rows.map((r) => {
			if (r.group) y += GROUP_H;
			const out = { row: r, y, gy: r.group ? y - GROUP_H + 16 : null };
			y += ROW_H;
			return out;
		});
	});
	const height = $derived((layout.length ? layout[layout.length - 1].y + ROW_H : top) + 34);
	const x = (v: number) => labelW + ((v - domain[0]) / (domain[1] - domain[0])) * plotW;
	const clampV = (v: number) => Math.min(Math.max(v, Math.min(...domain)), Math.max(...domain));
	const xticks = $derived(ticks(Math.min(...domain), Math.max(...domain), narrow ? 5 : 10));

	let hover = $state<{ p: StripPoint; row: StripRow; x: number; y: number } | null>(null);

	function pick(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const b = svg.getBoundingClientRect();
		const mx = e.clientX - b.left, my = e.clientY - b.top;
		let best: typeof hover = null, bestD = 10 * 10;
		for (const { row, y } of layout) {
			if (my < y - 4 || my > y + ROW_H + 4) continue;
			for (const p of row.points) {
				const px = x(clampV(p.v)), py = y + 5 + hash01(p.key) * (ROW_H - 10);
				const d = (px - mx) ** 2 + (py - my) ** 2;
				if (d < bestD) {
					bestD = d;
					best = { p, row, x: px, y: py };
				}
			}
		}
		hover = best;
	}
	function open() {
		if (hover?.p.href) location.assign(hover.p.href);
	}
</script>

<div class="strip" bind:clientWidth={width}>
	{#if width > 0}
		<!-- Pointer only: every replay is also reachable by keyboard from the tables on the page. -->
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
		<svg
			{width}
			{height}
			role="img"
			aria-label={caption}
			onpointermove={pick}
			onpointerleave={() => (hover = null)}
			onclick={open}
			style:cursor={hover?.p.href ? 'pointer' : 'default'}
		>
			<!-- ideal window and zero line -->
			{#if window}
				{@const x1 = x(window.from)}
				{@const x2 = x(window.to)}
				<rect x={Math.min(x1, x2)} y={top - 6} width={Math.abs(x2 - x1)} height={height - top - 28} fill="var(--chart-window)" />
				<line x1={x1} x2={x1} y1={top - 6} y2={height - 34} stroke="var(--chart-window-edge)" stroke-dasharray="2 3" />
				<line x1={x2} x2={x2} y1={top - 6} y2={height - 34} stroke="var(--chart-window-edge)" stroke-dasharray="2 3" />
				<text x={(x1 + x2) / 2} y={top - 12} text-anchor="middle" class="win-label">{window.label}</text>
			{/if}
			{#each xticks as t (t)}
				<line x1={x(t)} x2={x(t)} y1={top - 6} y2={height - 34} stroke="var(--chart-grid)" />
				<text x={x(t)} y={height - 18} text-anchor="middle" class="tick">{format(t)}</text>
			{/each}
			{#if zero}
				<line x1={x(0)} x2={x(0)} y1={top - 6} y2={height - 34} stroke="var(--ink-faint)" stroke-width="1.5" />
				{#if !window}<text x={x(0)} y={top - 12} text-anchor="middle" class="win-label">{zero.label}</text>{/if}
			{/if}
			<text x={labelW + plotW / 2} y={height - 2} text-anchor="middle" class="axis-label">{xLabel}</text>
			{#if ends && !narrow}
				<text x={labelW} y={height - 2} class="end">{ends[0]}</text>
				<text x={labelW + plotW} y={height - 2} text-anchor="end" class="end">{ends[1]}</text>
			{/if}

			{#each layout as { row, y, gy } (row.id)}
				{#if gy !== null}
					<text x={0} y={gy} class="group">{row.group}</text>
					<line x1={0} x2={width} y1={gy - 13} y2={gy - 13} stroke="var(--rule)" />
				{/if}
				<g class:thin={row.thin}>
					<line x1={labelW} x2={labelW + plotW} y1={y + ROW_H / 2} y2={y + ROW_H / 2} stroke="var(--chart-grid)" />
					<!-- label: role mark and code, name when there is room -->
					<path d={shapePath(row.cond.shape, 7, y + ROW_H / 2, 4.5)} fill={row.thin ? 'none' : row.cond.color} stroke={row.cond.color} stroke-width="1.4" />
					<text x={17} y={y + ROW_H / 2 + 4} class="code">{row.cond.code}</text>
					{#if !narrow && names}
						<text x={36} y={y + ROW_H / 2 + 4} class="name">{row.cond.name.length > 18 ? row.cond.name.slice(0, 17) + '…' : row.cond.name}</text>
					{/if}
					{#if !row.points.length}
						<text x={labelW + 6} y={y + ROW_H / 2 + 4} class="none">no trials yet</text>
					{/if}
					{#each row.points as p (p.key)}
						<circle
							cx={x(clampV(p.v))}
							cy={y + 5 + hash01(p.key) * (ROW_H - 10)}
							r="3"
							fill={p.color ?? row.cond.color}
							fill-opacity={row.thin ? 0.35 : 0.55}
							stroke={hover?.p.key === p.key ? 'var(--ink)' : 'none'}
							stroke-width="1.5"
						/>
					{/each}
					{#if row.q25 !== null && row.q75 !== null}
						<rect
							x={Math.min(x(row.q25), x(row.q75))}
							y={y + 6}
							width={Math.max(1, Math.abs(x(row.q75) - x(row.q25)))}
							height={ROW_H - 12}
							rx="3"
							fill="none"
							stroke="var(--ink)"
							stroke-opacity="0.55"
							stroke-width="1.2"
						/>
					{/if}
					{#if row.median !== null}
						<line x1={x(row.median)} x2={x(row.median)} y1={y + 3} y2={y + ROW_H - 3} stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" />
					{/if}
				</g>
			{/each}
		</svg>
		{#if hover}
			<Tooltip x={hover.x} y={hover.y} {width}>
				<div class="t-title">{hover.row.cond.code}. {hover.row.cond.name}</div>
				{#each hover.p.info as [k, v] (k)}<div class="t-row">{k} <b>{v}</b></div>{/each}
				{#if hover.p.href}<div class="t-note">Click to open the replay</div>{/if}
			</Tooltip>
		{/if}
	{/if}
</div>

<style>
	.strip {
		position: relative;
		width: 100%;
	}
	svg {
		display: block;
		overflow: visible;
		font-family: var(--font-body);
	}
	.tick {
		fill: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.axis-label,
	.end {
		fill: var(--ink-dim);
		font-size: 12px;
	}
	.end {
		fill: var(--ink-faint);
	}
	.win-label {
		fill: var(--ink-dim);
		font-size: 11px;
	}
	.code {
		fill: var(--ink);
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 700;
	}
	.name {
		fill: var(--ink-dim);
		font-size: 12px;
	}
	.none {
		fill: var(--ink-faint);
		font-size: 11px;
	}
	.group {
		fill: var(--ink-faint);
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.thin .code,
	.thin .name {
		opacity: 0.7;
	}
</style>
