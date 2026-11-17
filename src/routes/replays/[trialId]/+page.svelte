<script lang="ts">
	/**
	 * Replay player: one trial's recorded moment, redrawn with the real renderer and the cue the
	 * player saw. Playback interpolates between the stored 20 Hz scenes (src/lib/replay/interp.ts),
	 * so motion and cue animation are smooth at any speed, and scrubbing in any direction is exact.
	 * The same moment can be redrawn with any other cue side by side.
	 *
	 * URL: /replays/<trialId>?<list filters>#left=1.20&vs=heartbeat&aids=hl,line,tag
	 *   the query keeps the list's filters (for previous / next), or `run=<run>` when it was opened
	 *   from a run summary (then Previous / Next stay in that run and a link goes back to it); the
	 *   hash keeps the playhead (in seconds left), the comparison cue and the viewing aids.
	 *
	 * Moving to another trial keeps the current one on screen until the next has loaded.
	 */
	import { useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import type { GhostId } from '#lib/game/types.ts';
	import { cueById } from '#lib/game/cues/index.ts';
	import { decodeClip, type EncodedClip, type Marker } from '#lib/telemetry/recorder.ts';
	import { Badge, Button, CueChip, EmptyState, InfoTip, Kbd, LoadState, Page, Segmented, Select, cueListings, slow } from '#lib/ui/index.ts';
	import { WRONG_MAZE_NOTE, clipFitsMaze } from '#lib/replay/layout.ts';
	import { DEFINITIONS } from '#lib/definitions.ts';
	import { notCountedReason } from '#convex/lib/reasons.ts';
	import { participantName } from '#convex/lib/replayDigest.ts';
	import ReplayBoard from '#lib/replay/ReplayBoard.svelte';
	import Timeline from '#lib/replay/Timeline.svelte';
	import { indexAt, sceneAt, stepTime } from '#lib/replay/interp.ts';
	import { targetCache } from '#lib/replay/target.ts';
	import { queryArgs, readState, replayHref, toSearch } from '#lib/replay/list.ts';
	import { OUTCOME_MEANING, OUTCOME_TONE, describe, endTimeOf, ghostName, leftWords, outcomeLabel, signed, ago } from '#lib/replay/story.ts';
	import { deathLabel, modeLabel } from '#lib/outcomes.ts';
	import { summaryHref } from '#lib/study/run.svelte.ts';
	import { RULES_VERSION, isDecision, isLateCatch } from '#convex/lib/rules.ts';

	const id = $derived(page.params.trialId ?? '');
	const trialQ = useQuery(api.trials.get, () => ({ id: id as Id<'trials'> }), { keepPreviousData: true });
	const clipQ = useQuery(api.clips.byTrial, () => ({ trialId: id as Id<'trials'> }), { keepPreviousData: true });
	const seriesQ = useQuery(api.trials.series, () => ({ trialId: id as Id<'trials'> }), { keepPreviousData: true });
	/** The trial on screen: the one asked for, or the previous one until it has loaded. */
	const trial = $derived(trialQ.data ?? null);
	/** Everything for the trial in the address has arrived. */
	const current = $derived(
		!!trial && trial._id === id && !clipQ.isLoading && !seriesQ.isLoading
		&& (clipQ.data == null || clipQ.data.trialId === id)
	);
	const switching = $derived(!!trial && !current && !trialQ.error);
	/** No such trial: the id is unknown, or not a trial id at all. Any other failure is shown as a failure. */
	const badId = $derived(!!trialQ.error && /validator|Invalid ID|not a valid|does not match/i.test(trialQ.error.message ?? ''));
	const missing = $derived(badId || (!trialQ.isLoading && !trialQ.error && trialQ.data === null));
	const wait = slow(() => !trial && !missing && !trialQ.error);

	// The clip belongs to the trial on screen (while switching, the old one's clip stays).
	const decoded = $derived.by(() => {
		const c = clipQ.data;
		if (!c || !trial || c.trialId !== trial._id) return null;
		try { return decodeClip(c as unknown as EncodedClip); } catch { return null; }
	});
	/** The clip was recorded on an earlier version of this maze: never draw it on the current one. */
	const wrongMaze = $derived(!!decoded && !clipFitsMaze(clipQ.data as unknown as { mazeId: string; layout?: string }, decoded.scenes));
	const scenes = $derived(decoded && !wrongMaze ? decoded.scenes : []);

	// ---------- time range and markers ----------
	const startT = $derived(trial?.startedAt ?? 0);
	/** The last moment anything was recorded (the clip, else the 10 Hz series): when a player who left was last seen. */
	const lastSeen = $derived.by(() => {
		if (scenes.length) return scenes[scenes.length - 1].frame.t;
		const s = (current ? seriesQ.data : null) ?? trial?.series ?? null;
		return s && s.t.length && trial ? trial.startedAt + s.t[s.t.length - 1] : undefined;
	});
	/** When the power ended; robust to old rows whose stored end time was wrong. */
	const endT = $derived(trial ? endTimeOf(trial, lastSeen) : 0);
	/**
	 * Where the power clock would reach zero: the end itself when the power ran out, the start plus
	 * the power length when it was cut short (so "power left" stays true up to the cut).
	 */
	const clockEnd = $derived(trial && trial.endReason !== 'expired' ? trial.startedAt + trial.total : endT);
	const expired = $derived(trial?.endReason === 'expired');
	const series = $derived.by(() => {
		const s = (current ? seriesQ.data : null) ?? trial?.series ?? null;
		if (!s || !trial) return null;
		return { t: s.t.map((x) => trial.startedAt + x), dist: s.dist, chasing: s.chasing };
	});
	const t0 = $derived(scenes.length ? scenes[0].frame.t : (series?.t[0] ?? startT));
	const t1 = $derived(scenes.length ? scenes[scenes.length - 1].frame.t : Math.max(series?.t[series.t.length - 1] ?? 0, endT + (expired ? 3 : 0.5)));

	/**
	 * The timeline's markers, rebuilt from the trial (not the copy stored in the clip): the end uses
	 * the robust end time, there is no turn-away when the last chase ended by eating the ghost, and a
	 * death during the power is shown too.
	 */
	const markers: Marker[] = $derived.by(() => {
		if (!trial) return [];
		const m: Marker[] = [{ kind: 'powerStart', t: trial.startedAt, left: trial.total }];
		for (const e of trial.eats) m.push({ kind: 'eat', t: trial.startedAt + e.t, ghost: e.ghost as GhostId, left: e.left });
		const lastEat = trial.eats.length ? trial.eats[trial.eats.length - 1] : null;
		const endedByEat = trial.lastChaseEnd === 'eat' || trial.outcome === 'catch'
			|| (trial.lastChaseEnd == null && lastEat !== null && trial.turnAt !== null && Math.abs(trial.turnAt - lastEat.t) < 0.06);
		if (trial.turnAt !== null && !endedByEat && trial.startedAt + trial.turnAt <= endT + 3.05) {
			m.push({ kind: 'turnAway', t: trial.startedAt + trial.turnAt, left: trial.turnLeft ?? undefined });
		}
		m.push({ kind: 'powerEnd', t: endT, left: trial.leftAtEnd });
		if (trial.endReason === 'died') m.push({ kind: 'death', t: endT, left: trial.leftAtEnd });
		else if (trial.after.died) m.push({ kind: 'death', t: endT + (trial.after.timeToCaught ?? trial.after.seen), ghost: (trial.after.killer ?? undefined) as GhostId | undefined });
		return m.sort((a, b) => a.t - b.t);
	});

	// ---------- playback state ----------
	let time = $state(0);
	let playing = $state(false);
	let speed = $state<0.25 | 0.5 | 1>(1);
	let loop = $state(false);
	let compare = $state(false);
	let vsCue = $state('none');
	let aids = $state({ highlight: false, line: false, tag: false });
	let readyFor = $state('');

	const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Moving to another trial stops playback at once; the playhead is set when its data is in.
	let lastId = '';
	$effect(() => {
		if (id !== lastId) { lastId = id; playing = false; }
	});
	// Start (or restart, when moving to another trial) once its data is in, from the hash if any.
	$effect(() => {
		if (!current || !trial || readyFor === id) return;
		readyFor = id;
		const fromHash = applyHash(trial.cue);
		playing = !fromHash && !reduceMotion && scenes.length > 0;
	});

	/** Reads `#left=..&vs=..&aids=..`; returns true when it set the playhead. */
	let written = '';
	function applyHash(trialCue: string): boolean {
		written = location.hash;
		const h = new URLSearchParams(location.hash.slice(1));
		const at = h.get('left');
		const fromHash = at !== null && Number.isFinite(+at) && t0 <= clockEnd - +at + 0.05 && clockEnd - +at <= t1 + 0.05;
		time = fromHash ? clamp(clockEnd - +at!) : t0;
		vsCue = h.get('vs') ?? (trialCue === 'none' ? 'timer-bar' : 'none');
		compare = h.has('vs');
		const a = (h.get('aids') ?? '').split(',');
		aids = { highlight: a.includes('hl'), line: a.includes('line'), tag: a.includes('tag') };
		return fromHash;
	}
	// A pasted or edited hash on the same page takes effect without a reload.
	function onhash() {
		if (!trial || !current || location.hash === written) return;
		if (applyHash(trial.cue)) playing = false;
	}

	const clamp = (t: number) => Math.min(t1, Math.max(t0, t));

	// Real-time playback: game time advances with the wall clock times the speed.
	$effect(() => {
		if (!playing) return;
		let last = performance.now();
		let raf = requestAnimationFrame(function tick(now) {
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			let t = time + dt * speed;
			if (t >= t1) {
				if (loop) t = t0 + (t - t1);
				else { t = t1; playing = false; }
			}
			time = t;
			if (playing) raf = requestAnimationFrame(tick);
		});
		return () => cancelAnimationFrame(raf);
	});

	// Keep the shareable state in the hash (not while playing: only when it settles), and only for
	// the trial whose playhead it is.
	$effect(() => {
		if (!trial || !current || readyFor !== id || trial._id !== id || playing) return;
		const h = new URLSearchParams();
		h.set('left', (clockEnd - time).toFixed(2));
		if (compare) h.set('vs', vsCue);
		const a = [aids.highlight && 'hl', aids.line && 'line', aids.tag && 'tag'].filter(Boolean);
		if (a.length) h.set('aids', a.join(','));
		const hash = '#' + h.toString();
		const forId = id;
		const url = page.url.pathname + page.url.search + hash;
		const timer = setTimeout(() => {
			if (forId !== id || location.pathname !== `/replays/${forId}`) return;
			written = hash;
			goto(url, { state: page.state, shallow: true, replace: true }).catch(() => {});
		}, 250);
		return () => clearTimeout(timer);
	});

	// ---------- what the playhead shows ----------
	const scene = $derived(scenes.length ? sceneAt(scenes, time) : null);
	const targets = $derived(targetCache(scenes, expired ? endT : null));
	const nearestIndex = (t: number) => {
		const i = indexAt(scenes, t);
		return i + 1 < scenes.length && scenes[i + 1].frame.t - t < t - scenes[i].frame.t ? i + 1 : i;
	};
	const target = $derived(scenes.length ? targets(nearestIndex(time)) : { ghost: -1, dist: null, danger: false });
	const left = $derived(clockEnd - time);

	/** The playhead sits on a marker (its own numbers are then shown, so they match the key numbers). */
	const atMarker = $derived(markers.find((m) => Math.abs(clamp(m.t) - time) < 0.03) ?? null);
	const seriesAt = $derived.by(() => {
		if (!series) return null;
		let best = -1, bd = Infinity;
		for (let i = 0; i < series.t.length; i++) {
			const d = Math.abs(series.t[i] - time);
			if (d < bd) { bd = d; best = i; }
		}
		return best >= 0 && bd < 0.11 ? { dist: series.dist[best], chasing: series.chasing[best] === 1 } : null;
	});
	/** At the "power out" marker the distance is the one the outcome was judged by. */
	const distNow = $derived(
		trial && expired && trial.endDist !== null && Math.abs(time - endT) < 0.06 ? trial.endDist
		: trial && atMarker?.kind === 'turnAway' && trial.turnDist !== null ? trial.turnDist
		: seriesAt?.dist ?? (target.dist ?? null)
	);
	/** Power left as shown: at a marker, the marker's own stored number. */
	const leftShown = $derived(atMarker?.left ?? left);
	const deathT = $derived(markers.find((m) => m.kind === 'death')?.t ?? null);
	const deathWord = $derived(deathLabel(trial?.outcome ?? ''));
	// A clip ends on the frame of the death, which may fall a frame short of the stored death time: the
	// last frames up to it read as the death, so the state and the marker agree.
	const status = $derived(
		deathT !== null && time >= Math.min(deathT, t1) - 0.06 ? { text: deathWord, tone: 'bad' }
		: left > 0 ? (left <= 3 ? { text: 'Last 3 s', tone: 'warn' } : { text: 'Power on', tone: 'accent' })
		: expired ? { text: 'Ghosts dangerous', tone: 'bad' } : { text: 'Power cut short', tone: 'neutral' }
	);

	// The ghost the player was up against at the turn and at the end, for the story.
	const storyGhosts = $derived.by(() => {
		if (!trial || !scenes.length) return {};
		const pick = (t: number | null) => {
			if (t === null) return null;
			const tg = targets(nearestIndex(Math.min(t, endT - 0.05)));
			return tg.ghost >= 0 ? scenes[nearestIndex(t)].frame.ghosts[tg.ghost]?.id ?? null : null;
		};
		return { turnGhost: pick(trial.turnAt === null ? null : trial.startedAt + trial.turnAt), endGhost: pick(endT) };
	});
	const story = $derived(trial ? describe(trial, storyGhosts) : '');

	// ---------- cues ----------
	const cue = $derived(cueById(trial?.cue));
	const vs = $derived(cueById(vsCue));
	const cueOptions = $derived(cueListings().filter((c) => c.ready && c.id !== trial?.cue).map((c) => ({ value: c.id, label: `${c.code} · ${c.name}` })));
	function cycleCue(dir: 1 | -1) {
		const ids = cueOptions.map((o) => o.value);
		const i = ids.indexOf(vsCue as (typeof ids)[number]);
		vsCue = ids[(i + dir + ids.length) % ids.length];
		compare = true;
	}

	// ---------- previous / next: in the run it was opened from, or in the current list ----------
	const runKey = $derived(page.url.searchParams.get('run'));
	const runQ = useQuery(api.runs.block, () => (runKey ? { blockKey: runKey } : 'skip'), { keepPreviousData: true });
	const listState = $derived(readState(page.url.searchParams, trial?.source ?? 'human'));
	const nbQ = useQuery(api.replays.neighbours, () => (runKey || !trial ? 'skip' : { trialId: id as Id<'trials'>, ...queryArgs(listState) }), { keepPreviousData: true });
	const nav = $derived.by(() => {
		if (runKey) {
			const rows = runQ.data?.rows ?? [];
			const i = rows.findIndex((r) => r._id === id);
			const href = (r: (typeof rows)[number] | undefined) => (r ? replayHref(r._id, { run: runKey }) : null);
			const back = runQ.data ? summaryHref(runQ.data.cue, runKey, runQ.data.mode) : null;
			return { prev: i > 0 ? href(rows[i - 1]) : null, next: i >= 0 ? href(rows[i + 1]) : null, pos: i, count: rows.length, list: back, run: true };
		}
		const q = toSearch(listState);
		const n = nbQ.data;
		return {
			prev: n?.prev ? `/replays/${n.prev}${q}` : null, next: n?.next ? `/replays/${n.next}${q}` : null,
			pos: n?.pos ?? -1, count: n?.count ?? 0, list: `/replays${q}`, run: false
		};
	});

	// ---------- transport ----------
	function seek(t: number) { time = clamp(t); }
	let resumeAfterScrub = false;
	function onscrub(t: number, phase: 'start' | 'move' | 'end') {
		if (phase === 'start') { resumeAfterScrub = playing; playing = false; }
		seek(t);
		if (phase === 'end' && resumeAfterScrub) playing = true;
	}
	function toggle() {
		if (!scenes.length) return;
		if (!playing && time >= t1 - 1e-3) time = t0;
		playing = !playing;
	}
	function step(dir: 1 | -1) {
		playing = false;
		seek(scenes.length ? stepTime(scenes, time, dir) : time + dir * 0.1);
	}
	function jump(dir: 1 | -1) {
		playing = false;
		const ts = markers.map((m) => clamp(m.t));
		const t = dir > 0 ? ts.find((x) => x > time + 0.02) : [...ts].reverse().find((x) => x < time - 0.02);
		seek(t ?? (dir > 0 ? t1 : t0));
	}

	function onkey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const el = e.target as HTMLElement;
		if (el.closest('input, select, textarea, [contenteditable]')) return;
		const onButton = el.closest('button, a');
		const k = e.key;
		if ((k === ' ' || k === 'Enter') && onButton) return;
		let done = true;
		if (k === ' ' || k === 'k') toggle();
		else if (k === 'ArrowRight') e.shiftKey ? (playing = false, seek(time + 1)) : step(1);
		else if (k === 'ArrowLeft') e.shiftKey ? (playing = false, seek(time - 1)) : step(-1);
		else if (k === '.' ) jump(1);
		else if (k === ',') jump(-1);
		else if (k === 'Home' || k === '0') { playing = false; seek(t0); }
		else if (k === 'End') { playing = false; seek(t1); }
		else if (k === 'l') loop = !loop;
		else if (k === '1') speed = 0.25;
		else if (k === '2') speed = 0.5;
		else if (k === '3') speed = 1;
		else if (k === 'c') compare = !compare;
		else if (k === ']') cycleCue(1);
		else if (k === '[') cycleCue(-1);
		else if (k === 'h') { const on = !(aids.highlight && aids.line); aids = { ...aids, highlight: on, line: on }; }
		else if (k === 't') aids = { ...aids, tag: !aids.tag };
		else if (k === 'n' && nav.next) goto(nav.next);
		else if (k === 'p' && nav.prev) goto(nav.prev);
		else done = false;
		if (done) e.preventDefault();
	}

	const markerText = (m: Marker) =>
		m.kind === 'eat' ? `Ate ${ghostName(m.ghost) ?? 'ghost'}`
		: m.kind === 'powerStart' ? 'Power on'
		: m.kind === 'turnAway' ? 'Turned away'
		: m.kind === 'death' ? deathWord
		: expired ? 'Power out'
		: trial?.endReason === 'quit' ? 'Run ended'
		: 'Power cut';

	const fmt = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? null : Math.abs(x) < 0.1 && x !== 0 && d === 1 ? x.toFixed(2) : x.toFixed(d));
	const W = $derived(scene?.maze.W ?? 28);
	const H = $derived(scene?.maze.H ?? 31);
	const outcome = $derived((trial?.outcome ?? 'other') as keyof typeof OUTCOME_MEANING);
	const who = $derived(trial?.participant ? participantName(trial.participant) : '-');
	/** This participant's other replays, in their own data source. */
	const whoHref = $derived(trial?.participant ? `/replays?${new URLSearchParams({ ...(trial.source !== 'human' ? { source: trial.source } : {}), p: trial.participant.id })}` : null);
	const notCounted = $derived(trial ? notCountedReason(trial) : null);
	const oldRules = $derived(!!trial && (trial.rulesVersion ?? 1) !== RULES_VERSION);
	const noClipReason = $derived.by(() => {
		if (!trial) return '';
		if (wrongMaze) return `${WRONG_MAZE_NOTE} Its numbers and distance chart are here.`;
		if (trial.outcome === 'interrupted') {
			const why: Record<string, string> = {
				died: 'The player was caught while the power was still on',
				cleared: 'The maze was cleared before the power ran out',
				refreshed: 'A second power dot restarted the power',
				quit: 'The run ended (or the page was left) while the power was on'
			};
			return `${why[trial.endReason] ?? 'The power did not run out by itself'}, so there was no end to record. Its numbers and distance chart are here.`;
		}
		if (!trial.engaged && trial.outcome !== 'caught') {
			return `Only power-ups where the player was chasing in the last 3 s, or was caught, are recorded. This one was "${outcomeLabel(outcome).toLowerCase()}", so only its numbers and distance chart were kept.`;
		}
		if (trial.after.cut === 'quit') return 'The run ended before the 3 s after this power-up were over, so its recording was not kept. Its numbers and distance chart are here.';
		return 'This power-up qualified for a recording, but none was stored (the save did not reach the database). Its numbers and distance chart are here.';
	});
</script>

<svelte:head><title>Replay{trial ? ` · ${outcomeLabel(outcome)} · ${cue.name}` : ''} · Circle Chase</title></svelte:head>
<svelte:window onkeydown={onkey} onhashchange={onhash} />

{#snippet timeline()}
	<section class="tl" aria-label="Timeline">
		<Timeline {t0} {t1} {startT} endT={clockEnd} {expired} {markers} {series} {time} onseek={onscrub} text={markerText} />
		<div class="legend">
			<span class="what">Line: tiles to the nearest scared ghost</span>
			<span><i class="sw chase"></i>Closing in</span>
			<span><i class="sw calm"></i>Not chasing</span>
			<span><i class="sw danger"></i>Ghosts dangerous</span>
			<span><i class="sw ideal"></i>Ideal turn-away (2 to 0.2 s left)</span>
		</div>
		<div class="marks" role="group" aria-label="Jump to a moment">
			{#each markers as m (m.kind + m.t)}
				<button type="button" class="mk {m.kind}" class:at={Math.abs(clamp(m.t) - time) < 0.03} onclick={() => { playing = false; seek(m.t); }}>
					{markerText(m)} <span class="num">{m.t < t0 - 0.06 ? 'before the clip' : leftWords(m.left ?? clockEnd - m.t, 2)}</span>
				</button>
			{/each}
		</div>
	</section>
{/snippet}

<Page width="full" class="replay-page">
	<div class="top">
		<nav class="crumbs" aria-label="Replays">
			{#if nav.run}
				{#if nav.list}<a href={nav.list}>&larr; Back to run summary</a>{:else}<span>&larr; Back to run summary</span>{/if}
				<span aria-hidden="true">&middot;</span>
				<a href="/replays">All replays</a>
			{:else}
				<a href={nav.list}>&larr; All replays</a>
				<span aria-hidden="true">&middot;</span>
				<a href="/dashboard">Dashboard</a>
			{/if}
		</nav>
		{#if trial}
			<div class="headline">
				<h1>
					<span class="o {OUTCOME_TONE[outcome]}">{outcomeLabel(outcome)}</span>
					<span class="with">with</span>
					<CueChip cue={cue} size="md" />
				</h1>
				{#if trial.source === 'bot'}<Badge tone="sim" title="Recorded from a simulated player, not a person">Simulated</Badge>{/if}
				{#if oldRules}<Badge tone="warn" title="Classed by older rules: shown, but left out of the rates">Older rules</Badge>{/if}
				{#if switching}<span class="switching" role="status">Loading the next replay&hellip;</span>{/if}
			</div>
			<div class="prevnext">
				{#if nav.pos >= 0}<span class="pos num">{nav.pos + 1} of {nav.count}{nav.run ? ' in this run' : ''}</span>{/if}
				{#if nav.prev}<Button size="sm" href={nav.prev}>&larr; Previous</Button>{:else}<Button size="sm" disabled>&larr; Previous</Button>{/if}
				{#if nav.next}<Button size="sm" href={nav.next}>Next &rarr;</Button>{:else}<Button size="sm" disabled>Next &rarr;</Button>{/if}
			</div>
		{/if}
	</div>

	{#if missing}
		<EmptyState title="Replay not found" icon="replay">
			There is no trial with this link. It may have been deleted when the data was cleared.
			{#snippet actions()}<Button variant="primary" href="/replays">Browse replays</Button>{/snippet}
		</EmptyState>
	{:else if !trial}
		<LoadState {wait} error={trialQ.error} what="this replay" icon="replay" />
	{:else}
		<div class="player" class:compare class:switching style:--aspect={W / H} style:--n={compare ? 2 : 1}>
			<section class="stage" aria-label="Replay board">
				{#if scene}
					<div class="captions">
						<div class="cap">
							<span class="eyebrow">As played</span>
							<CueChip cue={cue} size="sm" />
						</div>
						{#if compare}
							<div class="cap">
								<label class="eyebrow" for="vs-cue">Redrawn with</label>
								<Select id="vs-cue" size="sm" options={cueOptions} bind:value={vsCue} />
							</div>
						{/if}
					</div>
					<div class="boards">
						<ReplayBoard {scene} {cue} {aids} {target} {left} dist={seriesAt?.dist ?? null} {reduceMotion} label="Replay as the player saw it, with {cue.name}" />
						{#if compare}
							<ReplayBoard {scene} cue={vs} {aids} {target} {left} dist={seriesAt?.dist ?? null} {reduceMotion} label="The same moment redrawn with {vs.name}" />
						{/if}
					</div>
					{#if compare}{@render timeline()}{/if}
				{:else}
					<div class="noclip">
						<EmptyState title={wrongMaze ? 'The board cannot be redrawn' : 'No recording for this trial'} icon="replay">
							{noClipReason}
						</EmptyState>
					</div>
				{/if}
			</section>

			<div class="side">
				<section class="story" aria-label="What happened">
					<p class="meaning"><span class="dot {OUTCOME_TONE[outcome]}"></span>{OUTCOME_MEANING[outcome]}</p>
					<p class="sentence">{story}</p>
				</section>

				<section class="readouts" aria-label="At the playhead" aria-live="off">
					<div class="ro big">
						<span class="lab">{leftShown >= 0 ? 'Power left' : 'Since the end'}</span>
						<span class="val num" class:after={leftShown < 0}>{Math.abs(leftShown).toFixed(2)}<small> s</small></span>
					</div>
					<div class="ro">
						<span class="lab">Distance <InfoTip term="Distance">{DEFINITIONS.distance}{atMarker?.kind === 'turnAway' ? ' At the turn-away marker: to the chased ghost.' : ''}</InfoTip></span>
						<span class="val num">{distNow != null ? distNow.toFixed(1) : '-'}<small> tiles</small></span>
					</div>
					<div class="ro">
						<span class="lab">Chasing <InfoTip term="Chasing">{DEFINITIONS.chasing}</InfoTip></span>
						<span class="val small" class:yes={seriesAt?.chasing}>{seriesAt ? (seriesAt.chasing ? 'Closing in' : 'Not chasing') : '-'}</span>
					</div>
					<div class="ro">
						<span class="lab">State</span>
						<span class="val small tone-{status.tone}">{status.text}</span>
					</div>
				</section>

				<section class="transport" aria-label="Playback">
					<div class="buttons">
						<button type="button" class="tb" onclick={() => { playing = false; seek(t0); }} title="Back to the start (Home)" aria-label="Back to the start">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4v12M16 4l-8 6 8 6z" /></svg>
						</button>
						<button type="button" class="tb" onclick={() => jump(-1)} title="Previous marker (,)" aria-label="Previous marker">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M9 4l-6 6 6 6M17 4l-6 6 6 6" /></svg>
						</button>
						<button type="button" class="tb" onclick={() => step(-1)} title="One frame back (left arrow)" aria-label="One frame back" disabled={!scenes.length}>
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4l-6 6 6 6" /></svg>
						</button>
						<button type="button" class="tb play" onclick={toggle} aria-label={playing ? 'Pause' : 'Play'} title="{playing ? 'Pause' : 'Play'} (space)" disabled={!scenes.length}>
							{#if playing}
								<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4h3v12H6zM11 4h3v12h-3z" class="fill" /></svg>
							{:else}
								<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 4l11 6-11 6z" class="fill" /></svg>
							{/if}
						</button>
						<button type="button" class="tb" onclick={() => step(1)} title="One frame forward (right arrow)" aria-label="One frame forward" disabled={!scenes.length}>
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" /></svg>
						</button>
						<button type="button" class="tb" onclick={() => jump(1)} title="Next marker (.)" aria-label="Next marker">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 4l6 6-6 6M11 4l6 6-6 6" /></svg>
						</button>
						<button type="button" class="tb" class:on={loop} onclick={() => (loop = !loop)} aria-pressed={loop} title="Loop (L)" aria-label="Loop">
							<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 9a5 5 0 0 1 5-5h5l-2-2M16 11a5 5 0 0 1-5 5H6l2 2" /></svg>
						</button>
					</div>
					<Segmented size="sm" label="Speed" options={[{ value: 0.25, label: '0.25x' }, { value: 0.5, label: '0.5x' }, { value: 1, label: '1x' }]} bind:value={speed} />
				</section>

				{#if !compare}{@render timeline()}{/if}

				{#if scenes.length}
				<section class="tools" aria-label="View">
					<div class="tool-row">
						<label class="check strong"><input type="checkbox" bind:checked={compare} disabled={!scenes.length} /> Compare cues <Kbd>C</Kbd></label>
						{#if compare}
							<span class="hint">Same recording, only the cue drawing changes. <Kbd>[</Kbd> <Kbd>]</Kbd> to switch.</span>
						{:else}
							<span class="hint">Redraw this exact moment with another cue, side by side.</span>
						{/if}
					</div>
					<div class="tool-row">
						<span class="eyebrow">Aids</span>
						<label class="check"><input type="checkbox" bind:checked={aids.highlight} /> Highlight player and ghost</label>
						<label class="check"><input type="checkbox" bind:checked={aids.line} /> Line between them</label>
						<label class="check"><input type="checkbox" bind:checked={aids.tag} /> Seconds left tag</label>
					</div>
					<p class="hint">Off by default, so the board is exactly what the player saw.</p>
				</section>
				{/if}

				<section class="numbers" aria-label="Key numbers">
					<h2 class="eyebrow">Key numbers</h2>
					<dl>
						<div><dt>Power length</dt><dd class="num">{fmt(trial.total)} s</dd></div>
						<div><dt>{trial.outcome === 'catch' || trial.lastChaseEnd === 'eat' ? 'Ate the ghost' : 'Turned away'} <InfoTip term="Turn-away time">{DEFINITIONS.turnAway}</InfoTip></dt><dd class="num">{trial.turnLeft === null ? 'never' : signed(trial.turnLeft) + ' s'}</dd></div>
						{#if trial.lastChaseEnd !== 'eat' && trial.outcome !== 'catch'}<div><dt>Distance at the turn</dt><dd class="num">{fmt(trial.turnDist) ?? '-'} {trial.turnDist !== null ? 'tiles' : ''}</dd></div>{/if}
						<div><dt>Distance at the end</dt><dd class="num">{fmt(trial.endDist) ?? '-'} {trial.endDist !== null ? 'tiles' : ''}</dd></div>
							{#if trial.endReason === 'died'}
								<div><dt>{deathWord}</dt><dd class="num bad">while the power was on</dd></div>
							{:else}
								<div><dt>{deathWord} after the end</dt><dd class="num" class:bad={trial.after.died}>{trial.after.died && trial.after.timeToCaught !== null ? fmt(trial.after.timeToCaught) + ' s after' : trial.after.died ? 'yes' : 'no'}</dd></div>
							{/if}
						<div><dt>Ghosts eaten</dt><dd class="num">{trial.eats.length}{isLateCatch(trial) ? ' (late catch)' : ''}</dd></div>
						<div><dt>Closest danger after</dt><dd class="num">{fmt(trial.after.minDangerDist) ?? '-'} {trial.after.minDangerDist !== null ? 'tiles' : ''}{trial.after.nearMiss ? ' (near miss)' : ''}</dd></div>
						<div><dt>Reaction <InfoTip term="Reaction">{DEFINITIONS.reaction}</InfoTip></dt><dd class="num">{trial.reaction !== null ? fmt(trial.reaction, 2) + ' s' : '-'}</dd></div>
						{#if trial.wasted !== null}<div><dt>Power left unused</dt><dd class="num">{fmt(trial.wasted)} s</dd></div>{/if}
							<div class="wide"><dt>Counts in the rates <InfoTip term="Counts in the rates">{DEFINITIONS.counted}</InfoTip></dt><dd>{isDecision(trial) ? 'yes' : `no: ${(notCounted ?? 'not a decision').charAt(0).toLowerCase()}${(notCounted ?? 'not a decision').slice(1)}`}</dd></div>
					</dl>
				</section>

				<section class="context" aria-label="Context">
					<h2 class="eyebrow">Context</h2>
					<dl>
						<div><dt>Participant</dt><dd class="num">{who}{#if whoHref} <a class="more" href={whoHref}>their replays</a>{/if}</dd></div>
						<div><dt>Data</dt><dd>{#if trial.source === 'bot'}<Badge tone="sim">Simulated player</Badge>{:else}Human{/if}</dd></div>
						<div><dt>Condition</dt><dd><CueChip cue={cue} size="sm" /></dd></div>
						<div><dt>Run</dt><dd class="num">{trial.blockIndex + 1} ({modeLabel(trial.mode)})</dd></div>
						<div><dt>Power-up in run</dt><dd class="num">{trial.trialIndex + 1}{trial.block ? ` of ${trial.block.trialCount}` : ''}</dd></div>
						<div><dt>Sound</dt><dd>{trial.sound ? 'on' : 'off'}</dd></div>
						<div><dt>Input</dt><dd>{trial.inputType}</dd></div>
						<div><dt>Recorded</dt><dd title={new Date(trial.createdAt).toLocaleString()}>{ago(trial.createdAt)}</dd></div>
					</dl>
				</section>

				<section class="keys" aria-label="Keyboard shortcuts">
					<h2 class="eyebrow">Keys</h2>
					<ul>
						<li><Kbd>Space</Kbd> play or pause</li>
						<li><Kbd>&larr;</Kbd> <Kbd>&rarr;</Kbd> one frame</li>
						<li><Kbd>Shift</Kbd> + arrows: 1 s</li>
						<li><Kbd>,</Kbd> <Kbd>.</Kbd> previous, next marker</li>
						<li><Kbd>1</Kbd> <Kbd>2</Kbd> <Kbd>3</Kbd> speed</li>
						<li><Kbd>L</Kbd> loop, <Kbd>Home</Kbd> start</li>
						<li><Kbd>C</Kbd> compare, <Kbd>[</Kbd> <Kbd>]</Kbd> cue</li>
						<li><Kbd>H</Kbd> highlight, <Kbd>T</Kbd> time tag</li>
						<li><Kbd>P</Kbd> <Kbd>N</Kbd> previous, next replay</li>
					</ul>
				</section>
			</div>
		</div>
	{/if}
</Page>

<style>
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding: var(--space-3) 0 var(--space-3);
	}
	.crumbs { display: flex; gap: var(--space-2); font-size: var(--text-sm); color: var(--ink-faint); }
	.crumbs a { color: var(--ink-dim); text-decoration: none; }
	.crumbs a:hover { color: var(--ink); text-decoration: underline; }
	.headline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); flex: 1; min-width: 0; }
	h1 {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin: 0;
		font-size: var(--text-lg);
		font-family: var(--font-display);
		font-weight: 600;
	}
	.o.bad { color: var(--bad); }
	.o.good { color: var(--good); }
	.o.warn { color: var(--warn); }
	.with { color: var(--ink-faint); font-family: var(--font-body); font-size: var(--text-md); font-weight: 400; }
	.prevnext { display: flex; align-items: center; gap: var(--space-2); }
	.pos { color: var(--ink-faint); font-size: var(--text-sm); margin-right: var(--space-1); }
	.loading { color: var(--ink-dim); padding: var(--space-6) 0; }
	.switching { color: var(--ink-dim); font-size: var(--text-sm); }
	.player.switching { opacity: 0.6; transition: opacity var(--dur) var(--ease); }

	.player {
		display: grid;
		grid-template-columns: auto minmax(360px, 1fr);
		gap: var(--space-5);
		align-items: start;
		padding-bottom: var(--space-6);
	}
	.stage {
		position: sticky;
		top: calc(var(--bar-h) + var(--space-2));
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		height: calc(100dvh - var(--bar-h) - 84px);
		min-height: 420px;
		width: min(calc((100dvh - var(--bar-h) - 84px - 40px) * var(--aspect) * var(--n)), 64vw);
		min-width: 0;
	}
	/* Two boards: as wide as the column allows, as tall as that makes them (no empty band). */
	.player.compare .stage { height: auto; min-height: 0; width: min(calc((100dvh - var(--bar-h) - 124px) * var(--aspect) * 2), 66vw); }
	.player.compare .boards { flex: none; aspect-ratio: calc(var(--aspect) * 2 + 0.04); }
	.captions { display: flex; gap: var(--space-3); min-height: 32px; }
	.cap { flex: 1; display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
	.cap .eyebrow { white-space: nowrap; }
	.boards {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: repeat(var(--n), minmax(0, 1fr));
		gap: var(--space-3);
	}
	.noclip { display: grid; place-items: center; height: 100%; }

	.side { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; }
	.side > section {
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: var(--space-4);
	}
	.story .meaning { display: flex; gap: var(--space-2); align-items: baseline; margin: 0; color: var(--ink-dim); font-size: var(--text-sm); }
	.story .sentence { margin: var(--space-2) 0 0; font-size: var(--text-lg); line-height: 1.4; }
	.dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--ink-faint); transform: translateY(1px); }
	.dot.bad { background: var(--bad); }
	.dot.good { background: var(--good); }
	.dot.warn { background: var(--warn); }

	.readouts { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: var(--space-3); }
	.ro { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.lab { display: inline-flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 700; }
	.val { font-size: var(--text-xl); font-weight: 600; color: var(--ink); white-space: nowrap; }
	.ro:last-child .val { white-space: normal; }
	.val small { font-size: var(--text-sm); color: var(--ink-dim); font-weight: 400; }
	.ro.big .val { font-size: var(--text-2xl); color: var(--accent); }
	.ro.big .val.after { color: var(--bad); }
	.val.small { font-size: var(--text-md); padding-top: 6px; color: var(--ink-dim); }
	.val.yes { color: var(--accent); }
	.tone-bad { color: var(--bad) !important; }
	.tone-warn { color: var(--warn) !important; }
	.tone-accent { color: var(--accent) !important; }

	.transport { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3) var(--space-4) !important; }
	.buttons { display: flex; gap: 4px; }
	.tb {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule);
		background: var(--surface-2);
		color: var(--ink);
		cursor: pointer;
	}
	.tb:hover:not(:disabled) { background: var(--surface-3); }
	.tb:disabled { opacity: 0.4; cursor: default; }
	.tb:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.tb.play { width: 52px; background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
	.tb.play:hover:not(:disabled) { background: var(--accent); filter: brightness(1.08); }
	.tb.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
	.tb svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.tb svg .fill { fill: currentColor; stroke: none; }

	.tl {
		background: var(--surface);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		padding: var(--space-3) var(--space-3) var(--space-3) var(--space-2) !important;
	}
	.legend { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); padding: var(--space-1) 0 0 40px; font-size: var(--text-xs); color: var(--ink-dim); }
	.legend span { display: inline-flex; align-items: center; gap: 6px; }
	.legend .what { color: var(--ink-faint); }
	.sw { display: inline-block; width: 16px; height: 3px; border-radius: 2px; }
	.sw.chase { background: var(--accent); height: 4px; }
	.sw.calm { background: var(--ink-faint); }
	.sw.danger { background: var(--bad); }
	.sw.ideal { background: var(--good); height: 8px; opacity: 0.6; }
	.marks { display: flex; flex-wrap: wrap; gap: 6px; padding: var(--space-3) 0 0 40px; }
	.mk {
		display: inline-flex;
		gap: 6px;
		align-items: baseline;
		padding: 4px 10px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--rule);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		cursor: pointer;
	}
	.mk .num { color: var(--ink-faint); font-weight: 400; }
	.mk:hover { background: var(--surface-3); }
	.mk.at { border-color: var(--ink); }
	.mk.powerEnd { border-color: var(--rule-strong); }
	.mk.death { color: var(--bad); }
	.mk.turnAway { color: var(--focus); }
	.mk.powerStart { color: var(--accent); }
	.mk.eat { color: var(--good); }

	.tools { display: flex; flex-direction: column; gap: var(--space-2); }
	.tool-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-4); }
	.check { display: inline-flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--ink-dim); cursor: pointer; }
	.check.strong { color: var(--ink); font-weight: 700; font-size: var(--text-md); }
	.check input { accent-color: var(--accent); width: 16px; height: 16px; }
	.hint { margin: 0; font-size: var(--text-xs); color: var(--ink-faint); }

	.numbers dl, .context dl { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--space-3) var(--space-4); margin: var(--space-2) 0 0; }
	dt { display: flex; align-items: center; gap: 4px; font-size: var(--text-xs); color: var(--ink-faint); }
	dd { margin: 2px 0 0; color: var(--ink); }
	dd.bad { color: var(--bad); }
	.numbers .wide { grid-column: 1 / -1; }
	dd .more { margin-left: 6px; font-size: var(--text-xs); }
	h2.eyebrow { margin: 0; }
	.keys ul { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px var(--space-4); font-size: var(--text-sm); color: var(--ink-dim); }

	@media (max-width: 960px) {
		.player { grid-template-columns: minmax(0, 1fr); }
		.stage {
			position: static;
			width: 100%;
			height: auto;
			min-height: 0;
		}
		.boards, .player.compare .boards { flex: none; aspect-ratio: calc(var(--aspect) * var(--n)); gap: var(--space-2); }
		.player.compare .stage { width: 100%; }
		.cap { flex-direction: column; align-items: flex-start; gap: 4px; }
		.readouts { grid-template-columns: 1fr 1fr; }
		.keys { display: none; }
		.headline { flex-basis: 100%; order: -1; }
		.top { padding-top: var(--space-2); }
		.prevnext { margin-left: auto; }
		.numbers dl, .context dl { grid-template-columns: 1fr 1fr; }
	}
	@media (max-width: 960px) and (pointer: fine) {
		.keys { display: block; }
	}
</style>
