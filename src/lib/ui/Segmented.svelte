<script lang="ts" generics="V extends string | number">
	/**
	 * A row of mutually exclusive options (a radio group that looks like a switch).
	 *   <Segmented label="Data" options={[{ value: 'human', label: 'Humans' }, { value: 'bot', label: 'Simulated' }]} bind:value />
	 */
	interface Option {
		value: V;
		label: string;
		/** Optional count or hint shown dimmed after the label. */
		hint?: string | number;
	}
	interface Props {
		options: Option[];
		value: V;
		/** Accessible name for the group. */
		label: string;
		size?: 'sm' | 'md';
		onchange?: (value: V) => void;
	}
	let { options, value = $bindable(), label, size = 'md', onchange }: Props = $props();
	const name = $props.id();

	function pick(v: V) {
		value = v;
		onchange?.(v);
	}
</script>

<div class="seg {size}" role="radiogroup" aria-label={label}>
	{#each options as o (o.value)}
		<label class:on={o.value === value}>
			<input type="radio" {name} value={o.value} checked={o.value === value} onchange={() => pick(o.value)} />
			<span>{o.label}</span>
			{#if o.hint !== undefined}<span class="hint num">{o.hint}</span>{/if}
		</label>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		max-width: 100%;
		overflow-x: auto;
		padding: 3px;
		gap: 2px;
		border-radius: var(--radius-md);
		background: var(--bg);
		border: 1px solid var(--rule);
	}
	label {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 12px;
		border-radius: 7px;
		color: var(--ink-dim);
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
		transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
	}
	.sm label { height: 26px; padding: 0 10px; font-size: var(--text-xs); }
	label:hover { color: var(--ink); }
	label.on {
		background: var(--surface-3);
		color: var(--ink);
		box-shadow: inset 0 0 0 1px var(--rule-strong);
	}
	label:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.hint {
		color: var(--ink-faint);
		font-size: 0.85em;
	}
</style>
