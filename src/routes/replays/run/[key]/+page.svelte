<script lang="ts">
	/**
	 * The whole run, from start to end: /replays/run/<blockKey>#t=<seconds>.
	 *
	 * Redrawn from the full-run recording (src/lib/telemetry/runrec.ts) with the real renderer and
	 * the run's cue, like the clip player: the same board, interpolation (interp.ts) and readouts.
	 * The recording is loaded in pages of chunks (one indexed read each, about a minute of play):
	 * first around the playhead, then the rest in the background, so scrubbing anywhere only waits
	 * for that one page. The timeline shows every power-up coloured by its outcome with its moments;
	 * the jump points (two seconds before each power-up's turn-away, or its end when there was none)
	 * are stepped through with , and . or picked from the list beside the board.
	 *
	 * `key` may also be the id of one of the run's trials (the "whole run" link of a replay card); the
	 * address is then rewritten to the block key and the playhead put on that power-up. From a trial's
	 * replay: `#trial=<id>&at=<game time>` opens the run at that moment.
	 */
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '#convex/_generated/api.js';
	import { cueById } from '#lib/game/cues/index.ts';
	import { mazeById } from '#lib/game/engine/mazes.ts';
	import type { Scene } from '#lib/game/types.ts';
	import { decodeChunk, type DecodedChunk } from '#lib/telemetry/runrec.ts';
	import { Badge, Button, CueChip, EmptyState, Kbd, LoadState, Page, Segmented, slow } from '#lib/ui/index.ts';
	import ReplayBoard from '#lib/replay/ReplayBoard.svelte';
	import RunTimeline from '#lib/replay/RunTimeline.svelte';
	import { indexAt, sceneAt, stepTime } from '#lib/replay/interp.ts';
	import { targetOf, type Target } from '#lib/replay/target.ts';
	import { WRONG_MAZE_NOTE } from '#lib/replay/layout.ts';
	import { clock, extraMarks, nextJump, spanAt, spansOf, type Span } from '#lib/replay/runline.ts';
	import { tilesNum, tilesText, ghostName, signed } from '#lib/replay/story.ts';
	import { modeLabel, outcomeColor, outcomeLabel, secs, turnWords } from '#lib/outcomes.ts';
	import { summaryHref } from '#lib/study/run.svelte.ts';

	const PAGE = 12; // chunks per read (convex/runRecordings.ts CHUNK_PAGE)
	const client = useConvexClient();
	const key = $derived(page.params.key ?? '');
	const outlineQ = useQuery(api.runRecordings.outline, () => ({ key }), { keepPreviousData: true });
	const o = $derived(outlineQ.data?.found ? outlineQ.data : null);
	const missing = $derived(!!outlineQ.data && !outlineQ.data.found);
	const wait = slow(() => !outlineQ.data && !outlineQ.error);
	const blockKey = $derived(o?.block.key ?? '');
	const heads = $derived(o?.chunks ?? []);
	const spans: Span[] = $derived(o ? spansOf(o.trials, heads) : []);
	const t0 = $derived(heads[0]?.t0 ?? 0);
	const t1 = $derived(heads.length ? heads[heads.length - 1].t1 : 0);
	const cue = $derived(cueById(o?.block.cue));
	/** Recorded stretches (a refresh leaves a short gap). */
	const recorded = $derived.by(() => {
		const out: [number, number][] = [];
		for (const h of heads) {
			const last = out[out.length - 1];
			if (last && h.t0 - last[1] < 0.2) last[1] = h.t1;
			else out.push([h.t0, h.t1]);
		}
		return out;
	});

	// ---------- loading the recording, a page of chunks at a time ----------
	const cache = new Map<number, DecodedChunk | 'bad'>();
	const busy = new Set<number>();
	let version = $state(0);
	let loadError = $state('');
	let cacheFor = '';

	async function loadPage(p: number) {
		const from = p * PAGE, to = Math.min(heads.length, from + PAGE);
		let first = from;
		while (first < to && cache.has(heads[first].i)) first++;
		if (first >= to || busy.has(p)) return;
		busy.add(p);
		const forKey = blockKey;
		try {
			const rows = await client.query(api.runRecordings.chunks, { blockKey: forKey, from: heads[first].i, to: heads[to - 1].i + 1 });
			if (forKey !== blockKey) return;
			for (const c of rows) {
				try {
					const fits = !c.layout || !mazeById(c.mazeId).layout || mazeById(c.mazeId).layout === c.layout;
					cache.set(c.i, fits ? decodeChunk(c) : 'bad');
				} catch { cache.set(c.i, 'bad'); }
			}
			loadError = '';
			version++;
		} catch (err) {
			loadError = String((err as Error)?.message ?? err).slice(0, 160);
		} finally { busy.delete(p); }
	}
	/** Position of the chunk that holds run time `t` among the run's chunks. */
	function chunkPos(t: number): number {
		let lo = 0, hi = heads.length - 1;
		if (hi < 0) return -1;
		while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (heads[mid].t0 <= t + 1e-6) lo = mid; else hi = mid - 1; }
		return lo;
	}
	// A new run: start over.
	$effect(() => {
		if (blockKey !== cacheFor) { cacheFor = blockKey; cache.clear(); busy.clear(); version++; }
	});
	// The page under the playhead first (and the next one when it is near), then the rest in turn.
	$effect(() => {
		void version;
		if (!blockKey || !heads.length) return;
		const p = Math.floor(Math.max(0, chunkPos(time)) / PAGE);
		loadPage(p);
		if (chunkPos(time) % PAGE >= PAGE - 3) loadPage(p + 1);
		const pages = Math.ceil(heads.length / PAGE);
		for (let q = 0; q < pages; q++) {
			const from = q * PAGE, to = Math.min(heads.length, from + PAGE);
			if (heads.slice(from, to).some((h) => !cache.has(h.i))) { if (!busy.size) loadPage(q); break; }
		}
	});

	/** Every loaded scene in time order, and what loaded so far covers. */
	const loaded = $derived.by(() => {
		void version;
		const scenes: Scene[] = [];
		const ranges: [number, number][] = [];
		const events: { type: string; t: number }[] = [];
		let bad = 0;
		for (const h of heads) {
			const c = cache.get(h.i);
			if (!c) continue;
			if (c === 'bad') { bad++; continue; }
			for (const s of c.scenes) scenes.push(s);
			for (const e of c.events) if (e.type === 'die' || e.type === 'bonus') events.push(e);
			const last = ranges[ranges.length - 1];
			if (last && h.t0 - last[1] < 0.2) last[1] = h.t1;
			else ranges.push([h.t0, h.t1]);
		}
		return { scenes, ranges, events, bad };
	});
	const extras = $derived(extraMarks(loaded.events, spans));
	const allLoaded = $derived.by(() => { void version; return heads.length > 0 && heads.every((h) => cache.has(h.i)); });

	// ---------- playback ----------
	let time = $state(0);
	let playing = $state(false);
	let speed = $state<0.25 | 0.5 | 1 | 2 | 4>(1);
	let aids = $state({ highlight: false, line: false, tag: false });
	let started = '';
	const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const clamp = (t: number) => Math.min(t1, Math.max(t0, t));

	/** The chunk at the playhead is loaded (else the board waits for it). */
	const here = $derived.by(() => {
		void version;
		const p = chunkPos(time);
		const c = p >= 0 ? cache.get(heads[p].i) : undefined;
		return c === undefined ? 'loading' : c === 'bad' ? 'bad' : 'ok';
	});
	const scene = $derived(loaded.scenes.length && here === 'ok' ? sceneAt(loaded.scenes, time) : null);

	// The run is known: canonical address, then the playhead from the hash.
	$effect(() => {
		if (!o || started === o.block.key) return;
		if (key !== o.block.key) {
			const h = location.hash || (o.trialId ? `#trial=${o.trialId}` : '');
			goto(`/replays/run/${o.block.key}${page.url.search}${h}`, { replace: true }).catch(() => {});
			return;
		}
		if (!heads.length) return;
		started = o.block.key;
		applyHash();
	});
	let written = '';
	function applyHash(): boolean {
		written = location.hash;
		const h = new URLSearchParams(location.hash.slice(1));
		const t = Number(h.get('t'));
		const trial = h.get('trial');
		if (h.has('t') && Number.isFinite(t)) { time = clamp(t); playing = false; return true; }
		if (trial) {
			const s = spans.find((x) => x.trial._id === trial);
			if (s) {
				const at = Number(h.get('at'));
				time = clamp(h.has('at') && Number.isFinite(at) ? s.base + at : s.jump);
				playing = false;
				return true;
			}
		}
		time = t0;
		playing = !reduceMotion;
		return false;
	}
	function onhash() { if (o && location.hash !== written) applyHash(); }

	$effect(() => {
		if (!playing) return;
		let last = performance.now();
		let raf = requestAnimationFrame(function tick(now) {
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			// Wait for the recording to arrive rather than run past it.
			if (here === 'loading') { raf = requestAnimationFrame(tick); return; }
			let t = time + dt * speed;
			if (t >= t1) { t = t1; playing = false; }
			time = t;
			if (playing) raf = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(raf);
	});
	// The playhead in the address once it settles.
	$effect(() => {
		if (!o || started !== o.block.key || playing) return;
		const hash = `#t=${time.toFixed(2)}`;
		const url = page.url.pathname + page.url.search + hash;
		const timer = setTimeout(() => {
			if (!location.pathname.startsWith('/replays/run/')) return;
			written = hash;
			goto(url, { state: page.state, shallow: true, replace: true }).catch(() => {});
		}, 250);
		return () => clearTimeout(timer);
	});

	function seek(t: number) { time = clamp(t); }
	let resume = false;
	function onscrub(t: number, phase: 'start' | 'move' | 'end') {
		if (phase === 'start') { resume = playing; playing = false; }
		seek(t);
		if (phase === 'end' && resume) playing = true;
	}
	function toggle() {
		if (!heads.length) return;
		if (!playing && time >= t1 - 1e-3) time = t0;
		playing = !playing;
	}
	function step(dir: 1 | -1) {
		playing = false;
		seek(loaded.scenes.length ? stepTime(loaded.scenes, time, dir) : time + dir * 0.1);
	}
	function jump(dir: 1 | -1) {
		const s = nextJump(spans, time, dir);
		playing = false;
		if (s) seek(s.jump);
		else seek(dir > 0 ? t1 : t0);
	}
	function goTo(s: Span) { playing = false; seek(s.jump); }

	function onkey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const el = e.target as HTMLElement;
		if (el.closest('input, select, textarea, [contenteditable]')) return;
		const k = e.key;
		if ((k === ' ' || k === 'Enter') && el.closest('button, a')) return;
		let done = true;
		if (k === ' ' || k === 'k') toggle();
		else if (k === 'ArrowRight') e.shiftKey ? (playing = false, seek(time + 1)) : step(1);
		else if (k === 'ArrowLeft') e.shiftKey ? (playing = false, seek(time - 1)) : step(-1);
		else if (k === '.' || k === 'n') jump(1);
		else if (k === ',' || k === 'p') jump(-1);
		else if (k === 'Home' || k === '0') { playing = false; seek(t0); }
		else if (k === 'End') { playing = false; seek(t1); }
		else if (k >= '1' && k <= '5') speed = ([0.25, 0.5, 1, 2, 4] as const)[+k - 1];
		else if (k === 'h') { const on = !(aids.highlight && aids.line); aids = { ...aids, highlight: on, line: on }; }
		else if (k === 't') aids = { ...aids, tag: !aids.tag };
		else done = false;
		if (done) e.preventDefault();
	}

	// ---------- what the playhead shows ----------
	const current = $derived(spanAt(spans, time));
	const nearest = $derived.by(() => {
		const sc = loaded.scenes;
		if (!sc.length) return -1;
		const i = indexAt(sc, time);
		return i + 1 < sc.length && sc[i + 1].frame.t - time < time - sc[i].frame.t ? i + 1 : i;
	});
	const targetCacheMap = new Map<string, Target>();
	const target: Target = $derived.by(() => {
		if (nearest < 0 || !scene) return { ghost: -1, dist: null, danger: false };
		const s = loaded.scenes[nearest];
		const endT = current && current.trial.endReason === 'expired' ? current.end : null;
		const k = `${version}:${nearest}:${endT}`;
		let v = targetCacheMap.get(k);
		if (!v) {
			if (targetCacheMap.size > 400) targetCacheMap.clear();
			targetCacheMap.set(k, (v = targetOf(s, endT)));
		}
		return v;
	});
	const left = $derived(scene ? (scene.frame.power.left > 0 ? scene.frame.power.left : current ? current.end - time : 0) : 0);
	const f = $derived(scene?.frame ?? null);
	const W = $derived(scene?.maze.W ?? 25);
	const H = $derived(scene?.maze.H ?? 25);

	/** The detailed replay of a power-up, at the playhead when it is inside that power-up's clip. */
	function detailHref(s: Span, at?: number): string {
		const t = s.trial;
		const clockEnd = t.endReason === 'expired' ? t.endedAt : t.startedAt + t.total;
		const g = (at ?? s.key) - s.base;
		return `/replays/${t._id}?run=${encodeURIComponent(blockKey)}#left=${(clockEnd - g).toFixed(2)}`;
	}
	/** Power left when the player turned away (or ate the ghost), short. */
	const turnText = (s: Span) => (s.trial.outcome === 'interrupted' || s.trial.turnLeft === null ? '-' : `${signed(s.trial.turnLeft, s.trial.turnLeft !== 0 && Math.abs(s.trial.turnLeft) < 0.1 ? 2 : 1)} s`);
	const turnTitle = (s: Span) => (s.trial.outcome === 'interrupted' ? 'Cut short' : s.trial.turnLeft === null ? 'Never turned away' : turnWords(s.trial.outcome, s.trial.turnLeft, s.trial.lastChaseEnd) ?? '');
	const distOf = (s: Span) => (s.keyKind === 'turnAway' ? s.trial.turnDist : s.trial.endDist);
	const site = import.meta.env.PUBLIC_CONVEX_SITE_URL ?? 'http://127.0.0.1:3211';
	const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
	const bytes = $derived(heads.reduce((a, h) => a + h.bytes, 0));
</script>

<svelte:head><title>Whole run{o ? ` · ${cue.name}` : ''} · Circle Chase</title></svelte:head>
<svelte:window onkeydown={onkey} onhashchange={onhash} />

<Page width="full" class="run-replay">
	<div class="top">
		<nav class="crumbs" aria-label="Replays">
			{#if o}<a href={summaryHref(o.block.cue, blockKey, o.block.mode)}>&larr; Run summary</a><span aria-hidden="true">&middot;</span>{/if}
			<a href="/replays?view=runs">Whole runs</a>
			<span aria-hidden="true">&middot;</span>
			<a href="/replays">All replays</a>
		</nav>
		{#if o}
			<div class="headline">
				<h1>Whole run <span class="with">with</span> <CueChip {cue} size="md" /></h1>
				<span class="meta">{o.block.label} · run {o.block.orderIndex + 1} · {modeLabel(o.block.mode)}</span>
				{#if o.block.source === 'bot'}<Badge tone="sim" title="Recorded from a simulated player, not a person">Simulated</Badge>{/if}
				{#if !o.block.endedAt}<Badge tone="warn" title="The run has not closed: it may still be playing, and the recording grows">Not closed</Badge>{/if}
			</div>
		{/if}
	</div>

	{#if missing}
		<EmptyState title="Run not found" icon="replay" heading="h1">
			There is no run with this link. It may have been deleted when the data was cleared.
			{#snippet actions()}<Button variant="primary" href="/replays?view=runs">Whole runs</Button>{/snippet}
		</EmptyState>
	{:else if !o}
		<LoadState {wait} error={outlineQ.error} what="this run" icon="replay" />
	{:else if !heads.length}
		<EmptyState title="No whole-run recording" icon="replay">
			This run was played before whole runs were recorded, or its recording has not arrived yet. Its power-ups have their own replays in the run summary.
		</EmptyState>
	{:else}
		<div class="player" style:--aspect={W / H}>
			<section class="stage" aria-label="Replay board">
				<div class="board-wrap">
					{#if scene}
						<ReplayBoard {scene} {cue} {aids} {target} {left} {reduceMotion} label="The whole run as the player saw it, with {cue.name}" />
					{:else if here === 'bad'}
						<div class="note"><EmptyState title="The board cannot be redrawn" icon="replay">{WRONG_MAZE_NOTE}</EmptyState></div>
					{:else}
						<div class="note" role="status">{loadError ? `Could not load this part of the run: ${loadError}` : 'Loading this part of the run...'}</div>
					{/if}
				</div>
				<section class="tl" aria-label="Timeline">
					<RunTimeline {t0} {t1} {spans} {extras} loaded={loaded.ranges} {recorded} {time} onseek={onscrub} />
					<div class="legend">
						<span><i class="tk turn"></i>Turned away</span>
						<span><i class="tk end"></i>Power out</span>
						<span><i class="tk eat"></i>Ate a ghost</span>
						<span><i class="tk death"></i>Died</span>
						<span><i class="notch"></i>Jump point</span>
						<span class="dim">{allLoaded ? 'All loaded' : 'Loading the rest in the background'}</span>
					</div>
				</section>
			</section>

			<div class="side">
				<section class="readouts" aria-label="At the playhead" aria-live="off">
					<div class="ro big"><span class="lab">Run time</span><span class="val num">{clock(time - t0)}<small> / {clock(t1 - t0, 0)}</small></span></div>
					<div class="ro"><span class="lab">Power left</span><span class="val num">{f && f.power.left > 0 ? `${f.power.left.toFixed(2)} s` : '-'}</span></div>
					<div class="ro"><span class="lab">Distance</span><span class="val num small">{tilesText(target.dist)}</span><span class="sub">{target.danger ? 'to the nearest dangerous ghost' : 'to the nearest scared ghost'}</span></div>
					<div class="ro"><span class="lab">Score</span><span class="val num small">{f?.score ?? '-'}</span><span class="sub">{f ? `level ${f.level} · ${f.lives} ${f.lives === 1 ? 'life' : 'lives'}` : ''}</span></div>
				</section>

				<section class="transport" aria-label="Playback">
					<div class="buttons">
						<button type="button" class="tb" onclick={() => { playing = false; seek(t0); }} title="Back to the start (Home)" aria-label="Back to the start">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4v12M16 4l-8 6 8 6z" /></svg>
						</button>
						<button type="button" class="tb" onclick={() => jump(-1)} title="Previous moment (,)" aria-label="Previous moment">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 4l-6 6 6 6M17 4l-6 6 6 6" /></svg>
						</button>
						<button type="button" class="tb" onclick={() => step(-1)} title="One frame back (left arrow)" aria-label="One frame back">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4l-6 6 6 6" /></svg>
						</button>
						<button type="button" class="tb play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="{playing ? 'Pause' : 'Play'} (space)">
							{#if playing}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" class="fill" /></svg>
							{:else}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l11 6-11 6z" class="fill" /></svg>{/if}
						</button>
						<button type="button" class="tb" onclick={() => step(1)} title="One frame forward (right arrow)" aria-label="One frame forward">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" /></svg>
						</button>
						<button type="button" class="tb" onclick={() => jump(1)} title="Next moment (.)" aria-label="Next moment">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4l6 6-6 6M11 4l6 6-6 6" /></svg>
						</button>
					</div>
					<Segmented size="sm" label="Speed" options={[{ value: 0.25, label: '0.25x' }, { value: 0.5, label: '0.5x' }, { value: 1, label: '1x' }, { value: 2, label: '2x' }, { value: 4, label: '4x' }]} bind:value={speed} />
				</section>

				{#if current}
					<section class="now" aria-label="This power-up">
						<p>
							<span class="dot" style:background={outcomeColor(current.trial.outcome)}></span>
							<span><strong>Power-up {current.trial.n}:</strong> {outcomeLabel(current.trial.outcome)} <span class="dim">· {secs(current.trial.total)} power</span></span>
						</p>
						<a class="more" href={detailHref(current, time >= current.start && time <= current.until ? time : undefined)}>Detailed replay of this power-up</a>
					</section>
				{/if}

				<section class="moments" aria-label="Moments of this run">
					<h2 class="eyebrow">Moments <span class="dim">{spans.length} power-up{spans.length === 1 ? '' : 's'}</span></h2>
					{#if spans.length}
						<p class="mhead" aria-hidden="true"><span>#</span><span>Outcome</span><span title="Power left when the player turned away or ate the ghost">Left</span><span title="Distance to the ghost at the turn-away, else at the end">Tiles</span><span title="Time in the run of the jump point">At</span></p>
						<ol>
							{#each spans as s (s.trial._id)}
								<li class:at={current?.trial._id === s.trial._id}>
									<button type="button" class="jumpto" onclick={() => goTo(s)} title="Jump to 2 s before the {s.keyKind === 'turnAway' ? 'turn-away' : 'end of the power'}">
										<span class="n num">{s.trial.n}</span>
										<span class="o"><span class="dot" style:background={outcomeColor(s.trial.outcome)}></span>{outcomeLabel(s.trial.outcome)}</span>
										<span class="num turn" title={turnTitle(s)}>{turnText(s)}</span>
										<span class="num d">{tilesNum(distOf(s))}</span>
										<span class="num when">{clock(s.jump - t0, 0)}</span>
									</button>
									<a class="detail" href={detailHref(s)} title="Detailed replay of power-up {s.trial.n}">Replay</a>
								</li>
							{/each}
						</ol>
					{:else}
						<p class="dim">No power-up was measured in this run yet.</p>
					{/if}
				</section>

				<section class="tools" aria-label="View">
					<span class="eyebrow">Aids</span>
					<label class="check"><input type="checkbox" bind:checked={aids.highlight} /> Highlight player and ghost</label>
					<label class="check"><input type="checkbox" bind:checked={aids.line} /> Line between them</label>
					<label class="check"><input type="checkbox" bind:checked={aids.tag} /> Seconds left tag</label>
				</section>

				<section class="context" aria-label="Recording">
					<h2 class="eyebrow">Recording</h2>
					<p class="dim">
						{heads.length} parts of about 5 s, {kb(bytes)} in all{t1 - t0 >= 30 ? ` (${kb(Math.round(bytes / ((t1 - t0) / 60)))} per minute)` : ''}.
						{#if extras.some((x) => x.kind === 'death')}{extras.filter((x) => x.kind === 'death').length} death{extras.filter((x) => x.kind === 'death').length === 1 ? '' : 's'} outside power-ups.{/if}
						{#if current?.trial.after.killer}Caught by {ghostName(current.trial.after.killer)}.{/if}
					</p>
					<p><a href={`${site}/export/run.json?blockKey=${encodeURIComponent(blockKey)}`} download>Download this run as JSON</a> <span class="dim">(scenes, inputs, events)</span></p>
					<ul class="keys">
						<li><Kbd>Space</Kbd> play or pause</li>
						<li><Kbd>,</Kbd> <Kbd>.</Kbd> previous, next moment</li>
						<li><Kbd>&larr;</Kbd> <Kbd>&rarr;</Kbd> one frame, <Kbd>Shift</Kbd> 1 s</li>
						<li><Kbd>1</Kbd>-<Kbd>5</Kbd> speed 0.25x to 4x</li>
					</ul>
				</section>
			</div>
		</div>
	{/if}
</Page>

<style>
	.top { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-5); padding: var(--space-3) 0; }
	.crumbs { display: flex; gap: var(--space-2); font-size: var(--text-sm); color: var(--ink-faint); }
	.crumbs a { color: var(--ink-dim); text-decoration: none; }
	.crumbs a:hover { color: var(--ink); text-decoration: underline; }
	.headline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); flex: 1; min-width: 0; }
	h1 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-lg); font-family: var(--font-display); font-weight: 600; }
	.with { color: var(--ink-faint); font-family: var(--font-body); font-size: var(--text-md); font-weight: 400; }
	.meta { color: var(--ink-dim); font-size: var(--text-sm); }
	.dim { color: var(--ink-faint); }

	.player { display: grid; grid-template-columns: minmax(0, 1fr) minmax(340px, 420px); gap: var(--space-5); align-items: start; padding-bottom: var(--space-6); }
	.stage { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; position: sticky; top: calc(var(--bar-h) + var(--space-2)); }
	.board-wrap { height: calc(100dvh - var(--bar-h) - 210px); min-height: 360px; display: grid; }
	.note { display: grid; place-items: center; color: var(--ink-dim); }
	.tl { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: var(--space-2) var(--space-3); }
	.legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); font-size: var(--text-xs); color: var(--ink-dim); padding-top: 2px; }
	.legend span { display: inline-flex; align-items: center; gap: 6px; }
	.tk { display: inline-block; width: 2px; height: 12px; }
	.tk.turn { background: var(--focus); }
	.tk.end { background: var(--ink); }
	.tk.eat { background: var(--good); }
	.tk.death { background: var(--bad); }
	.notch { display: inline-block; width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-bottom: 5px solid var(--ink-dim); }

	.side { display: flex; flex-direction: column; gap: var(--space-3); min-width: 0; }
	.side > section { background: var(--surface); border: 1px solid var(--rule); border-radius: var(--radius-lg); padding: var(--space-3) var(--space-4); }
	.readouts { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-3); }
	.ro { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.lab { font-size: var(--text-xs); color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
	.val { font-size: var(--text-xl); font-weight: 600; white-space: nowrap; }
	.val.small { font-size: var(--text-md); }
	.val small { font-size: var(--text-sm); color: var(--ink-dim); font-weight: 400; }
	.ro.big .val { color: var(--accent); }
	.sub { font-size: var(--text-xs); color: var(--ink-faint); }

	.transport { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); }
	.buttons { display: flex; gap: 4px; }
	.tb { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--radius-sm); border: 1px solid var(--rule); background: var(--surface-2); color: var(--ink); cursor: pointer; }
	.tb:hover { background: var(--surface-3); }
	.tb:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.tb.play { width: 48px; background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
	.tb svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.tb svg .fill { fill: currentColor; stroke: none; }

	.now p { margin: 0; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
	.now .more { font-size: var(--text-sm); }
	.dot { flex: none; display: inline-block; width: 9px; height: 9px; border-radius: 50%; }

	h2.eyebrow { margin: 0 0 var(--space-2); display: flex; gap: var(--space-2); align-items: baseline; }
	.moments ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
	.moments li { display: flex; align-items: center; gap: 4px; border-radius: var(--radius-sm); }
	.moments li.at { background: var(--accent-soft); }
	.jumpto {
		flex: 1; min-width: 0; display: grid; grid-template-columns: 20px minmax(0, 1fr) 50px 40px 40px; gap: 6px; align-items: center;
		padding: 3px 6px; border: 0; background: none; color: var(--ink); font: inherit; font-size: var(--text-sm); text-align: left; cursor: pointer; border-radius: var(--radius-sm);
	}
	.jumpto:hover { background: var(--surface-2); }
	.jumpto:focus-visible { outline: 2px solid var(--focus); }
	.jumpto .n { color: var(--ink-faint); text-align: right; }
	.jumpto .o { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.jumpto .turn, .jumpto .d, .jumpto .when { text-align: right; color: var(--ink-dim); font-size: var(--text-xs); white-space: nowrap; }
	.detail { font-size: var(--text-xs); padding: 0 6px; width: 48px; }
	.mhead { display: grid; grid-template-columns: 20px minmax(0, 1fr) 50px 40px 40px 52px; gap: 6px; margin: 0 0 2px; padding: 0 6px; font-size: var(--text-xs); color: var(--ink-faint); }
	.mhead span:first-child, .mhead span:nth-child(n + 3) { text-align: right; }

	.tools { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); align-items: center; }
	.check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--ink-dim); cursor: pointer; }
	.check input { accent-color: var(--accent); }
	.context p { margin: 0 0 var(--space-2); font-size: var(--text-sm); }
	.keys { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px var(--space-3); font-size: var(--text-xs); color: var(--ink-dim); }

	@media (max-width: 960px) {
		.player { grid-template-columns: minmax(0, 1fr); }
		.stage { position: static; }
		.board-wrap { height: auto; min-height: 0; aspect-ratio: var(--aspect); }
	}
</style>
