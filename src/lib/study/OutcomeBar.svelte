<script lang="ts">
	/** A thin stacked bar of a run's outcomes: green turned away in time, amber misjudged, red caught, blue ate the ghost, grey nothing to judge. */
	import { ORDER, TONE, WORDS, mixWords } from './outcomes';

	interface Props { outcomes: Record<string, number>; height?: number }
	let { outcomes, height = 6 }: Props = $props();
	const total = $derived(ORDER.reduce((n, o) => n + (outcomes[o] ?? 0), 0));
	const parts = $derived(ORDER.filter((o) => (outcomes[o] ?? 0) > 0).map((o) => ({ o, n: outcomes[o] })));
</script>

{#if total > 0}
	<span class="bar" style:height="{height}px" role="img" aria-label={mixWords(outcomes, 8)} title={mixWords(outcomes, 8)}>
		{#each parts as p (p.o)}<span class={TONE[p.o]} style:flex-grow={p.n} title="{p.n} {WORDS[p.o]}"></span>{/each}
	</span>
{/if}

<style>
	.bar { display: flex; gap: 1px; width: 100%; border-radius: 2px; overflow: hidden; }
	.bar > span { flex-basis: 0; min-width: 3px; background: var(--ink-faint); }
	.good { background: var(--good) !important; }
	.warn { background: var(--warn) !important; }
	.bad { background: var(--bad) !important; }
	.catch { background: var(--scared) !important; }
	.dim { opacity: 0.6; }
</style>
