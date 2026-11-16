<script lang="ts" generics="V extends string | number">
	/**
	 * Native select, styled. Options may be grouped by passing `group`.
	 *   <Select options={[{ value: 'all', label: 'All cues' }]} bind:value />
	 */
	import type { HTMLSelectAttributes } from 'svelte/elements';
	interface Option {
		value: V;
		label: string;
		group?: string;
		disabled?: boolean;
	}
	type Props = Omit<HTMLSelectAttributes, 'value' | 'size'> & {
		options: Option[];
		value: V;
		size?: 'sm' | 'md';
	};
	let { options, value = $bindable(), size = 'md', class: cls = '', ...rest }: Props = $props();

	const groups = $derived.by(() => {
		const out: { name: string | undefined; items: Option[] }[] = [];
		for (const o of options) {
			const last = out[out.length - 1];
			if (last && last.name === o.group) last.items.push(o);
			else out.push({ name: o.group, items: [o] });
		}
		return out;
	});
</script>

<span class="wrap {size} {cls}">
	<select bind:value {...rest}>
		{#each groups as g, i (i)}
			{#if g.name}
				<optgroup label={g.name}>
					{#each g.items as o (o.value)}<option value={o.value} disabled={o.disabled}>{o.label}</option>{/each}
				</optgroup>
			{:else}
				{#each g.items as o (o.value)}<option value={o.value} disabled={o.disabled}>{o.label}</option>{/each}
			{/if}
		{/each}
	</select>
	<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
</span>

<style>
	.wrap {
		position: relative;
		display: inline-flex;
		max-width: 100%;
	}
	select {
		appearance: none;
		width: 100%;
		height: 40px;
		padding: 0 36px 0 12px;
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--ink);
		font-size: var(--text-md);
		cursor: pointer;
	}
	.sm select {
		height: 32px;
		padding-left: 10px;
		font-size: var(--text-sm);
		border-radius: var(--radius-sm);
	}
	select:hover { border-color: var(--ink-faint); }
	select:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	svg {
		position: absolute;
		right: 12px;
		top: 50%;
		translate: 0 -50%;
		color: var(--ink-dim);
		pointer-events: none;
	}
	option, optgroup { background: var(--surface-2); color: var(--ink); }
</style>
