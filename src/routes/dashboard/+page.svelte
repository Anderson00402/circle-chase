<script lang="ts">
	/**
	 * Results dashboard. Top-down: the answer (takeaway and ranking), why (the evidence), explore
	 * (one condition, live feed, participants and data quality, export), and how it is measured.
	 * Every number comes from a live Convex query, so the page moves while someone plays. Human data
	 * is the default; simulated data is a separate, labelled view. Filters live in the URL.
	 */
	import '#lib/charts/tokens.css';
	import { untrack } from 'svelte';
	import { useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { api } from '#convex/_generated/api.js';
	import type { Id } from '#convex/_generated/dataModel.js';
	import { Badge, Button, EmptyState, Page, PageHeader, Panel, Segmented, Select } from '#lib/ui/index.ts';
	import { CONDITIONS } from '#lib/charts/encoding.ts';
	import Answer from './Answer.svelte';
	import Detail from './Detail.svelte';
	import Method from './Method.svelte';
	import NowPlaying from './NowPlaying.svelte';
	import Recent from './Recent.svelte';
	import Sessions from './Sessions.svelte';
	import SimCheck from './SimCheck.svelte';
	import Why from './Why.svelte';
	import { DEFS } from './defs';
	import type { DashFilter, ModeSel, RowOrder, SourceSel } from './types';

	// Filter state, read once from the URL and written back on change.
	const q = page.url.searchParams;
	const pick = <T extends string>(v: string | null, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
	let source = $state<SourceSel>(pick(q.get('data'), ['human', 'bot', 'all'], 'human'));
	let mode = $state<ModeSel>(pick(q.get('mode'), ['study', 'arcade', 'both'], 'both'));
	let participant = $state<string>(q.get('p') ?? 'all');
	let period = $state<string>(pick(q.get('period'), ['all', 'today', '7d', '30d'], 'all'));
	let detailCue = $state<string>(q.get('cue') ?? 'timer-bar');
	let order = $state<RowOrder>(pick(q.get('order'), ['rank', 'code'], 'rank'));
	let selected = $state<string | null>(q.get('cue'));

	/** Start of the period, computed when the period changes (not every render). */
	let from = $state<number | undefined>(undefined);
	$effect(() => {
		const p = period;
		const d = new Date();
		from = untrack(() => p === 'today'
			? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
			: p === '7d' ? Date.now() - 7 * 864e5 : p === '30d' ? Date.now() - 30 * 864e5 : undefined);
	});

	const filter = $derived<DashFilter>({
		source,
		...(mode !== 'both' ? { mode } : {}),
		...(participant !== 'all' ? { participantId: participant as Id<'participants'> } : {}),
		...(from !== undefined ? { from } : {})
	});

	$effect(() => {
		const u = new URL(page.url.href);
		const set = (k: string, v: string, d: string) => (v === d ? u.searchParams.delete(k) : u.searchParams.set(k, v));
		set('data', source, 'human');
		set('mode', mode, 'both');
		set('p', participant, 'all');
		set('period', period, 'all');
		set('order', order, 'rank');
		if (selected) u.searchParams.set('cue', selected);
		else u.searchParams.delete('cue');
		if (u.search !== untrack(() => page.url.search)) replaceState(u, {});
	});

	const main = useQuery(api.dashboard.main, () => filter, { keepPreviousData: true });
	const facets = useQuery(api.dashboard.facets, () => ({ source, ...(mode !== 'both' ? { mode } : {}) }));

	// A clock for "x s ago" labels and the live strip. Not game time: this is page chrome.
	let now = $state(Date.now());
	$effect(() => {
		const t = setInterval(() => (now = Date.now()), 5000);
		return () => clearInterval(t);
	});

	const counts = $derived(facets.data?.counts);
	const n = (src: 'human' | 'bot', m?: 'study' | 'arcade') =>
		counts ? (m ? counts[src][m] : counts[src].study + counts[src].arcade) : undefined;
	const srcCount = (s: SourceSel) => (s === 'all' ? (n('human') ?? 0) + (n('bot') ?? 0) : n(s));
	const modeCount = (m: ModeSel) => {
		if (!counts) return undefined;
		const srcs: ('human' | 'bot')[] = source === 'all' ? ['human', 'bot'] : [source];
		return srcs.reduce((a, s) => a + (m === 'both' ? n(s)! : n(s, m)!), 0);
	};

	const participantOptions = $derived([
		{ value: 'all', label: 'Everyone' },
		...(facets.data?.participants ?? []).map((p) => ({
			value: p.id,
			label: `P${p.number}${p.nickname ? ` ${p.nickname}` : ''}${p.source === 'bot' ? ' (sim)' : ''}, ${p.trials}`
		}))
	]);
	const periodOptions = [
		{ value: 'all', label: 'All time' },
		{ value: 'today', label: 'Today' },
		{ value: '7d', label: 'Last 7 days' },
		{ value: '30d', label: 'Last 30 days' }
	];

	const simulated = $derived(source !== 'human');
	const data = $derived(main.data);
	const empty = $derived(data !== undefined && data.totals.trials === 0);

	function select(id: string) {
		selected = id;
		detailCue = id;
		document.getElementById('detail')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
	}

	const site = import.meta.env.PUBLIC_CONVEX_SITE_URL ?? 'http://127.0.0.1:3211';
	const exportHref = (fmt: 'csv' | 'json') => {
		const p = new URLSearchParams({ source });
		if (filter.mode) p.set('mode', filter.mode);
		if (filter.participantId) p.set('participantId', filter.participantId);
		if (filter.from) p.set('from', String(filter.from));
		return `${site}/export/trials.${fmt}?${p}`;
	};
	const filtersActive = $derived(mode !== 'both' || participant !== 'all' || period !== 'all');
</script>

<svelte:head><title>Dashboard · Circle Chase</title></svelte:head>

<Page width="wide" class="dash">
	<PageHeader
		eyebrow="Results"
		title="Dashboard"
		lead="Do players know when the power-up is about to run out, and which signal tells them best? Updated live as people play."
	>
		{#snippet actions()}
			<Button size="sm" variant="quiet" href={exportHref('csv')}>Download CSV</Button>
			<Button size="sm" variant="quiet" href={exportHref('json')}>JSON</Button>
		{/snippet}
	</PageHeader>

	<div class="filters" role="group" aria-label="Filters">
		<div class="f">
			<span class="f-label">Data</span>
			<Segmented
				label="Data source"
				size="sm"
				options={[
					{ value: 'human', label: 'Humans', hint: srcCount('human') },
					{ value: 'bot', label: 'Simulated', hint: srcCount('bot') },
					{ value: 'all', label: 'Both', hint: srcCount('all') }
				]}
				bind:value={source}
			/>
		</div>
		<div class="f">
			<span class="f-label">Mode</span>
			<Segmented
				label="Game mode"
				size="sm"
				options={[
					{ value: 'both', label: 'All', hint: modeCount('both') },
					{ value: 'study', label: 'Study', hint: modeCount('study') },
					{ value: 'arcade', label: 'Free play', hint: modeCount('arcade') }
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
		{#if filtersActive}
			<button class="reset" type="button" onclick={() => ((mode = 'both'), (participant = 'all'), (period = 'all'))}>Clear filters</button>
		{/if}
		<nav class="jump" aria-label="Sections">
			<a href="#top-answer">Answer</a><a href="#why">Why</a><a href="#explore">Explore</a><a href="#method">Method</a>
		</nav>
	</div>

	<div class="live">
		<NowPlaying lastAt={data?.totals.lastAt ?? null} {now} />
	</div>

	{#if simulated}
		<div class="sim-banner" role="note">
			<Badge tone="sim">Simulated</Badge>
			<p>
				{#if source === 'bot'}
					You are looking at simulated players only.
				{:else}
					Human and simulated players are mixed in this view.
				{/if}
				{DEFS.simulated}
			</p>
			<button type="button" onclick={() => (source = 'human')}>Back to humans</button>
		</div>
	{/if}

	{#if !data}
		<div class="loading" aria-busy="true">Loading results…</div>
	{:else if empty}
		<div class="empty">
			<EmptyState icon="chart" title={source === 'human' ? 'No human power-ups yet' : 'No power-ups in this view'}>
				{#if source === 'human' && (srcCount('bot') ?? 0) > 0}
					Nobody has played {filtersActive ? 'in this filter ' : ''}yet, so there is nothing to compare. Simulated players have
					{srcCount('bot')} power-ups you can explore to see how the page works; they are kept apart and clearly labelled.
				{:else if filtersActive}
					Nothing matches the filters. Clear them to see everything.
				{:else}
					Results appear here as soon as someone plays a power-up.
				{/if}
				{#snippet actions()}
					{#if source === 'human' && (srcCount('bot') ?? 0) > 0}
						<Button variant="primary" onclick={() => (source = 'bot')}>Show simulated data</Button>
					{/if}
					{#if filtersActive}
						<Button variant="quiet" onclick={() => ((mode = 'both'), (participant = 'all'), (period = 'all'))}>Clear filters</Button>
					{/if}
					<Button variant="quiet" href="/study">Take the study</Button>
				{/snippet}
			</EmptyState>
		</div>
	{:else}
		<div id="top-answer" class="anchor">
			<Answer main={data} {selected} onselect={select} {simulated} />
		</div>

		{#if source === 'bot'}
			<SimCheck main={data} {filter} />
		{/if}

		<div id="why" class="anchor">
			<Why main={data} {filter} bind:order {selected} onselect={select} />
		</div>

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
			<Panel title="Participants and sessions" sub="Who played, how much, and how trustworthy the data is." flush>
				<Sessions {filter} {now} onparticipant={(id) => (participant = id)} />
			</Panel>
		</section>
	{/if}

	<div class="method-wrap">
		<Method />
	</div>
</Page>

<style>
	:global(.dash) {
		/* Charts and chips share one baseline blue on this page (see src/lib/charts/tokens.css). */
		--role-baseline: var(--chart-baseline);
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
	}
	.f-label {
		color: var(--ink-faint);
		font-size: var(--text-xs);
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
	.sim-banner button {
		padding: 0;
		border: 0;
		background: none;
		color: var(--focus);
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.loading {
		padding: var(--space-8) 0;
		color: var(--ink-faint);
		text-align: center;
	}
	.empty {
		margin-bottom: var(--space-7);
	}
	.anchor {
		scroll-margin-top: 72px;
	}
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
	@media (max-width: 860px) {
		.jump {
			display: none;
		}
	}
	@media (max-width: 520px) {
		.filters {
			position: static;
			gap: var(--space-2) var(--space-3);
		}
	}
</style>
