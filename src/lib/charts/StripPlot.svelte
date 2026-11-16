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
		/** Points with no value on the axis (e.g. never turned away), drawn in their own lane at the right. */
		extra?: StripPoint[];
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
	 * (tick) drawn over it. Points are laid out as a beeswarm: those that would overlap are stacked
	 * outward from the row's centre line, squeezed together only when a row is very full, so the
	 * shape of the distribution shows even with hundreds of points. An optional lane at the right
	 * holds points with no value on the axis (`extra`, e.g. "never turned"). An optional shaded
	 * window marks the ideal range, and a line marks zero. Click a point to open its replay.
	 */
	import { goto } from '$app/navigation';
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
		/** Heading of the extra lane (shown when any row has extra points). */
		extraLabel?: string;
	}
	let {
		rows, domain, window = null, zero = null, xLabel, ends, format = (v) => v.toFixed(1), caption, names = true, rowHeight = 30,
		extraLabel = ''
	}: Props = $props();

	let width = $state(0);
	const ROW_H = $derived(rowHeight);
	const GROUP_H = 26;
	const narrow = $derived(width < 560);
	const labelW = $derived(narrow ? 36 : names ? 170 : 44);
	const hasExtra = $derived(rows.some((r) => (r.extra?.length ?? 0) > 0));
	const extraW = $derived(hasExtra ? (narrow ? 44 : 76) : 0);
	const padR = 14;
	const top = 26;
	const plotW = $derived(Math.max(60, width - labelW - padR - extraW - (hasExtra ? 12 : 0)));
	const extraX = $derived(labelW + plotW + 12);

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

	/** Dot radius: smaller when rows are dense. */
	const R = $derived(ROW_H >= 44 ? 2.4 : 2.2);

	/**
	 * Beeswarm positions: points are binned by x into columns one dot wide and stacked outward from
	 * the centre (0, +1, -1, +2, ...), in a stable order (hash of the key) so they do not jump when
	 * new data arrives. A column taller than the row is squeezed to fit.
	 */
	function swarm(points: StripPoint[], cx: (p: StripPoint) => number, binW: number, h: number) {
		const bins = new Map<number, StripPoint[]>();
		for (const p of points) {
			const b = Math.round(cx(p) / binW);
			const list = bins.get(b) ?? [];
			list.push(p);
			bins.set(b, list);
		}
		const out = new Map<string, { x: number; dy: number }>();
		const room = h / 2 - R - 2;
		for (const [b, list] of bins) {
			list.sort((p, q) => hash01(p.key) - hash01(q.key));
			const half = Math.ceil((list.length - 1) / 2);
			const gap = half > 0 ? Math.min(2 * R + 0.6, room / half) : 0;
			list.forEach((p, i) => {
				const k = Math.ceil(i / 2) * (i % 2 ? 1 : -1);
				out.set(p.key, { x: b * binW, dy: k * gap });
			});
		}
		return out;
	}
	const pos = $derived.by(() => {
		const m = new Map<string, Map<string, { x: number; dy: number }>>();
		for (const { row } of layout) {
			m.set(row.id, swarm(row.points, (p) => x(clampV(p.v)), 2 * R + 0.8, ROW_H));
			if (row.extra?.length) {
				// The extra lane has no axis: spread its points over the lane width.
				m.set(`${row.id}|extra`, swarm(row.extra, (p) => extraX + 6 + hash01(p.key) * (extraW - 12), 2 * R + 0.8, ROW_H));
			}
		}
		return m;
	});
	const at = (row: StripRow, p: StripPoint, y: number, extra = false) => {
		const q = pos.get(extra ? `${row.id}|extra` : row.id)?.get(p.key);
		return { cx: q?.x ?? x(clampV(p.v)), cy: y + ROW_H / 2 + (q?.dy ?? 0) };
	};

	let hover = $state<{ p: StripPoint; row: StripRow; x: number; y: number; extra: boolean } | null>(null);

	function pick(e: PointerEvent) {
		const svg = e.currentTarget as SVGSVGElement;
		const b = svg.getBoundingClientRect();
		const mx = e.clientX - b.left, my = e.clientY - b.top;
		let best: typeof hover = null, bestD = 9 * 9;
		for (const { row, y } of layout) {
			if (my < y - 4 || my > y + ROW_H + 4) continue;
			for (const [list, extra] of [[row.points, false], [row.extra ?? [], true]] as [StripPoint[], boolean][]) {
				for (const p of list) {
					const { cx, cy } = at(row, p, y, extra);
					const d = (cx - mx) ** 2 + (cy - my) ** 2;
					if (d < bestD) {
						bestD = d;
						best = { p, row, x: cx, y: cy, extra };
					}
				}
			}
		}
		hover = best;
	}
	function open() {
		if (hover?.p.href) goto(hover.p.href);
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
			{#if hasExtra}
				<rect x={extraX} y={top - 6} width={extraW} height={height - top - 28} rx="4" fill="var(--surface-2, rgba(255,255,255,0.03))" />
				<text x={extraX + extraW / 2} y={top - 12} text-anchor="middle" class="win-label">{narrow ? 'never' : extraLabel}</text>
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
					{#if !row.points.length && !row.extra?.length}
						<text x={labelW + 6} y={y + ROW_H / 2 + 4} class="none">no counted power-ups yet</text>
					{/if}
					{#each row.points as p (p.key)}
						{@const c = at(row, p, y)}
						<circle cx={c.cx} cy={c.cy} r={R} fill={p.color ?? row.cond.color} fill-opacity={row.thin ? 0.45 : 0.8}
							stroke={hover?.p.key === p.key ? 'var(--ink)' : 'none'} stroke-width="1.5" />
					{/each}
					{#each row.extra ?? [] as p (p.key)}
						{@const c = at(row, p, y, true)}
						<circle cx={c.cx} cy={c.cy} r={R} fill={p.color ?? row.cond.color} fill-opacity={row.thin ? 0.45 : 0.8}
							stroke={hover?.p.key === p.key ? 'var(--ink)' : 'none'} stroke-width="1.5" />
					{/each}
					{#if row.extra?.length && !narrow}
						<text x={extraX + extraW - 4} y={y + 11} text-anchor="end" class="count">{row.extra.length}</text>
					{/if}
					{#if row.q25 !== null && row.q75 !== null}
						<rect
							x={Math.min(x(row.q25), x(row.q75))}
							y={y + 4}
							width={Math.max(1, Math.abs(x(row.q75) - x(row.q25)))}
							height={ROW_H - 8}
							rx="3"
							fill="none"
							stroke="var(--ink)"
							stroke-opacity="0.6"
							stroke-width="1.2"
						/>
					{/if}
					{#if row.median !== null}
						<line x1={x(row.median)} x2={x(row.median)} y1={y + 2} y2={y + ROW_H - 2} stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round" />
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
	.tick,
	.count {
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
