<script lang="ts">
	// PLACEHOLDER: the live results dashboard goes here. Follow the honesty rules in docs/STUDY.md.
	import {
		Badge,
		EmptyState,
		Field,
		Page,
		PageHeader,
		Panel,
		Select,
		Stat,
		Tabs,
		cueListings
	} from '#lib/ui/index.ts';

	let source = $state<'human' | 'bot'>('human');
	let cue = $state('all');
	const cueOptions = [
		{ value: 'all', label: 'All conditions' },
		...cueListings().map((c) => ({ value: c.id, label: `${c.code}. ${c.name}`, disabled: !c.ready }))
	];
</script>

<svelte:head><title>Dashboard · Circle Chase</title></svelte:head>

<Page width="wide">
	<PageHeader
		eyebrow="Results"
		title="Dashboard"
		lead="How well each cue tells players the power is ending, updated live as people play."
	>
		{#snippet actions()}
			<Field label="Condition" inline>
				{#snippet children(id)}
					<Select {id} size="sm" options={cueOptions} bind:value={cue} />
				{/snippet}
			</Field>
		{/snippet}
	</PageHeader>

	<p class="intro">
		This page will compare the conditions on caught rate, well-timed rate, turn-away time and wasted
		power, each with its sample size and a 95% interval, plus the questionnaire ratings. Human and
		simulated data are always kept apart.
	</p>

	<Tabs
		label="Data source"
		tabs={[
			{ id: 'human', label: 'Human players' },
			{ id: 'bot', label: 'Simulated players' }
		]}
		bind:value={source}
	>
		{#snippet panel(id)}
			<div class="stats">
				<Panel>
					<Stat
						label="Caught rate"
						value={null}
						unit="%"
						info="Trials where the player was caught within 3 s after the power ended, out of engaged trials. Lower is better."
						sub="no trials yet"
					/>
				</Panel>
				<Panel>
					<Stat
						label="Well-timed rate"
						value={null}
						unit="%"
						info="Late catches plus timely retreats, out of engaged trials. Higher is better. Shown with a 95% Wilson interval."
						sub="no trials yet"
					/>
				</Panel>
				<Panel>
					<Stat
						label="Turn-away time"
						value={null}
						unit="s"
						info="Power left at the moment the player stopped closing in for good. Median across engaged trials."
						sub="no trials yet"
					/>
				</Panel>
			</div>
			<EmptyState title="No {id === 'bot' ? 'simulated' : 'human'} trials yet" icon="chart">
				Charts appear here once a few power-ups have been played.
				{#if id === 'bot'}<br /><Badge tone="sim">Simulated</Badge> data never mixes with human data.{/if}
			</EmptyState>
		{/snippet}
	</Tabs>
</Page>

<style>
	.intro {
		max-width: 70ch;
		margin-bottom: var(--space-5);
		color: var(--ink-dim);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: var(--space-4);
		margin-bottom: var(--space-5);
	}
</style>
