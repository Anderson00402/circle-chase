<script lang="ts">
	/**
	 * One headline number. Always pass `n` (or put the sample size in `sub`) for rates: the study's
	 * honesty rules say no rate is shown without its sample size.
	 *   <Stat label="Caught rate" value="18" unit="%" interval="95% CI 9-31%" sub="of 42 engaged trials" />
	 */
	import type { Snippet } from 'svelte';
	import InfoTip from './InfoTip.svelte';
	interface Props {
		label: string;
		/** Already formatted; null or undefined shows a dash (loading or no data). */
		value: string | number | null | undefined;
		unit?: string;
		sub?: string;
		/** e.g. "95% CI 12-31%" */
		interval?: string;
		/** e.g. "+4.1 pts vs no signal" */
		delta?: string;
		/** Colour of the delta: good, bad or neutral. */
		deltaTone?: 'good' | 'bad' | 'neutral';
		/** Definition shown in an InfoTip next to the label. */
		info?: string;
		/** Colour of the number. */
		tone?: 'ink' | 'accent' | 'good' | 'bad' | 'warn' | 'sim';
		size?: 'md' | 'lg';
		/** Extra content under the number (a sparkline, a badge). */
		children?: Snippet;
	}
	let {
		label,
		value,
		unit,
		sub,
		interval,
		delta,
		deltaTone = 'neutral',
		info,
		tone = 'ink',
		size = 'md',
		children
	}: Props = $props();
	const empty = $derived(value === null || value === undefined || value === '');
</script>

<div class="stat {size}">
	<div class="label">
		<span>{label}</span>
		{#if info}<InfoTip term={label}>{info}</InfoTip>{/if}
	</div>
	<div class="value tone-{tone}" class:empty>
		<span class="num">{empty ? '–' : value}</span>{#if unit && !empty}<span class="unit">{unit}</span>{/if}
	</div>
	{#if interval || delta}
		<div class="meta">
			{#if interval}<span class="num interval">{interval}</span>{/if}
			{#if delta}<span class="num delta {deltaTone}">{delta}</span>{/if}
		</div>
	{/if}
	{#if sub}<div class="sub">{sub}</div>{/if}
	{#if children}{@render children()}{/if}
</div>

<style>
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.label {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--ink-dim);
		font-size: var(--text-sm);
		font-weight: 600;
	}
	.value {
		display: flex;
		align-items: baseline;
		gap: 3px;
		font-size: 2rem;
		font-weight: 600;
		line-height: 1.1;
		letter-spacing: -0.02em;
	}
	.lg .value { font-size: 2.75rem; }
	.unit {
		font-family: var(--font-mono);
		font-size: 0.5em;
		font-weight: 500;
		color: var(--ink-dim);
		letter-spacing: 0;
	}
	.empty { color: var(--ink-faint); }
	.tone-accent { color: var(--accent); }
	.tone-good { color: var(--good); }
	.tone-bad { color: var(--bad); }
	.tone-warn { color: var(--warn); }
	.tone-sim { color: var(--sim); }
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		font-size: var(--text-xs);
		color: var(--ink-dim);
	}
	.delta.good { color: var(--good); }
	.delta.bad { color: var(--bad); }
	.sub {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
</style>
