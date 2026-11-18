<script lang="ts">
	/**
	 * The replay browser's "Whole runs" view (/replays?view=runs): every recorded run, newest first,
	 * by data source (humans, simulated, both), case and participant. Reads the small index
	 * documents (`runRecordings.list`), never the recordings themselves.
	 */
	import { useQuery } from 'convex-svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { api } from '#convex/_generated/api.js';
	import { cueById } from '#lib/game/cues/index.ts';
	import { Badge, CueChip, EmptyState, LoadState, Segmented, Select, cueListings, slow } from '#lib/ui/index.ts';
	import { modeLabel } from '../outcomes';
	import { ago } from './story';
	import { clock } from './runline';

	type Source = 'human' | 'bot' | 'all';
	const p = $derived(page.url.searchParams);
	const source = $derived((['human', 'bot', 'all'].includes(p.get('source') ?? '') ? p.get('source') : 'human') as Source);
	const cue = $derived(p.get('cue') ?? '');
	const participant = $derived(p.get('p') ?? '');
	let shown = $state(48);
	const q = useQuery(api.runRecordings.list, () => ({ source, cue: cue || undefined, participant: participant || undefined, limit: shown }), { keepPreviousData: true });
	const wait = slow(() => !q.data && !q.error);

	function set(patch: Record<string, string>) {
		const next = new URLSearchParams(page.url.search);
		next.set('view', 'runs');
		for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
		if (next.get('source') === 'human') next.delete('source');
		shown = 48;
		goto(`/replays?${next}`, { replace: true, reset: false });
	}
	const cueOptions = $derived([{ value: '', label: 'All conditions' }, ...cueListings().map((c) => ({ value: c.id as string, label: `${c.code} · ${c.name}` }))]);
	const participantOptions = $derived([
		{ value: '', label: 'Everyone' },
		...(q.data?.participants ?? []).map((x) => ({ value: x.id as string, label: source === 'all' && x.source === 'bot' ? `${x.label} (simulated)` : x.label }))
	]);
	const kb = (n: number) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
	let now = $state(Date.now());
	$effect(() => { const id = setInterval(() => (now = Date.now()), 30_000); return () => clearInterval(id); });
</script>

<section class="filters" aria-label="Filters">
	<Segmented label="Data" options={[{ value: 'human', label: 'Humans' }, { value: 'bot', label: 'Simulated' }, { value: 'all', label: 'All' }]} value={source} onchange={(v) => set({ source: v, p: '' })} />
	<label class="f"><span>Condition</span><Select size="sm" options={cueOptions} value={cue} onchange={(e) => set({ cue: e.currentTarget.value })} /></label>
	<label class="f"><span>Participant</span><Select size="sm" options={participantOptions} value={participant} onchange={(e) => set({ p: e.currentTarget.value })} /></label>
</section>

{#if !q.data}
	<LoadState {wait} error={q.error} what="the whole runs" icon="replay" />
{:else if !q.data.rows.length}
	<EmptyState title={cue || participant ? 'No whole runs match these filters' : 'No whole runs yet'} icon="replay" compact>
		Every run played from the run console is recorded from start to end. Play a case and come back.
	</EmptyState>
{:else}
	<p class="status"><span class="num">{q.data.total}</span> whole run{q.data.total === 1 ? '' : 's'}, newest first.</p>
	<ul class="runs">
		{#each q.data.rows as r (r.blockKey)}
			{@const c = cueById(r.cue)}
			<li>
				<a href="/replays/run/{r.blockKey}">
					<CueChip cue={c} size="sm" />
					<span class="who">{r.label} <span class="dim">· run {r.orderIndex + 1}{r.mode === 'arcade' ? ` · ${modeLabel(r.mode)}` : ''}</span></span>
					<span class="num len">{clock(r.duration, 0)}</span>
					<span class="num dim size">{kb(r.bytes)}</span>
					<span class="dim when" title={new Date(r.startedAt).toLocaleString()}>{ago(r.startedAt, now)}</span>
					{#if r.source === 'bot'}<Badge tone="sim">Simulated</Badge>{/if}
				</a>
			</li>
		{/each}
	</ul>
	{#if q.data.total > q.data.rows.length}
		<p class="more"><button type="button" class="linkish" onclick={() => (shown += 96)}>Show more ({q.data.total - q.data.rows.length} left)</button></p>
	{/if}
{/if}

<style>
	.filters { display: flex; flex-wrap: wrap; align-items: end; gap: var(--space-3); margin-bottom: var(--space-5); padding: var(--space-4); border: 1px solid var(--rule); border-radius: var(--radius-lg); background: var(--surface); }
	.f { display: flex; flex-direction: column; gap: 4px; font-size: var(--text-xs); color: var(--ink-faint); font-weight: 600; }
	.status { color: var(--ink-dim); font-size: var(--text-sm); margin: 0 0 var(--space-3); }
	.runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.runs a {
		display: grid; grid-template-columns: minmax(150px, 220px) minmax(0, 1fr) 60px 70px 110px auto; align-items: center; gap: var(--space-3);
		padding: var(--space-2) var(--space-3); border: 1px solid var(--rule); border-radius: var(--radius-md, 8px); background: var(--surface);
		color: var(--ink); text-decoration: none; font-size: var(--text-sm);
	}
	.runs a:hover { background: var(--surface-2); }
	.runs a:focus-visible { outline: 2px solid var(--focus); }
	.who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.len, .size { text-align: right; }
	.dim { color: var(--ink-faint); }
	.more { text-align: center; }
	.linkish { background: none; border: 0; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }
	@media (max-width: 720px) {
		.runs a { grid-template-columns: minmax(0, 1fr) auto; }
		.size, .when { display: none; }
	}
</style>
