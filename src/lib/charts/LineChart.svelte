<script lang="ts" module>
	export interface LineSeries {
		id: string;
		/** Short label drawn at the line's end (a code like "B", or a word). */
		label: string;
		/** Full name for the tooltip. */
		name: string;
		color: string;
		values: (number | null)[];
		/** Optional shaded band (an interval) around the line. */
		lo?: (number | null)[];
		hi?: (number | null)[];
		/** Sample size per x, shown in the tooltip. */
		n?: number[];
		dash?: string;
		/** Drawn thick and on top; others recede when anything is emphasised. */
		emphasis?: boolean;
		/** Dimmed (e.g. not enough data). */
		faint?: boolean;
		/** Markers at each point (useful when x is a count, not time). */
		dots?: boolean;
	}
</script>

<script lang="ts">
	/**
	 * Lines over a shared x, one y scale. Hover shows a crosshair and every series' value at that x
	 * (emphasised series first). Labels sit at the right end of each line, pushed apart so they never
	 * overlap. Optional shaded x window and vertical markers.
	 */
	import { ticks as niceTicks } from './encoding';
	import { spreadLabels } from './shapes';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		x: number[];
		series: LineSeries[];
		/** [left, right]; may run high to low (time left counting down). */
		xDomain: [number, number];
		yDomain: [number, number];
		xLabel: string;
		yLabel: string;
		xFormat?: (v: number) => string;
		yFormat?: (v: number) => string;
		/** Title of the x position in the tooltip, e.g. (v) => `${v} s left`. */
		xTitle?: (v: number) => string;
		xTicks?: number[];
		window?: { from: number; to: number; label: string } | null;
		markers?: { at: number; label: string }[];
		height?: number;
		caption: string;
		/** Minimum n for a point to be drawn (thin bins are skipped). */
		minN?: number;
		onhoverseries?: (id: string | null) => void;
		/** Draw each line's label at its right end (off for small multiples, whose caption names them). */
		endLabels?: boolean;
	}
	let {
		x, series, xDomain, yDomain, xLabel, yLabel,
		xFormat = (v) => String(v), yFormat = (v) => String(v), xTitle = (v) => xFormat(v), xTicks,
		window = null, markers = [], height = 280, caption, minN = 1, onhoverseries, endLabels = true
	}: Props = $props();

	let width = $state(0);
	const narrow = $derived(width < 520);
	// Room on the right for the end labels (mono, about 7 px per character).
	const pad = $derived({ l: 44, r: endLabels ? 14 + 7 * Math.max(2, ...series.map((s) => s.label.length)) : 10, t: 22, b: 44 });
	const W = $derived(Math.max(80, width - pad.l - pad.r));
	const H = $derived(height - pad.t - pad.b);
	const sx = (v: number) => pad.l + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * W;
	const sy = (v: number) => pad.t + H - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * H;
	const xt = $derived(xTicks ?? niceTicks(Math.min(...xDomain), Math.max(...xDomain), narrow ? 4 : 8));
	const yt = $derived(niceTicks(yDomain[0], yDomain[1], 4));
	const anyEmph = $derived(series.some((s) => s.emphasis));

	const ok = (s: LineSeries, i: number) => s.values[i] !== null && (!s.n || s.n[i] >= minN);

	function path(s: LineSeries): string {
		let d = '', pen = false;
		for (let i = 0; i < x.length; i++) {
			if (!ok(s, i)) { pen = false; continue; }
			d += `${pen ? 'L' : 'M'}${sx(x[i]).toFixed(1)},${sy(s.values[i]!).toFixed(1)}`;
			pen = true;
		}
		return d;
	}
	function band(s: LineSeries): string {
		if (!s.lo || !s.hi) return '';
		const idx = x.map((_, i) => i).filter((i) => ok(s, i) && s.lo![i] !== null && s.hi![i] !== null);
		if (idx.length < 2) return '';
		const up = idx.map((i) => `${sx(x[i]).toFixed(1)},${sy(s.hi![i]!).toFixed(1)}`);
		const dn = idx.reverse().map((i) => `${sx(x[i]).toFixed(1)},${sy(s.lo![i]!).toFixed(1)}`);
		return `M${up.join('L')}L${dn.join('L')}Z`;
	}
	/** Last drawable point of each series, for the end labels. */
	const ends = $derived.by(() => {
		const raw = series.map((s) => {
			for (let i = x.length - 1; i >= 0; i--) if (ok(s, i)) return { s, i, y: sy(s.values[i]!) };
			return null;
		});
		const live = raw.filter((r): r is NonNullable<typeof r> => r !== null);
		const ys = spreadLabels(live.map((r) => r.y), 13, pad.t, pad.t + H);
		return live.map((r, k) => ({ ...r, ly: ys[k] }));
	});

	let hoverI = $state<number | null>(null);
	let hoverY = $state(0);
	function move(e: PointerEvent) {
		const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const mx = e.clientX - b.left;
		hoverY = e.clientY - b.top;
		let best = 0, bd = Infinity;
		x.forEach((v, i) => {
			const d = Math.abs(sx(v) - mx);
			if (d < bd) { bd = d; best = i; }
		});
		hoverI = mx >= pad.l - 8 && mx <= pad.l + W + 8 ? best : null;
	}
	const tipRows = $derived.by(() => {
		if (hoverI === null) return [];
		const i = hoverI;
		return series
			.filter((s) => ok(s, i))
			.sort((a, b) => Number(!!b.emphasis) - Number(!!a.emphasis) || (b.values[i] ?? 0) - (a.values[i] ?? 0))
			.slice(0, 8);
	});
</script>

<div class="line" bind:clientWidth={width}>
	{#if width > 0}
		<svg {width} {height} role="img" aria-label={caption} onpointermove={move} onpointerleave={() => (hoverI = null)}>
			{#if window}
				{@const x1 = sx(window.from)}
				{@const x2 = sx(window.to)}
				<rect x={Math.min(x1, x2)} y={pad.t} width={Math.abs(x2 - x1)} height={H} fill="var(--chart-window)" />
				<text x={(x1 + x2) / 2} y={pad.t - 8} text-anchor="middle" class="note">{window.label}</text>
			{/if}
			{#each yt as t (t)}
				<line x1={pad.l} x2={pad.l + W} y1={sy(t)} y2={sy(t)} stroke="var(--chart-grid)" />
				<text x={pad.l - 8} y={sy(t) + 4} text-anchor="end" class="tick">{yFormat(t)}</text>
			{/each}
			{#each xt as t (t)}
				<text x={sx(t)} y={pad.t + H + 16} text-anchor="middle" class="tick">{xFormat(t)}</text>
			{/each}
			<line x1={pad.l} x2={pad.l + W} y1={pad.t + H} y2={pad.t + H} stroke="var(--chart-axis)" />
			{#each markers as m (m.at)}
				<line x1={sx(m.at)} x2={sx(m.at)} y1={pad.t} y2={pad.t + H} stroke="var(--ink-faint)" stroke-width="1.5" />
				<text x={sx(m.at) + 4} y={pad.t + 10} class="note">{m.label}</text>
			{/each}
			<text x={pad.l + W / 2} y={height - 4} text-anchor="middle" class="axis-label">{xLabel}</text>
			<text x={pad.l - 36} y={pad.t - 8} class="axis-label">{yLabel}</text>

			{#each series as s (s.id)}
				{@const b = band(s)}
				{#if b}<path d={b} fill={s.color} opacity={anyEmph && !s.emphasis ? 0.06 : 0.16} />{/if}
			{/each}
			<!-- background series first, emphasised ones on top -->
			{#each [...series].sort((a, b) => Number(!!a.emphasis) - Number(!!b.emphasis)) as s (s.id)}
				<g
					class="series"
					opacity={s.faint ? 0.35 : anyEmph && !s.emphasis ? 0.35 : 1}
					onpointerenter={() => onhoverseries?.(s.id)}
					onpointerleave={() => onhoverseries?.(null)}
					role="presentation"
				>
					<path d={path(s)} fill="none" stroke={s.color} stroke-width={s.emphasis ? 3 : 1.75} stroke-dasharray={s.dash} stroke-linejoin="round" stroke-linecap="round" />
					{#if s.dots}
						{#each x as xv, i (xv)}
							{#if ok(s, i)}
								<circle cx={sx(xv)} cy={sy(s.values[i]!)} r={s.emphasis ? 4 : 3} fill={s.color} stroke="var(--surface)" stroke-width="2" />
							{/if}
						{/each}
					{/if}
				</g>
			{/each}
			{#each endLabels ? ends : [] as e (e.s.id)}
				<g opacity={e.s.faint || (anyEmph && !e.s.emphasis) ? 0.55 : 1}>
					{#if Math.abs(e.ly - e.y) > 3}
						<line x1={sx(x[e.i]) + 2} x2={pad.l + W + 4} y1={e.y} y2={e.ly} stroke={e.s.color} stroke-width="1" opacity="0.6" />
					{/if}
					<text x={pad.l + W + 6} y={e.ly + 4} class="end-label" class:strong={e.s.emphasis}>{e.s.label}</text>
				</g>
			{/each}

			{#if hoverI !== null}
				<line x1={sx(x[hoverI])} x2={sx(x[hoverI])} y1={pad.t} y2={pad.t + H} stroke="var(--ink-dim)" stroke-dasharray="3 3" />
				{#each tipRows as s (s.id)}
					<circle cx={sx(x[hoverI])} cy={sy(s.values[hoverI]!)} r="4" fill={s.color} stroke="var(--surface)" stroke-width="2" />
				{/each}
			{/if}
		</svg>
		{#if hoverI !== null && tipRows.length}
			<Tooltip x={sx(x[hoverI])} y={Math.max(40, hoverY)} {width}>
				<div class="t-title">{xTitle(x[hoverI])}</div>
				{#each tipRows as s (s.id)}
					<div class="t-row">
						<span class="who"><i style:background={s.color}></i>{s.name}</span>
						<b>{yFormat(s.values[hoverI!]!)}{#if s.n} <small>n {s.n[hoverI!]}</small>{/if}</b>
					</div>
				{/each}
				{#if series.filter((s) => ok(s, hoverI!)).length > tipRows.length}<div class="t-note">Showing the top {tipRows.length}.</div>{/if}
			</Tooltip>
		{/if}
	{/if}
</div>

<style>
	.line {
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
	.axis-label {
		fill: var(--ink-dim);
		font-size: 12px;
	}
	.note {
		fill: var(--ink-dim);
		font-size: 11px;
	}
	.end-label {
		fill: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 600;
	}
	.end-label.strong {
		fill: var(--ink);
		font-weight: 800;
	}
	.who {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.who i {
		width: 10px;
		height: 3px;
		border-radius: 2px;
		flex-shrink: 0;
	}
	small {
		color: var(--ink-faint);
		font-size: 10px;
		font-weight: 400;
	}
</style>
