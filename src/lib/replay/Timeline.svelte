<script lang="ts">
	/**
	 * The timeline that explains a moment. One SVG, one time axis in "seconds left" (negative after
	 * the end), and on it:
	 *   - markers: power on, each ghost eaten, the turn-away, the power running out, the death;
	 *   - shaded spans: the warning window (last 3 s), the ideal turn-away window (2 to 0.2 s left),
	 *     and the seconds after the end, when the ghosts are dangerous again;
	 *   - the distance to the nearest scared ghost over time (thick where the player was closing in,
	 *     red after the end, when those ghosts hunt the player);
	 *   - the playhead, which you drag to scrub.
	 */
	import type { Marker } from '#lib/telemetry/recorder.ts';
	import { ghostName, signed } from './story';

	interface Props {
		/** Axis range in game time. */
		t0: number;
		t1: number;
		/** Game time the power started and ended. */
		startT: number;
		endT: number;
		/** The power ran out by itself (otherwise the end is a cut, not a switch). */
		expired: boolean;
		markers: Marker[];
		/** Distance series in game time. */
		series: { t: number[]; dist: (number | null)[]; chasing: number[] } | null;
		time: number;
		onseek: (t: number, phase: 'start' | 'move' | 'end') => void;
		/** The words for each marker, so the flags say the same as the page's buttons ("Died" vs "Caught", "Run ended"). */
		text?: (m: Marker) => string;
	}
	let { t0, t1, startT, endT, expired, markers, series, time, onseek, text: say }: Props = $props();

	let width = $state(0);
	let holder: HTMLDivElement;
	$effect(() => {
		const ro = new ResizeObserver(([e]) => (width = e.contentRect.width));
		ro.observe(holder);
		return () => ro.disconnect();
	});

	const PAD_L = 40, PAD_R = 14, LANE = 18, TOP = LANE * 2 + 8, CHART_H = 128, AXIS = 30;
	const HEIGHT = TOP + CHART_H + AXIS;
	const span = $derived(Math.max(0.1, t1 - t0));
	const innerW = $derived(Math.max(10, width - PAD_L - PAD_R));
	const X = (t: number) => PAD_L + ((t - t0) / span) * innerW;
	const clampX = (t: number) => X(Math.min(t1, Math.max(t0, t)));
	const toT = (x: number) => Math.min(t1, Math.max(t0, t0 + ((x - PAD_L) / innerW) * span));

	// Distance scale: at least 6 tiles, rounded up to an even number.
	const maxD = $derived.by(() => {
		let m = 6;
		if (series) for (let i = 0; i < series.t.length; i++) {
			const d = series.dist[i];
			if (d !== null && series.t[i] >= t0 - 0.2 && series.t[i] <= t1 + 0.2) m = Math.max(m, d);
		}
		return Math.min(24, Math.ceil(m / 2) * 2);
	});
	const Y = (d: number) => TOP + CHART_H - (Math.min(d, maxD) / maxD) * (CHART_H - 8);

	// Line runs with one style each: chasing during the power, not chasing, after the end.
	type Style = 'chase' | 'calm' | 'danger';
	const runs = $derived.by(() => {
		const out: { style: Style; d: string }[] = [];
		if (!series || !width) return out;
		let cur: { style: Style; pts: string[] } | null = null;
		let prev: string | null = null;
		for (let i = 0; i < series.t.length; i++) {
			const t = series.t[i], d = series.dist[i];
			if (t < t0 - 0.11 || t > t1 + 0.11) continue;
			if (d === null) { if (cur) out.push({ style: cur.style, d: 'M' + cur.pts.join('L') }); cur = null; prev = null; continue; }
			const style: Style = t > endT + 1e-6 ? 'danger' : series.chasing[i] ? 'chase' : 'calm';
			const pt = `${X(t).toFixed(1)},${Y(d).toFixed(1)}`;
			if (!cur || cur.style !== style) {
				if (cur) out.push({ style: cur.style, d: 'M' + cur.pts.join('L') });
				cur = { style, pts: prev ? [prev, pt] : [pt] };
			} else cur.pts.push(pt);
			prev = pt;
		}
		if (cur) out.push({ style: cur.style, d: 'M' + cur.pts.join('L') });
		return out;
	});

	// Ticks: whole seconds left.
	const ticks = $derived.by(() => {
		const out: { x: number; label: string; zero: boolean }[] = [];
		const hi = Math.floor(endT - t0), lo = Math.ceil(endT - t1);
		const step = innerW / span < 34 ? 2 : 1;
		for (let L = hi; L >= lo; L--) {
			if (L % step) continue;
			out.push({ x: X(endT - L), label: L === 0 ? '0' : signed(L, 0), zero: L === 0 });
		}
		return out;
	});

	const LABEL: Record<Marker['kind'], string> = {
		powerStart: 'Power on', eat: 'Ate', turnAway: 'Turned away', powerEnd: 'Power out', death: 'Caught'
	};
	const COLOR: Record<Marker['kind'], string> = {
		powerStart: 'var(--accent)', eat: 'var(--scared)', turnAway: 'var(--focus)', powerEnd: 'var(--ink)', death: 'var(--bad)'
	};
	const GHOST_COLOR: Record<string, string> = { hunter: 'var(--hunter)', ambusher: 'var(--ambusher)', guard: 'var(--guard)', drifter: 'var(--drifter)' };

	// Marker labels in two lanes, so neighbours do not overlap.
	const flags = $derived.by(() => {
		if (!width) return [];
		const ends = [-Infinity, -Infinity];
		return markers.map((m) => {
			const before = m.t < t0 - 0.06;
			const text = m.kind === 'powerStart' && before ? `← Power on ${(t0 - m.t).toFixed(1)} s earlier`
				: say ? say(m)
				: m.kind === 'eat' ? `Ate ${ghostName(m.ghost) ?? 'ghost'}`
				: m.kind === 'powerEnd' && !expired ? 'Power cut'
				: m.kind === 'powerStart' && before ? `← Power on ${(t0 - m.t).toFixed(1)} s earlier`
				: LABEL[m.kind];
			const x = clampX(m.t);
			const w = text.length * 6.6 + 10;
			let lx = Math.min(Math.max(x - 4, 2), width - w - 2);
			if (before) lx = PAD_L;
			let lane = ends.findIndex((e) => lx > e + 4);
			if (lane < 0) lane = ends[0] <= ends[1] ? 0 : 1;
			ends[lane] = lx + w;
			const color = m.kind === 'eat' && m.ghost ? (GHOST_COLOR[m.ghost] ?? COLOR.eat) : COLOR[m.kind];
			return { m, x, lx, lane, text, color, before };
		});
	});

	const playX = $derived(clampX(time));
	const left = $derived(endT - time);

	// Dragging.
	let dragging = false;
	function at(e: PointerEvent) {
		const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
		return toT(e.clientX - r.left);
	}
	function down(e: PointerEvent) {
		if (e.button !== 0) return;
		dragging = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		onseek(at(e), 'start');
	}
	function move(e: PointerEvent) { if (dragging) onseek(at(e), 'move'); }
	function up(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		onseek(at(e), 'end');
	}

	const bandX = (a: number, b: number) => {
		const xa = clampX(Math.min(a, b)), xb = clampX(Math.max(a, b));
		return { x: xa, w: Math.max(0, xb - xa) };
	};
	const warn = $derived(bandX(endT - 3, endT));
	const ideal = $derived(bandX(endT - 2, endT - 0.2));
	const after = $derived(bandX(endT, t1));
	const power = $derived(bandX(startT, endT));
</script>

<div
	class="timeline"
	bind:this={holder}
	role="slider"
	tabindex="0"
	aria-label="Playhead. Drag, or use the arrow keys."
	aria-valuemin={Math.round((endT - t0) * 100) / 100}
	aria-valuemax={Math.round((endT - t1) * 100) / 100}
	aria-valuenow={Math.round(left * 100) / 100}
	aria-valuetext={left >= 0 ? `${left.toFixed(2)} seconds left` : `${(-left).toFixed(2)} seconds after the end`}
>
	{#if width}
		<svg
			{width}
			height={HEIGHT}
			viewBox="0 0 {width} {HEIGHT}"
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
			aria-hidden="true"
		>
			<!-- spans -->
			<rect x={power.x} y={TOP} width={power.w} height={CHART_H} class="band power" />
			<rect x={warn.x} y={TOP} width={warn.w} height={CHART_H} class="band warn" />
			<rect x={ideal.x} y={TOP + CHART_H - 10} width={ideal.w} height={10} class="band ideal" />
			<rect x={ideal.x} y={TOP} width={ideal.w} height={CHART_H} class="band ideal-soft" />
			{#if expired}<rect x={after.x} y={TOP} width={after.w} height={CHART_H} class="band after" />{/if}
			{#if warn.w > 70}<text x={warn.x + 4} y={TOP + 12} class="band-label warn-l">Last 3 s</text>{/if}
			{#if ideal.w > 60}<text x={ideal.x + 4} y={TOP + 26} class="band-label ideal-l">Ideal turn-away</text>{/if}
			{#if expired && after.w > 90}<text x={after.x + 4} y={TOP + 12} class="band-label after-l">Ghosts dangerous</text>{/if}

			<!-- distance scale -->
			{#each [0, maxD / 2, maxD] as d (d)}
				<line x1={PAD_L} x2={width - PAD_R} y1={Y(d)} y2={Y(d)} class="grid" />
				<text x={PAD_L - 6} y={Y(d) + 4} class="ylab">{d}</text>
			{/each}

			<!-- marker lines -->
			{#each flags as f (f.m.kind + f.m.t)}
				{#if !f.before}
					<line x1={f.x} x2={f.x} y1={4 + f.lane * LANE + LANE - 2} y2={TOP + CHART_H} class="mline" class:strong={f.m.kind === 'powerEnd'} style:stroke={f.color} />
				{/if}
			{/each}

			<!-- distance line -->
			{#each runs as r, i (i)}
				<path d={r.d} class="dist {r.style}" />
			{/each}
			{#if !series}
				<text x={PAD_L + innerW / 2} y={TOP + CHART_H / 2} class="nodata">No distance data for this trial</text>
			{/if}

			<!-- marker labels -->
			{#each flags as f (f.m.kind + f.m.t + 'l')}
				<g transform="translate({f.lx} {4 + f.lane * LANE})">
					<rect width={f.text.length * 6.6 + 10} height={LANE - 3} rx="4" class="flag" style:stroke={f.color} />
					<text x="5" y={LANE - 7} class="flag-t" style:fill={f.color}>{f.text}</text>
				</g>
			{/each}

			<!-- axis -->
			<line x1={PAD_L} x2={width - PAD_R} y1={TOP + CHART_H} y2={TOP + CHART_H} class="axis" />
			{#each ticks as tk (tk.label)}
				<line x1={tk.x} x2={tk.x} y1={TOP + CHART_H} y2={TOP + CHART_H + 5} class="axis" />
				<text x={tk.x} y={TOP + CHART_H + 18} class="xlab" class:zero={tk.zero}>{tk.label}</text>
			{/each}
			<text x={4} y={TOP + CHART_H + 18} class="ytitle">s left</text>

			<!-- playhead -->
			<line x1={playX} x2={playX} y1={TOP - 4} y2={TOP + CHART_H + 4} class="play" />
			<circle cx={playX} cy={TOP + CHART_H} r="6" class="knob" />
		</svg>
	{/if}
</div>

<style>
	.timeline {
		position: relative;
		width: 100%;
		min-width: 0;
		touch-action: none;
		user-select: none;
		cursor: ew-resize;
		border-radius: var(--radius-md);
		outline: none;
	}
	.timeline:focus-visible { box-shadow: 0 0 0 2px var(--focus); }
	svg { display: block; overflow: visible; }
	.band.power { fill: var(--accent); opacity: 0.05; }
	.band.warn { fill: var(--warn); opacity: 0.09; }
	.band.ideal { fill: var(--good); opacity: 0.55; }
	.band.ideal-soft { fill: var(--good); opacity: 0.08; }
	.band.after { fill: var(--bad); opacity: 0.08; }
	.band-label { font: 600 11px var(--font-body); }
	.warn-l { fill: var(--warn); }
	.ideal-l { fill: var(--good); }
	.after-l { fill: var(--bad); }
	.grid { stroke: var(--rule); stroke-width: 1; stroke-dasharray: 2 4; }
	.axis { stroke: var(--rule-strong); stroke-width: 1; }
	.ylab { fill: var(--ink-faint); font: 11px var(--font-mono); text-anchor: end; }
	.ytitle { fill: var(--ink-faint); font: 11px var(--font-body); }
	.xlab { fill: var(--ink-dim); font: 11px var(--font-mono); text-anchor: middle; }
	.xlab.zero { fill: var(--ink); font-weight: 700; }
	.mline { stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.75; }
	.mline.strong { stroke-width: 2; stroke-dasharray: none; opacity: 0.9; }
	.flag { fill: var(--bg); stroke-width: 1; }
	.flag-t { font: 600 11px var(--font-body); }
	.dist { fill: none; stroke-linecap: round; stroke-linejoin: round; }
	.dist.chase { stroke: var(--accent); stroke-width: 3; }
	.dist.calm { stroke: var(--scared); stroke-width: 1.75; opacity: 0.75; }
	.dist.danger { stroke: var(--bad); stroke-width: 2.25; }
	.nodata { fill: var(--ink-faint); font: 12px var(--font-body); text-anchor: middle; }
	.play { stroke: var(--ink); stroke-width: 2; }
	.knob { fill: var(--ink); stroke: var(--bg); stroke-width: 2; }
</style>
