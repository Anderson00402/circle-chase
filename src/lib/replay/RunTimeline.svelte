<script lang="ts">
	/**
	 * The timeline of a whole run: one SVG over the run's time. Each power-up is a band coloured by
	 * its outcome and numbered, with its moment markers (power on, ghosts eaten, the turn-away, the
	 * power running out, a death) as ticks and its jump point as a small notch; deaths outside
	 * power-ups and bonus pickups are marked on the axis; the parts of the recording loaded so far
	 * are shaded; drag anywhere to scrub.
	 */
	import { outcomeColor, outcomeLabel } from '../outcomes';
	import { clock, type ExtraMark, type Span } from './runline';

	interface Props {
		t0: number;
		t1: number;
		spans: Span[];
		extras: ExtraMark[];
		/** Run-time ranges whose scenes are loaded. */
		loaded: [number, number][];
		/** Run-time ranges that are recorded (gaps: a refresh, a lost chunk). */
		recorded: [number, number][];
		time: number;
		onseek: (t: number, phase: 'start' | 'move' | 'end') => void;
	}
	let { t0, t1, spans, extras, loaded, recorded, time, onseek }: Props = $props();

	let width = $state(0);
	let holder: HTMLDivElement;
	$effect(() => {
		const ro = new ResizeObserver(([e]) => (width = e.contentRect.width));
		ro.observe(holder);
		return () => ro.disconnect();
	});

	const PAD = 10, NUM = 16, BAND_Y = NUM + 4, BAND_H = 30, AXIS_Y = BAND_Y + BAND_H + 6, H = AXIS_Y + 26;
	const span = $derived(Math.max(1, t1 - t0));
	const inner = $derived(Math.max(10, width - PAD * 2));
	const X = (t: number) => PAD + ((Math.min(t1, Math.max(t0, t)) - t0) / span) * inner;
	const toT = (x: number) => t0 + Math.min(1, Math.max(0, (x - PAD) / inner)) * span;
	const ticks = $derived.by(() => {
		const steps = [5, 10, 15, 30, 60, 120, 300];
		const step = steps.find((s) => (s / span) * inner >= 70) ?? 600;
		const out: number[] = [];
		for (let t = Math.ceil(t0 / step) * step; t <= t1 + 1e-6; t += step) out.push(t);
		return out;
	});
	const MARK: Record<string, string> = { powerStart: 'var(--accent)', eat: 'var(--good)', turnAway: 'var(--focus)', powerEnd: 'var(--ink)', death: 'var(--bad)' };

	let dragging = false;
	function at(e: PointerEvent) {
		const r = (e.currentTarget as SVGElement).getBoundingClientRect();
		return toT(e.clientX - r.left);
	}
	function down(e: PointerEvent) {
		dragging = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		onseek(at(e), 'start');
	}
	function move(e: PointerEvent) { if (dragging) onseek(at(e), 'move'); }
	function up(e: PointerEvent) { if (!dragging) return; dragging = false; onseek(at(e), 'end'); }
	function key(e: KeyboardEvent) {
		const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!d) return;
		e.preventDefault();
		e.stopPropagation();
		onseek(time + d * (e.shiftKey ? 10 : 1), 'end');
	}
</script>

<div class="rtl" bind:this={holder}>
	{#if width}
		<svg
			width={width} height={H} role="slider" tabindex="0" aria-label="Run timeline" aria-valuemin={t0} aria-valuemax={t1} aria-valuenow={time}
			aria-valuetext={clock(time - t0)} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onkeydown={key}
		>
			<rect class="track" x={PAD} y={BAND_Y} width={inner} height={BAND_H} rx="4" />
			{#each recorded as [a, b] (a)}
				<rect class="rec" x={X(a)} y={BAND_Y + BAND_H - 4} width={Math.max(1, X(b) - X(a))} height="4" />
			{/each}
			{#each loaded as [a, b] (a)}
				<rect class="loaded" x={X(a)} y={BAND_Y + BAND_H - 4} width={Math.max(1, X(b) - X(a))} height="4" />
			{/each}
			{#each spans as s (s.trial._id)}
				{@const x = X(s.start)}
				{@const w = Math.max(3, X(s.until) - x)}
				<g class="span" class:now={time >= s.start && time <= s.until}>
					<title>Power-up {s.trial.n}: {outcomeLabel(s.trial.outcome)} ({clock(s.start - t0, 0)})</title>
					<rect x={x} y={BAND_Y} width={Math.max(2, X(s.end) - x)} height={BAND_H - 4} rx="3" fill={outcomeColor(s.trial.outcome)} opacity="0.85" />
					<rect x={X(s.end)} y={BAND_Y} width={Math.max(0, w - (X(s.end) - x))} height={BAND_H - 4} rx="2" fill={outcomeColor(s.trial.outcome)} opacity="0.3" />
					{#if w > 12}<text class="n" x={x + 1} y={NUM - 3}>{s.trial.n}</text>{/if}
					{#each s.markers as m (m.kind + m.t)}
						<line x1={X(m.t)} x2={X(m.t)} y1={BAND_Y - 3} y2={BAND_Y + BAND_H - 4} stroke={MARK[m.kind]} stroke-width={m.kind === 'turnAway' || m.kind === 'death' ? 2 : 1.25} />
					{/each}
					<path class="jump" d="M{X(s.jump) - 4},{BAND_Y + BAND_H + 1} l4,-5 l4,5 z" />
				</g>
			{/each}
			{#each extras as e (e.kind + e.t)}
				{#if e.kind === 'death'}
					<g class="x"><title>Died ({clock(e.t - t0)})</title><path d="M{X(e.t) - 4},{AXIS_Y + 1} l8,8 M{X(e.t) + 4},{AXIS_Y + 1} l-8,8" /></g>
				{:else}
					<g class="bonus"><title>Bonus item ({clock(e.t - t0)})</title><path d="M{X(e.t)},{AXIS_Y} l4,4 l-4,4 l-4,-4 z" /></g>
				{/if}
			{/each}
			{#each ticks as t (t)}
				<line class="tick" x1={X(t)} x2={X(t)} y1={AXIS_Y + 10} y2={AXIS_Y + 13} />
				<text class="lab" x={X(t)} y={AXIS_Y + 24} text-anchor="middle">{clock(t - t0, 0)}</text>
			{/each}
			<line class="head" x1={X(time)} x2={X(time)} y1="2" y2={AXIS_Y + 12} />
			<circle class="head-dot" cx={X(time)} cy={AXIS_Y + 12} r="4" />
		</svg>
	{/if}
</div>

<style>
	.rtl { width: 100%; min-width: 0; user-select: none; touch-action: none; }
	svg { display: block; cursor: pointer; }
	svg:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px; }
	.track { fill: var(--surface-2); stroke: var(--rule); }
	.rec { fill: var(--rule-strong); }
	.loaded { fill: var(--ink-faint); }
	.n { font-size: 11px; font-weight: 700; fill: var(--ink-dim); font-variant-numeric: tabular-nums; }
	.span.now .n { fill: var(--ink); }
	.jump { fill: var(--ink-dim); }
	.span.now .jump { fill: var(--ink); }
	.x path { stroke: var(--bad); stroke-width: 2; fill: none; }
	.bonus path { fill: var(--warn); }
	.tick { stroke: var(--ink-faint); }
	.lab { font-size: 11px; fill: var(--ink-faint); font-variant-numeric: tabular-nums; }
	.head { stroke: var(--ink); stroke-width: 2; }
	.head-dot { fill: var(--ink); }
</style>
