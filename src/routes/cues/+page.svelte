<script lang="ts">
	// PLACEHOLDER: the cues gallery (live previews, descriptions, per-cue results) goes here.
	import {
		CueChip,
		DataTable,
		EmptyState,
		Page,
		PageHeader,
		Panel,
		Segmented,
		cueListings,
		ROLE_LABEL,
		type CueListing
	} from '#lib/ui/index.ts';

	const all = cueListings();
	let role = $state<'all' | CueListing['role']>('all');
	const rows = $derived(role === 'all' ? all : all.filter((c) => c.role === role));
	const count = (r: CueListing['role']) => all.filter((c) => c.role === r).length;
</script>

<svelte:head><title>Cues · Circle Chase</title></svelte:head>

<Page width="wide">
	<PageHeader
		eyebrow="Conditions"
		title="The cues"
		lead="Thirteen ways to show that a power-up is about to end. Each one uses a single signal, so they can be compared fairly."
	/>

	<p class="intro">
		This page will become a gallery: a live preview of every cue running on the same moment of play,
		what the player sees from start to end, and how each one is doing in the study so far.
	</p>

	<Panel title="All conditions" flush>
		{#snippet actions()}
			<Segmented
				label="Show"
				size="sm"
				options={[
					{ value: 'all', label: 'All', hint: all.length },
					{ value: 'reference', label: ROLE_LABEL.reference, hint: count('reference') },
					{ value: 'baseline', label: ROLE_LABEL.baseline, hint: count('baseline') },
					{ value: 'idea', label: 'Ideas', hint: count('idea') }
				]}
				bind:value={role}
			/>
		{/snippet}
		<DataTable
			caption="Conditions"
			{rows}
			key={(r) => r.id}
			columns={[
				{ key: 'cue', label: 'Condition', width: '34%' },
				{ key: 'role', label: 'Role', width: '14%', format: (r) => ROLE_LABEL[r.role] },
				{ key: 'tagline', label: 'What the player sees' },
				{ key: 'status', label: 'Status', width: '120px', format: (r) => (r.ready ? 'Playable' : 'Being built') }
			]}
		>
			{#snippet cell(r, c)}
				{#if c.key === 'cue'}
					<CueChip cue={r} href={r.ready ? `/play/${r.id}` : undefined} />
				{:else if c.key === 'role'}
					<span class="dim">{ROLE_LABEL[r.role]}</span>
				{:else if c.key === 'tagline'}
					<span class="dim">{r.tagline}</span>
				{:else}
					<span class={r.ready ? 'ok' : 'dim'}>{r.ready ? 'Playable' : 'Being built'}</span>
				{/if}
			{/snippet}
		</DataTable>
	</Panel>

	<div class="later">
		<EmptyState title="Live previews are on their way" compact>
			Each cue will get a small looping preview here, drawn by the real game.
		</EmptyState>
	</div>
</Page>

<style>
	.intro {
		max-width: 70ch;
		margin-bottom: var(--space-5);
		color: var(--ink-dim);
	}
	.dim { color: var(--ink-dim); }
	.ok { color: var(--good); font-weight: 600; }
	.later { margin-top: var(--space-5); }
</style>
