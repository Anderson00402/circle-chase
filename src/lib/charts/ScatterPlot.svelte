<script lang="ts" module>
	import type { Shape } from './encoding';
	export interface ScatterPoint {
		id: string;
		label: string;
		name: string;
		x: number;
		y: number;
		xlo?: number | null;
		xhi?: number | null;
		ylo?: number | null;
		yhi?: number | null;
		color: string;
		shape: Shape;
		/** Hollow and faint: too little data. */
		thin?: boolean;
		info: [string, string][];
	}
</script>

<script lang="ts">
	/**
	 * Points with optional interval whiskers on both axes, each labelled with its code. Used to set
	 * what players said (ratings) against what they did (rates). Hover a point for its numbers.
	 */
	import { ticks } from './encoding';
	import { shapePath } from './shapes';
	import Tooltip from './Tooltip.svelte';

	interface Props {
		points: ScatterPoint[];
		xDomain: [number, number];
		yDomain: [number, number];
		xLabel: string;
		yLabel: string;
		xFormat?: (v: number) => string;
		yFormat?: (v: number) => string;
		height?: number;
		caption: string;
		/** Words for the low and high ends of the x axis. */
		xEnds?: [string, string];
	}
	let {
		points, xDomain, yDomain, xLabel, yLabel, xFormat = (v) => String(v), yFormat = (v) => String(v),
		height = 280, caption, xEnds
	}: Props = $props();

	let width = $state(0);
	const pad = { l: 46, r: 16, t: 20, b: 48 };
	const W = $derived(Math.max(60, width - pad.l - pad.r));
	const H = $derived(height - pad.t - pad.b);
	const sx = (v: number) => pad.l + ((v - xDomain[0]) / (xDomain[1] - xDomain[0])) * W;
	const sy = (v: number) => pad.t + H - ((v - yDomain[0]) / (yDomain[1] - yDomain[0])) * H;
	const xt = $derived(ticks(xDomain[0], xDomain[1], 6));
	const yt = $derived(ticks(yDomain[0], yDomain[1], 4));
	let hover = $state<ScatterPoint | null>(null);

	function move(e: PointerEvent) {
		const b = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		const mx = e.clientX - b.left, my = e.clientY - b.top;
		let best: ScatterPoint | null = null, bd = 16 * 16;
		for (const p of points) {
			const d = (sx(p.x) - mx) ** 2 + (sy(p.y) - my) ** 2;
			if (d < bd) { bd = d; best = p; }
		}
		hover = best;
	}
</script>

<div class="scatter" bind:clientWidth={width}>
	{#if width > 0}
		<svg {width} {height} role="img" aria-label={caption} onpointermove={move} onpointerleave={() => (hover = null)}>
			{#each yt as t (t)}
				<line x1={pad.l} x2={pad.l + W} y1={sy(t)} y2={sy(t)} stroke="var(--chart-grid)" />
				<text x={pad.l - 8} y={sy(t) + 4} text-anchor="end" class="tick">{yFormat(t)}</text>
			{/each}
			{#each xt as t (t)}
				<line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={pad.t + H} stroke="var(--chart-grid)" />
				<text x={sx(t)} y={pad.t + H + 16} text-anchor="middle" class="tick">{xFormat(t)}</text>
			{/each}
			<text x={pad.l + W / 2} y={height - 6} text-anchor="middle" class="axis-label">{xLabel}</text>
			{#if xEnds}
				<text x={pad.l} y={height - 6} class="end">{xEnds[0]}</text>
				<text x={pad.l + W} y={height - 6} text-anchor="end" class="end">{xEnds[1]}</text>
			{/if}
			<text x={pad.l - 38} y={pad.t - 8} class="axis-label">{yLabel}</text>

			{#each points as p (p.id)}
				<g opacity={p.thin ? 0.5 : 1} class:on={hover?.id === p.id}>
					{#if p.xlo != null && p.xhi != null}
						<line x1={sx(p.xlo)} x2={sx(p.xhi)} y1={sy(p.y)} y2={sy(p.y)} stroke={p.color} stroke-width="1.2" opacity="0.5" />
					{/if}
					{#if p.ylo != null && p.yhi != null}
						<line x1={sx(p.x)} x2={sx(p.x)} y1={sy(p.ylo)} y2={sy(p.yhi)} stroke={p.color} stroke-width="1.2" opacity="0.5" />
					{/if}
					<path
						d={shapePath(p.shape, sx(p.x), sy(p.y), 5.5)}
						fill={p.thin ? 'var(--surface)' : p.color}
						stroke={p.thin ? p.color : 'var(--surface)'}
						stroke-width={p.thin ? 1.6 : 2}
					/>
					<text x={sx(p.x) + 8} y={sy(p.y) - 6} class="lab">{p.label}</text>
				</g>
			{/each}
		</svg>
		{#if hover}
			<Tooltip x={sx(hover.x)} y={sy(hover.y)} {width}>
				<div class="t-title">{hover.label}. {hover.name}</div>
				{#each hover.info as [k, v] (k)}<div class="t-row">{k} <b>{v}</b></div>{/each}
			</Tooltip>
		{/if}
	{/if}
</div>

<style>
	.scatter {
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
	.end {
		fill: var(--ink-faint);
		font-size: 11px;
	}
	.lab {
		fill: var(--ink-dim);
		font-family: var(--font-mono);
		font-size: 11px;
		font-weight: 700;
	}
	.on .lab {
		fill: var(--ink);
	}
</style>
