<script lang="ts">
	/**
	 * Results dashboard. Top-down: the answer (takeaway and ranking), within people (paired
	 * differences, precision, breakdowns), why (the evidence), explore (one condition, live feed,
	 * participants and data quality, export), and how it is measured. Every number comes from a live
	 * Convex query, so the page moves while someone plays. Human data is the default; simulated data
	 * is a separate, labelled view that shows one simulator run at a time. Filters live in the URL.
	 */
	import '#lib/charts/tokens.css';
	import { tick, untrack } from 'svelte';
	import { useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { afterNavigate, beforeNavigate, goto } from '$app/navigation';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { Badge, Button, EmptyState, InfoTip, Page, PageHeader, Panel, Segmented, Select, slow } from '#lib/ui/index.ts';
	import { MODE_LABEL } from '#lib/outcomes.ts';
	import { ago, plural } from '#lib/charts/encoding.ts';
	import Answer from './Answer.svelte';
	import QueryState from './QueryState.svelte';
	import Takeaway from './Takeaway.svelte';
	import { takeOf } from './rows';
	import { retrier } from './retry.svelte';
	import Detail from './Detail.svelte';
	import Method from './Method.svelte';
	import NowPlaying from './NowPlaying.svelte';
	import Paired from './Paired.svelte';
	import Recent from './Recent.svelte';
	import Sessions from './Sessions.svelte';
	import SimCheck from './SimCheck.svelte';
	import Why from './Why.svelte';
	import { DEFS } from './defs';
	import { inview } from './inview';
	import { LINE_CHECK, LINE_DEFAULT, type DashFilter, type ModeSel, type RowOrder, type RunInfo, type SourceSel } from './types';

	/** The run choice for simulated play outside any simulator run (matches convex/dashboard.ts OTHER_RUN). */
	const OTHER_RUN = 'other';

	// Filter state, read once from the URL and written back on change. Opened without any (from a
	// link elsewhere, the replay page's "Dashboard" say), the page restores the filters it last had.
	const FILTERS_KEY = 'dash-filters';
	const restored = (() => {
		if (page.url.search) return null;
		try {
			const saved = localStorage.getItem(FILTERS_KEY);
			return saved ? new URLSearchParams(saved) : null;
		} catch {
			return null;
		}
	})();
	const q = restored ?? page.url.searchParams;
	const pick = <T extends string>(v: string | null, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
	/**
	 * Human or simulated data. The page writes `?data=bot`; links people type or share may say
	 * `?source=bot`, `?view=simulated`, `?sim`, `?bot`, or only name a simulator run (`?run=...`).
	 */
	const sourceOf = (u: Pick<URLSearchParams, 'get' | 'has'>): SourceSel => {
		const said = (u.get('data') ?? u.get('source') ?? u.get('view') ?? '').trim().toLowerCase();
		if (['bot', 'bots', 'sim', 'sims', 'simulated', 'simulation', 'simulator'].includes(said)) return 'bot';
		if (['human', 'humans', 'people', 'real', 'participants'].includes(said)) return 'human';
		if (u.has('sim') || u.has('bot') || u.has('simulated') || (u.get('run') ?? '') !== '') return 'bot';
		return 'human';
	};
	let source = $state<SourceSel>(sourceOf(q));
	let run = $state<string>(q.get('run') ?? '');
	let mode = $state<ModeSel>(pick(q.get('mode'), ['study', 'arcade', 'both'], 'both'));
	let participant = $state<string>(q.get('p') ?? 'all');
	let period = $state<string>(pick(q.get('period'), ['all', 'today', '7d', '30d'], 'all'));
	let detailCue = $state<string>(q.get('cue') ?? 'timer-bar');
	let order = $state<RowOrder>(pick(q.get('order'), ['rank', 'code'], 'rank'));
	let selected = $state<string | null>(q.get('cue'));
	/** Where "too early" starts: the rules' 2 s, or 2.5 s as a sensitivity check (recomputed, never stored). */
	let line = $state<number>(q.get('line') === String(LINE_CHECK) ? LINE_CHECK : LINE_DEFAULT);
	const altLine = $derived(line === LINE_CHECK ? LINE_CHECK : null);

	/** Start of the period, computed when the period changes (not every render). */
	let from = $state<number | undefined>(undefined);
	$effect(() => {
		const p = period;
		const d = new Date();
		from = untrack(() => p === 'today'
			? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
			: p === '7d' ? Date.now() - 7 * 864e5 : p === '30d' ? Date.now() - 30 * 864e5 : undefined);
	});

	const simulated = $derived(source === 'bot');
	// A minute clock for the run list ("still running" means written to in the last two minutes).
	let minute = $state(Math.floor(Date.now() / 60_000) * 60_000);
	$effect(() => {
		const t = setInterval(() => (minute = Math.floor(Date.now() / 60_000) * 60_000), 30_000);
		return () => clearInterval(t);
	});
	const facets = useQuery(api.dashboard.facets, () => ({
		source, ...(mode !== 'both' ? { mode } : {}), ...(simulated && run ? { run } : {}), ...(simulated ? { now: minute } : {})
	}));
	const runs = $derived<RunInfo[]>(facets.data?.runs ?? []);
	const otherPlay = $derived(facets.data?.other ?? { sessions: 0, trials: 0, lastAt: 0 });
	/** The run shown: the URL's, or by default the newest complete run (else the newest, else other play). */
	const defaultRun = $derived(runs.find((r) => r.complete)?.run ?? runs[0]?.run ?? (otherPlay.trials ? OTHER_RUN : ''));
	/** A run id from an old link that no longer exists (deleted, or another database): fall back, and say so. */
	const missingRun = $derived(simulated && facets.data !== undefined && !!run && run !== OTHER_RUN && !runs.some((r) => r.run === run) ? run : '');
	const activeRun = $derived(simulated ? (run && !missingRun ? run : defaultRun) : '');
	const runInfo = $derived(runs.find((r) => r.run === activeRun) ?? null);

	/** A participant from an old link who is not in this view (or not an id at all): show everyone, and say so. */
	const missingParticipant = $derived(participant !== 'all' && facets.data !== undefined && !facets.data.participants.some((p) => p.id === participant));
	const filter = $derived<DashFilter>({
		source,
		...(activeRun ? { run: activeRun } : {}),
		...(mode !== 'both' ? { mode } : {}),
		...(participant !== 'all' && !missingParticipant ? { participantId: participant as Id<'participants'> } : {}),
		...(from !== undefined ? { from } : {}),
		...(altLine ? { line: altLine } : {})
	});
	/**
	 * Wait for the run and participant lists when the view depends on them, so it never shows every
	 * run pooled for a moment, or asks for a participant who is not there.
	 */
	const ready = $derived((!simulated && participant === 'all') || facets.data !== undefined);

	$effect(() => {
		const u = new URL(page.url.href);
		const set = (k: string, v: string, d: string) => (v === d ? u.searchParams.delete(k) : u.searchParams.set(k, v));
		set('data', source, 'human');
		// Spellings of the source other than `data` (read once at load) give way to the one the page writes.
		for (const k of ['source', 'view', 'sim', 'bot', 'simulated']) u.searchParams.delete(k);
		set('run', activeRun, '');
		set('mode', mode, 'both');
		set('p', participant, 'all');
		set('period', period, 'all');
		set('order', order, 'rank');
		set('line', String(line), String(LINE_DEFAULT));
		if (selected) u.searchParams.set('cue', selected);
		else u.searchParams.delete('cue');
		if (u.search !== untrack(() => page.url.search)) goto(u, { state: {}, shallow: true, replace: true });
		try {
			localStorage.setItem(FILTERS_KEY, u.search);
		} catch {
			/* storage may be off */
		}
	});

	const mainRetry = retrier();
	const main = useQuery(api.dashboard.main, () => (ready && !mainRetry.paused ? filter : 'skip'), { keepPreviousData: true });
	const loadingSlow = slow(() => main.isLoading);

	// A clock for "x s ago" labels and the live strip. Not game time: this is page chrome.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 5000);
		return () => clearInterval(t);
	});

	const counts = $derived(facets.data?.counts);
	const n = (src: 'human' | 'bot', m?: 'study' | 'arcade') =>
		counts ? (m ? counts[src][m] : counts[src].study + counts[src].arcade) : undefined;
	const modeCount = (m: ModeSel) => {
		if (!counts) return undefined;
		if (simulated) return undefined; // per run, not per source: the run label says the size
		return m === 'both' ? n('human') : n('human', m);
	};

	const participantOptions = $derived([
		{ value: 'all', label: 'Everyone' },
		...(facets.data?.participants ?? []).map((p) => ({
			value: p.id,
			label: `P${p.number}${p.nickname ? ` ${p.nickname}` : ''}, ${p.trials}`
		}))
	]);
	const periodOptions = [
		{ value: 'all', label: 'All time' },
		{ value: 'today', label: 'Today' },
		{ value: '7d', label: 'Last 7 days' },
		{ value: '30d', label: 'Last 30 days' }
	];
	const presetWord = (p: string) => (p === 'flat' ? 'Flat' : p === 'planted' ? 'Planted' : p);
	const runOptions = $derived([
		...runs.map((r) => ({
			value: r.run,
			// Short, so it is not cut off on a phone; the banner below gives the power-up count.
			label: `${presetWord(r.preset)}, ${plural(r.sessions, 'player')}, ${ago(r.startedAt, now)}${r.complete ? '' : ' (running)'}`
		})),
		...(otherPlay.trials ? [{ value: OTHER_RUN, label: `Other simulated play, ${plural(otherPlay.trials, 'power-up')}` }] : [])
	]);

	const data = $derived(main.data);
	const empty = $derived(data !== undefined && data.totals.trials === 0);
	const take = $derived(data && !empty ? takeOf(data) : null);

	function select(id: string) {
		selected = id;
		detailCue = id;
		document.getElementById('detail')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
	}

	function setSource(s: SourceSel) {
		source = s;
		participant = 'all';
	}
	function setRun(r: string) {
		run = r;
		participant = 'all';
	}

	// Coming back from a replay: the page loads its data again, so the browser's own scroll restore
	// lands too high. Remember the position per URL and restore it once the results are drawn.
	const scrollKey = () => `dash-scroll:${page.url.search}`;
	let restoreTo = $state<number | null>(null);
	beforeNavigate((nav) => {
		if (nav.to?.url.pathname === page.url.pathname) return;
		try { sessionStorage.setItem(scrollKey(), String(Math.round(scrollY))); } catch { /* storage may be off */ }
	});
	afterNavigate((nav) => {
		if (nav.type !== 'popstate' && nav.type !== 'enter') return;
		try {
			const y = Number(sessionStorage.getItem(scrollKey()));
			if (y > 0) restoreTo = y;
		} catch { /* storage may be off */ }
	});
	$effect(() => {
		if (restoreTo === null || !data) return;
		const y = restoreTo;
		restoreTo = null;
		// Two frames: one for the results to render, one for the panels below them to take their size.
		tick().then(() => requestAnimationFrame(() => requestAnimationFrame(() => scrollTo({ top: y, behavior: 'instant' }))));
	});

	const site = import.meta.env.PUBLIC_CONVEX_SITE_URL ?? 'http://127.0.0.1:3211';
	const exportHref = (file: string) => {
		const p = new URLSearchParams({ source });
		if (filter.run) p.set('run', filter.run);
		if (filter.mode) p.set('mode', filter.mode);
		if (filter.participantId) p.set('participantId', filter.participantId);
		if (filter.from) p.set('from', String(filter.from));
		return `${site}/export/${file}?${p}`;
	};
	const filtersActive = $derived(mode !== 'both' || participant !== 'all' || period !== 'all' || line !== LINE_DEFAULT);
	function clearFilters() {
		mode = 'both';
		participant = 'all';
		period = 'all';
		line = LINE_DEFAULT;
	}

	/** What the downloads hold, in plain words (columns: convex/README.md "trials.csv"). */
	const DOWNLOAD_NOTE =
		'The data in this view (same source, run, rules, participant and period). Power-ups CSV: one row per power-up with every measure. "decision" marks the counted power-ups behind every rate; "outcome" is the stored class, always with "too early" from 2 s, even while the page shows the 2.5 s check; "gaveUpEarly" marks a too-early turn-away that gave a reachable ghost up before the last 3 s (shown on the page as "gave up very early", a part of too early); "turnLeft" and "turnDist" give the time to spare (time left minus distance / 1.5 tiles a second under study rules). JSON: the same with nested fields. Answers CSV: the questionnaire. Runs CSV: one row per run.';

	// Heavy lower sections subscribe only once they come near the screen.
	let showSessions = $state(false);
</script>

<svelte:head><title>Dashboard · Circle Chase</title></svelte:head>

<Page width="wide" class="dash">
	<PageHeader
		eyebrow="Results"
		title="Dashboard"
		lead="Do players know when the power-up is about to run out, and which signal tells them best? Updated live as people play."
	>
		{#snippet actions()}
			<div class="downloads wide-only" role="group" aria-label="Download the data in this view">
				<span class="dl-label">Download <InfoTip term="What the files hold" align="end">{DOWNLOAD_NOTE}</InfoTip></span>
				<Button size="sm" variant="quiet" href={exportHref('trials.csv')}>Power-ups CSV</Button>
				<Button size="sm" variant="quiet" href={exportHref('trials.json')}>JSON</Button>
				<Button size="sm" variant="quiet" href={exportHref('ratings.csv')}>Answers CSV</Button>
				<Button size="sm" variant="quiet" href={exportHref('blocks.csv')}>Runs CSV</Button>
			</div>
		{/snippet}
	</PageHeader>

	<div class="flow">
	<div class="filters" role="group" aria-label="Filters">
		<div class="f">
			<span class="f-label">Data</span>
			<Segmented
				label="Data source"
				size="sm"
				options={[
					{ value: 'human', label: 'Humans', hint: n('human') },
					{ value: 'bot', label: 'Simulated', hint: n('bot') }
				]}
				value={source}
				onchange={(v: SourceSel) => setSource(v)}
			/>
		</div>
		{#if simulated}
			<div class="f run">
				<span class="f-label">Run</span>
				{#if runOptions.length}
					<Select size="sm" options={runOptions} value={activeRun} onchange={(e) => setRun(e.currentTarget.value)} aria-label="Simulator run" />
				{:else}
					<span class="dim">{facets.data ? 'No simulator runs yet' : 'Loading runs…'}</span>
				{/if}
			</div>
		{/if}
		<div class="f">
			<span class="f-label">Rules</span>
			<Segmented
				label="Rules"
				size="sm"
				options={[
					{ value: 'both', label: 'All', hint: modeCount('both') },
					{ value: 'study', label: MODE_LABEL.study, hint: modeCount('study') },
					{ value: 'arcade', label: MODE_LABEL.arcade, hint: modeCount('arcade') }
				]}
				bind:value={mode}
			/>
		</div>
		<div class="f">
			<span class="f-label">Who</span>
			<Select size="sm" options={participantOptions} bind:value={participant} aria-label="Participant" />
		</div>
		<div class="f">
			<span class="f-label">When</span>
			<Select size="sm" options={periodOptions} bind:value={period} aria-label="Period" />
		</div>
		<div class="f">
			<span class="f-label">Too early from</span>
			<Segmented
				label="Where too early starts"
				size="sm"
				options={[
					{ value: String(LINE_DEFAULT), label: `${LINE_DEFAULT} s` },
					{ value: String(LINE_CHECK), label: `${LINE_CHECK} s, check` }
				]}
				value={String(line)}
				onchange={(v: string) => (line = Number(v))}
			/>
			<InfoTip term="Too early from" align="start">{DEFS.line}</InfoTip>
		</div>
		{#if filtersActive}
			<button class="reset" type="button" onclick={clearFilters}>Clear filters</button>
		{/if}
		<nav class="jump" aria-label="Sections">
			<a href="#top-answer">Answer</a><a href="#within">Within people</a><a href="#why">Why</a><a href="#explore">Explore</a><a href="#method">Method</a>
		</nav>
	</div>

	<div class="live">
		<NowPlaying
			lastAt={data?.totals.lastAt ?? null}
			{now}
			source={simulated ? 'bot' : 'human'}
			finished={simulated && activeRun !== OTHER_RUN && !!runInfo?.complete}
			offline={loadingSlow.offline}
		/>
	</div>

	{#if simulated}
		<div class="sim-banner" role="note">
			<Badge tone="sim">Simulated</Badge>
			<p>
				{#if activeRun === OTHER_RUN}
					Simulated play outside any simulator run (bots started by hand or by tests), kept apart from the runs.
				{:else if runInfo}
					One simulator run: {presetWord(runInfo.preset).toLowerCase()}
					{runInfo.preset === 'flat' ? '(every condition given the same awareness)' : '(each condition given its own awareness level)'},
					{plural(runInfo.sessions, 'simulated player')}, {plural(runInfo.trials, 'power-up')}{runInfo.complete ? '' : ', still running'}.
				{/if}
				{DEFS.simulated}
			</p>
			<button type="button" onclick={() => setSource('human')}>Back to humans</button>
			{#if missingRun}
				<p class="missing">The link asked for simulator run "{missingRun}", which is not in this database (deleted, or from another machine). Showing the newest complete run instead.</p>
			{/if}
		</div>
	{/if}

	{#if missingParticipant}
		<p class="missing-p" role="note">
			The link asked for a participant who is not in this view (another data source, or removed). Showing everyone instead.
			<button type="button" onclick={() => (participant = 'all')}>Clear</button>
		</p>
	{/if}

	{#if altLine}
		<div class="line-banner" role="note">
			<p>
				<b>Sensitivity check: "too early" starts at {altLine} s left, not {LINE_DEFAULT} s.</b> Turned away in time now means 0.2 to
				{altLine} s left. Every class, rate and comparison below is worked out again from the stored measures with this line;
				the stored outcomes do not change.
			</p>
			<button type="button" onclick={() => (line = LINE_DEFAULT)}>Back to {LINE_DEFAULT} s</button>
		</div>
	{/if}

	{#if main.error && data}
		<QueryState error={main.error} wait={loadingSlow} what="the latest results (the numbers below are from before)" onretry={mainRetry.retry} />
	{/if}
	{#if !data}
		<QueryState error={main.error} wait={loadingSlow} what="results" onretry={mainRetry.retry} tall />
	{:else if empty}
		<div class="empty">
			<EmptyState icon="chart" title={source === 'human' ? (filtersActive ? 'No human power-ups in this filter' : 'No human power-ups yet') : 'No power-ups in this run or filter'}>
				{#if source === 'human' && !filtersActive}
					Run a case from the run console and results appear here as the participant plays. Until then, the simulated view
					shows how every panel works on {plural(n('bot') ?? 0, 'simulated power-up')}.
				{:else if filtersActive}
					Nothing matches the filters. Clear them to see everything.
				{:else}
					Results appear here as soon as someone plays a power-up.
				{/if}
				{#snippet actions()}
					{#if source === 'human' && (n('bot') ?? 0) > 0 && !filtersActive}
						<Button variant="primary" onclick={() => setSource('bot')}>Show simulated data</Button>
					{/if}
					{#if filtersActive}
						<Button variant="quiet" onclick={clearFilters}>Clear filters</Button>
					{/if}
					{#if source === 'human'}<Button variant="quiet" href="/">Go to the run console</Button>{/if}
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div id="top-answer" class="anchor take-slot">
			<Takeaway take={take!} {simulated} run={runInfo} otherRun={activeRun === OTHER_RUN} {altLine} />
		</div>
		<div class="answer-slot">
			<Answer main={data} {selected} onselect={select}>
				{#snippet uncounted()}
					{#if source === 'human' && data.totals.decisions === 0 && (n('bot') ?? 0) > 0}
						<p class="hint">
							Nothing here counts yet, so there is no answer to show. <button type="button" onclick={() => setSource('bot')}>See the page on simulated data</button>.
						</p>
					{/if}
				{/snippet}
			</Answer>
		</div>

		{#if simulated && activeRun && activeRun !== OTHER_RUN}
			<SimCheck run={activeRun} preset={runInfo?.preset ?? null} line={altLine} filtered={participant !== 'all' || mode !== 'both' || period !== 'all'} />
		{/if}

		{#if data.totals.decisions > 0}
			<div id="within" class="anchor">
				<Paired main={data} {order} {selected} onselect={select} />
			</div>

			<div id="why" class="anchor">
				<Why main={data} {filter} bind:order {selected} onselect={select} />
			</div>
		{:else}
			<p id="within" class="later anchor">
				The comparisons within people and the evidence behind the ranking (turn-away times, approach curves, learning,
				ratings) appear here as soon as power-ups are counted. The live feed and sessions below already show what was recorded.
			</p>
		{/if}

		<section id="explore" class="anchor explore" aria-labelledby="explore-h">
			<header>
				<p class="eyebrow">Explore</p>
				<h2 id="explore-h">One condition, the live feed, and who played</h2>
			</header>
			<div id="detail" class="anchor">
				<Panel title="Condition up close">
					<Detail main={data} {filter} bind:cue={detailCue} {now} />
				</Panel>
			</div>
			<Panel title="Latest power-ups" sub="Updates live. Watch opens the replay of that power-up." flush>
				<Recent {filter} {now} />
			</Panel>
			<div use:inview={() => (showSessions = true)}>
				<Panel title="Participants and sessions" sub="Who played, how much, and how trustworthy the data is. Replays opens that session's power-ups." flush>
					{#if showSessions}
						<Sessions {filter} {now} onparticipant={(id) => (participant = id)} />
					{:else}
						<div class="loading small">Loading sessions…</div>
					{/if}
				</Panel>
			</div>
		</section>
	{/if}

	</div>

	<div class="method-wrap">
		<Method />
	</div>
	<div class="downloads narrow-only" role="group" aria-label="Download the data in this view">
		<span class="dl-label">Download <InfoTip term="What the files hold" align="start">{DOWNLOAD_NOTE}</InfoTip></span>
		<Button size="sm" variant="quiet" href={exportHref('trials.csv')}>Power-ups CSV</Button>
		<Button size="sm" variant="quiet" href={exportHref('trials.json')}>JSON</Button>
		<Button size="sm" variant="quiet" href={exportHref('ratings.csv')}>Answers CSV</Button>
		<Button size="sm" variant="quiet" href={exportHref('blocks.csv')}>Runs CSV</Button>
	</div>
</Page>

<style>
	:global(.dash) {
		/* Charts and chips share one baseline blue on this page (see src/lib/charts/tokens.css). */
		--role-baseline: var(--chart-baseline);
	}
	.downloads {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 2px var(--space-1);
	}
	.dl-label {
		margin-right: var(--space-1);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.filters {
		position: sticky;
		top: 0;
		z-index: 30;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		margin: calc(-1 * var(--space-3)) calc(-1 * var(--space-3)) 0;
		padding: var(--space-3);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(10px);
	}
	.f {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}
	.f.run :global(select) {
		max-width: min(330px, 70vw);
	}
	.f-label {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.dim {
		color: var(--ink-faint);
		font-size: var(--text-sm);
	}
	.reset {
		padding: 0;
		border: 0;
		background: none;
		color: var(--focus);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.jump {
		display: flex;
		gap: var(--space-4);
		margin-left: auto;
		font-size: var(--text-sm);
	}
	.jump a {
		color: var(--ink-dim);
		text-decoration: none;
	}
	.jump a:hover {
		color: var(--ink);
		text-decoration: underline;
	}
	.live {
		margin: var(--space-3) 0 var(--space-5);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		background: var(--surface);
	}
	.sim-banner {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-3) var(--space-4);
		border: 1px dashed color-mix(in srgb, var(--sim) 60%, transparent);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--sim) 8%, transparent);
	}
	.sim-banner p {
		flex: 1 1 320px;
		color: var(--ink);
		font-size: var(--text-sm);
	}
	.sim-banner p.missing {
		flex-basis: 100%;
		color: var(--ink-dim);
	}
	.line-banner {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--warn);
		border-radius: var(--radius-md);
		background: color-mix(in srgb, var(--warn) 8%, transparent);
	}
	.line-banner p {
		flex: 1 1 320px;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.line-banner b {
		color: var(--ink);
	}
	.line-banner button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--focus);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.missing-p {
		margin-bottom: var(--space-4);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.missing-p button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--focus);
		font: inherit;
		cursor: pointer;
	}
	.take-slot {
		margin-bottom: var(--space-5);
	}
	.narrow-only {
		display: none;
	}
	.sim-banner button,
	.hint button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--focus);
		font: inherit;
		cursor: pointer;
	}
	.hint {
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.later {
		max-width: 80ch;
		margin-top: var(--space-6);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.loading {
		padding: var(--space-8) 0;
		color: var(--ink-faint);
		text-align: center;
	}
	.loading.small {
		padding: var(--space-6) 0;
	}
	.empty {
		margin-bottom: var(--space-7);
	}
	.anchor {
		scroll-margin-top: 72px;
	}
	#within,
	#why,
	.explore {
		margin-top: var(--space-8);
	}
	.explore {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: var(--space-5);
	}
	.explore h2 {
		font-size: var(--text-xl);
	}
	.method-wrap {
		margin-top: var(--space-8);
	}
	@media (max-width: 1100px) {
		.jump {
			display: none;
		}
	}
	@media (max-width: 520px) {
		.filters {
			position: static;
			gap: var(--space-2) var(--space-3);
		}
		/* A phone shows the answer first: the takeaway moves above the filters, and the downloads
		   go to the end of the page. */
		.flow {
			display: flex;
			flex-direction: column;
		}
		.flow > .take-slot {
			order: -1;
			margin-bottom: var(--space-4);
		}
		.wide-only {
			display: none;
		}
		.narrow-only {
			display: flex;
			margin-top: var(--space-6);
		}
		:global(.dash .ph .lead),
		:global(.dash .ph .actions) {
			display: none;
		}
	}
</style>
