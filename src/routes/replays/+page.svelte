<script lang="ts">
	/**
	 * Replay browser: every stored moment (the last seconds of a power-up and 3 s after), as cards
	 * with a still of the key frame. Filters and sort live in the URL query so a view can be shared
	 * and the player's previous / next links walk the same list. The server filters and sorts and
	 * sends one page at a time ("Show more" asks for more). Updates live as clips arrive.
	 */
	import { useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { beforeNavigate, goto } from '$app/navigation';
	import { tick } from 'svelte';
	import { api } from '#convex/_generated/api.js';
	import { Badge, Button, EmptyState, CONSOLE_HREF, LoadState, Page, PageHeader, Segmented, Select, cueListings } from '#lib/ui/index.ts';
	import MomentCard from '#lib/replay/MomentCard.svelte';
	import { SORTS, dashboardHref, dashboardScope, queryArgs, readState, toSearch, type ListState, type Source } from '#lib/replay/list.ts';
	import { OUTCOME_LABEL, OUTCOME_ORDER } from '#lib/replay/story.ts';
	import { slow } from '#lib/ui/connection.svelte.ts';

	const PAGE = 24;
	const ls = $derived(readState(page.url.searchParams));
	/**
	 * How far "Show more" went and where the page was scrolled, per list (its query), for this tab:
	 * coming back from a replay finds the same cards at the same place. Back from the player carries
	 * `#at=<trial>&pos=<n>`: enough cards are shown to reach it, and it is scrolled into view.
	 */
	const VIEW_KEY = (q: string) => `cc.replays.view:${q}`;
	function readView(q: string): { shown: number; y: number } | null {
		try { const v = JSON.parse(sessionStorage.getItem(VIEW_KEY(q)) ?? 'null'); return v && typeof v.shown === 'number' ? v : null; }
		catch { return null; }
	}
	const startHash = new URLSearchParams(typeof location === 'undefined' ? '' : location.hash.slice(1));
	const backAt = startHash.get('at');
	const backPos = Number(startHash.get('pos') ?? -1);
	const firstView = readView(toSearch(readState(page.url.searchParams)));
	let shown = $state(Math.min(500, Math.max(firstView?.shown ?? PAGE, backPos >= 0 ? Math.ceil((backPos + 1) / PAGE) * PAGE : PAGE)));
	beforeNavigate(() => {
		try { sessionStorage.setItem(VIEW_KEY(toSearch(ls)), JSON.stringify({ shown, y: Math.round(window.scrollY) })); } catch { /* storage blocked */ }
	});
	const q = useQuery(api.replays.list, () => ({ ...queryArgs(ls), limit: shown }), { keepPreviousData: true });
	const list = $derived(q.data?.rows ?? []);
	const total = $derived(q.data?.total ?? 0);
	const wait = slow(() => !q.data && !q.error);

	function set(patch: Partial<ListState>) {
		shown = PAGE;
		goto(`/replays${toSearch({ ...ls, ...patch })}`, { replace: true, reset: false });
	}

	// Counts for the outcome chips: every filter but the outcome.
	const outcomeCounts = $derived({ all: q.data?.all ?? 0, by: q.data?.outcomes ?? {} });
	const cueOptions = $derived([
		{ value: '', label: 'All conditions' },
		...cueListings().map((c) => ({ value: c.id as string, label: `${c.code} · ${c.name}` }))
	]);
	const participantOptions = $derived([
		{ value: '', label: 'Everyone' },
		...(q.data?.participants ?? []).map((p) => ({ value: p.id as string, label: ls.source === 'all' && p.source === 'bot' ? `${p.label} (simulated)` : p.label })),
		...(ls.participant && !(q.data?.participants ?? []).some((p) => p.id === ls.participant || String(p.runNumber) === ls.participant) ? [{ value: ls.participant, label: !q.data ? 'Loading...' : /^\d+$/.test(ls.participant) ? `Participant #${ls.participant}` : 'Participant not in this list' }] : [])
	]);
	// An old link with a console number (`?p=5`) is rewritten to that participant's id.
	$effect(() => {
		if (!/^\d+$/.test(ls.participant) || !q.data) return;
		const hit = q.data.participants.filter((p) => String(p.runNumber) === ls.participant);
		if (hit.length === 1) set({ participant: hit[0].id });
	});
	const sourceOptions: { value: Source; label: string }[] = [
		{ value: 'human', label: 'Humans' },
		{ value: 'bot', label: 'Simulated' },
		{ value: 'all', label: 'All' }
	];
	const filtered = $derived(!!(ls.cue || ls.outcome || ls.participant || ls.run || ls.mode || ls.period));
	/** The filters the dashboard set that this page has no control for, in words. */
	const scope = $derived(dashboardScope(ls));

	// Once the cards are in, go back to where the list was left: the card just watched, else the scroll position.
	let restored = false;
	$effect(() => {
		if (restored || !q.data) return;
		const rows = list;
		if (backAt && !rows.some((m) => m.trialId === backAt) && q.data.total > rows.length && shown < 500) return; // still loading more
		restored = true;
		tick().then(() => {
			const card = backAt ? document.querySelector(`[data-trial="${CSS.escape(backAt)}"]`) : null;
			if (card) {
				card.scrollIntoView({ block: 'center' });
				(card.querySelector('a') as HTMLElement | null)?.focus({ preventScroll: true });
			} else if (firstView && firstView.y > 0) window.scrollTo(0, firstView.y);
		});
	});
	const search = $derived(toSearch(ls));

	// Re-render "x min ago" now and then.
	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});
</script>

<svelte:head><title>Replays · Circle Chase</title></svelte:head>

<Page width="wide">
	<PageHeader
		eyebrow="Close calls"
		title="Replays"
		lead="Watch the last seconds of a power-up again, with the exact cue the player saw, and see whether they knew it was about to run out."
	>
		{#snippet actions()}
			<Button href="/dashboard">Dashboard</Button>
		{/snippet}
	</PageHeader>

	<section class="filters" aria-label="Filters">
		<div class="row">
			<Segmented label="Data" options={sourceOptions} value={ls.source} onchange={(v) => set({ source: v, participant: '' })} />
			<div class="selects">
				<label class="f"><span>Condition</span><Select size="sm" options={cueOptions} value={ls.cue} onchange={(e) => set({ cue: e.currentTarget.value })} /></label>
				<label class="f"><span>Participant</span><Select size="sm" options={participantOptions} value={ls.participant} onchange={(e) => set({ participant: e.currentTarget.value })} /></label>
				<label class="f"><span>Sort</span><Select size="sm" options={SORTS} value={ls.sort} onchange={(e) => set({ sort: e.currentTarget.value as ListState['sort'] })} /></label>
			</div>
		</div>
		<div class="chips" role="group" aria-label="Outcome">
			<button type="button" class="chip" aria-pressed={!ls.outcome} onclick={() => set({ outcome: '' })}>
				Any outcome <span class="n num">{outcomeCounts.all}</span>
			</button>
			{#each OUTCOME_ORDER as o (o)}
				{#if outcomeCounts.by[o] || ls.outcome === o}
					<button type="button" class="chip {o}" aria-pressed={ls.outcome === o} onclick={() => set({ outcome: ls.outcome === o ? '' : o })}>
						{OUTCOME_LABEL[o]} <span class="n num">{outcomeCounts.by[o] ?? 0}</span>
					</button>
				{/if}
			{/each}
		</div>
		{#if scope.length || ls.dash}
			<p class="scope">
				<span>{scope.length ? `Only ${scope.join(', ')}` : 'Opened from the dashboard'}{ls.dash ? ', as on the dashboard.' : '.'}</span>
				{#if ls.dash}<a href={dashboardHref(ls)}>Back to the dashboard</a>{/if}
				{#if scope.length}<button type="button" class="linkish" onclick={() => set({ run: '', mode: '', period: '', dash: '' })}>Show every run and period</button>{/if}
			</p>
		{/if}
		{#if ls.source !== 'human'}
			<p class="simnote">
				<Badge tone="sim">Simulated</Badge>
				{ls.source === 'bot' ? 'These moments come from simulated players.' : 'Human and simulated moments mixed; simulated ones are labelled.'}
				A simulated player cannot see the cue, so its moments show how the replay works, not which cue is better.
			</p>
		{/if}
	</section>

	{#if !q.data}
		<LoadState {wait} error={q.error} what="the replays" icon="replay" />
	{:else if !outcomeCounts.all && !filtered}
		{#if ls.source === 'human' && q.data?.has.bot}
			<EmptyState title="No human replays yet" icon="replay">
				Nobody has played a recorded moment yet. Simulated players have, and their moments show how
				replays work.
				{#snippet actions()}
					<Button variant="primary" onclick={() => set({ source: 'bot' })}>Show simulated moments</Button>
					<Button href={CONSOLE_HREF}>Go to the run console</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<EmptyState title="No replays yet" icon="replay">
				A replay is saved for every power-up where the player was chasing near the end, or was caught.
				Play a case from the run console and come back.
				{#snippet actions()}
					<Button variant="primary" href={CONSOLE_HREF}>Go to the run console</Button>
				{/snippet}
			</EmptyState>
		{/if}
	{:else if !list.length}
		<EmptyState title="No moments match these filters" icon="replay" compact>
			Try another condition or outcome.
			{#snippet actions()}
				<Button onclick={() => set({ cue: '', outcome: '', participant: '', run: '', mode: '', period: '', dash: '' })}>Clear filters</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<p class="status" aria-live="polite">
			<span class="num">{total}</span> {total === 1 ? 'moment' : 'moments'}{filtered ? ' match' : ''}, {SORTS.find((s) => s.value === ls.sort)?.label.toLowerCase()}.
			<span class="live"><i></i>Updates live</span>
		</p>
		<ul class="grid">
			{#each list as m (m.trialId)}
				<li data-trial={m.trialId}><MomentCard {m} {now} href="/replays/{m.trialId}{search}" /></li>
			{/each}
		</ul>
		{#if total > list.length}
			<div class="more">
				<Button onclick={() => (shown += PAGE * 2)} disabled={q.isLoading}>Show more ({total - list.length} left)</Button>
			</div>
		{/if}
	{/if}
</Page>

<style>
	.filters {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin-bottom: var(--space-5);
		padding: var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.row { display: flex; flex-wrap: wrap; align-items: end; justify-content: space-between; gap: var(--space-3); }
	.selects { display: flex; flex-wrap: wrap; gap: var(--space-3); }
	.f { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); color: var(--ink-faint); font-weight: 600; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--rule);
		background: var(--surface-2);
		color: var(--ink-dim);
		font: inherit;
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}
	.chip:hover { background: var(--surface-3); color: var(--ink); }
	.chip:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.chip[aria-pressed='true'] { border-color: var(--accent); color: var(--ink); background: var(--accent-soft); }
	.chip.caught[aria-pressed='true'] { border-color: var(--bad); background: var(--bad-soft); }
	.chip.overstayed[aria-pressed='true'], .chip.early-retreat[aria-pressed='true'] { border-color: var(--warn); background: var(--warn-soft); }
	.chip.timely-retreat[aria-pressed='true'] { border-color: var(--good); background: var(--good-soft); }
	.n { color: var(--ink-faint); font-weight: 400; }
	.scope { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-3); margin: 0; font-size: var(--text-sm); color: var(--ink-dim); }
	.linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
	.simnote { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin: 0; font-size: var(--text-sm); color: var(--ink-dim); }
	.status { color: var(--ink-dim); font-size: var(--text-sm); margin: 0 0 var(--space-3); display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); align-items: center; }
	.live { display: inline-flex; align-items: center; gap: 6px; color: var(--ink-faint); }
	.live i { width: 7px; height: 7px; border-radius: 50%; background: var(--good); }
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--space-4);
	}
	.grid > li { min-width: 0; }
	.more { display: flex; justify-content: center; padding: var(--space-5) 0; }
	@media (max-width: 520px) {
		.grid { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
		.selects { width: 100%; }
		.f { flex: 1 1 140px; }
	}
</style>
