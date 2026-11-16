<script lang="ts">
	/** A thin stacked bar of a run's outcomes, in the shared outcome colours (src/lib/outcomes.ts). */
	import { OUTCOME_ORDER, outcomeColor, outcomeLabel, outcomeMix } from '../outcomes';

	interface Props { outcomes: Record<string, number>; height?: number }
	let { outcomes, height = 6 }: Props = $props();
	const ids = [...OUTCOME_ORDER, 'late-catch'];
	const parts = $derived(ids.filter((o) => (outcomes[o] ?? 0) > 0).map((o) => ({ o, n: outcomes[o] })));
</script>

{#if parts.length > 0}
	<span class="bar" style:height="{height}px" role="img" aria-label={outcomeMix(outcomes, 8)} title={outcomeMix(outcomes, 8)}>
		{#each parts as p (p.o)}<span style:flex-grow={p.n} style:background={outcomeColor(p.o)} title="{p.n} {outcomeLabel(p.o).toLowerCase()}"></span>{/each}
	</span>
{/if}

<style>
	.bar { display: flex; gap: 1px; width: 100%; border-radius: 2px; overflow: hidden; }
	.bar > span { flex-basis: 0; min-width: 3px; background: var(--ink-faint); }
</style>
