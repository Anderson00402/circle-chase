<script lang="ts">
	/**
	 * Replay browser: every stored moment (the last seconds of a power-up and 3 s after), as cards
	 * with a still of the key frame. Filters and sort live in the URL query so a view can be shared
	 * and the player's previous / next links walk the same list. The server filters and sorts and
	 * sends one page at a time ("Show more" asks for more). Updates live as clips arrive.
	 */
	import { useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '#convex/_generated/api.js';
	import { Badge, Button, EmptyState, CONSOLE_HREF, Page, PageHeader, Segmented, Select, cueListings } from '#lib/ui/index.ts';
	import MomentCard from '#lib/replay/MomentCard.svelte';
	import { SORTS, queryArgs, readState, toSearch, type ListState, type Source } from '#lib/replay/list.ts';
	import { OUTCOME_LABEL, OUTCOME_ORDER } from '#lib/replay/story.ts';
	import { slow } from '#lib/ui/connection.svelte.ts';

	const PAGE = 24;
	const ls = $derived(readState(page.url.searchParams));
	let shown = $state(PAGE);
	const q = useQuery(api.replays.list, () => ({ ...queryArgs(ls), limit: shown }), { keepPreviousData: true });
	const list = $derived(q.data?.rows ?? []);
	const total = $derived(q.data?.total ?? 0);
	const late = slow(() => q.isLoading && !q.data);

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
		...(q.data?.participants ?? []).map((p) => ({ value: String(p.number), label: p.label })),
		...(ls.participant && !(q.data?.participants ?? []).some((p) => String(p.number) === ls.participant) ? [{ value: ls.participant, label: `Participant ${ls.participant}` }] : [])
	]);
	const sourceOptions: { value: Source; label: string }[] = [
		{ value: 'human', label: 'Humans' },
		{ value: 'bot', label: 'Simulated' },
		{ value: 'all', label: 'All' }
	];
	const filtered = $derived(!!(ls.cue || ls.outcome || ls.participant));
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
		{#if ls.source !== 'human'}
			<p class="simnote">
				<Badge tone="sim">Simulated</Badge>
				{ls.source === 'bot' ? 'These moments come from simulated players.' : 'Human and simulated moments mixed; simulated ones are labelled.'}
				A simulated player cannot see the cue, so its moments show how the replay works, not which cue is better.
			</p>
		{/if}
	</section>

	{#if q.isLoading && !q.data}
		{#if late.current}
			<EmptyState title="Can't reach the database" icon="replay" compact>
				The replays will appear as soon as the connection is back. Nothing needs to be reloaded.
			</EmptyState>
		{:else}
			<p class="status">Loading moments&hellip;</p>
		{/if}
	{:else if q.error}
		<EmptyState title="Could not load replays" icon="replay">
			The database did not answer. Check that the Convex dev server is running, then reload.
		</EmptyState>
	{:else if !outcomeCounts.all && !ls.cue && !ls.participant}
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
				<Button onclick={() => set({ cue: '', outcome: '', participant: '' })}>Clear filters</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<p class="status" aria-live="polite">
			<span class="num">{total}</span> {total === 1 ? 'moment' : 'moments'}{filtered ? ' match' : ''}, {SORTS.find((s) => s.value === ls.sort)?.label.toLowerCase()}.
			<span class="live"><i></i>Updates live</span>
		</p>
		<ul class="grid">
			{#each list as m (m.trialId)}
				<li><MomentCard {m} {now} href="/replays/{m.trialId}{search}" /></li>
			{/each}
		</ul>
		{#if total > list.length}
			<div class="more">
				<Button onclick={() => (shown += PAGE * 2)} disabled={q.isLoading}>Show more ({total - list.length} left)</Button>
			</div>
		{/if}
		{#if q.data?.truncated}
			<p class="status">Only the newest 4,000 trials are scanned.</p>
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
