<script lang="ts" generics="V extends string">
	/**
	 * Tabs that switch a panel. Arrow keys move between tabs, Home and End jump.
	 *   <Tabs tabs={[{ id: 'overview', label: 'Overview' }, { id: 'trials', label: 'Trials' }]} bind:value>
	 *     {#snippet panel(id)} ... {/snippet}
	 *   </Tabs>
	 */
	import type { Snippet } from 'svelte';
	interface Tab {
		id: V;
		label: string;
		hint?: string | number;
	}
	interface Props {
		tabs: Tab[];
		value: V;
		label: string;
		panel: Snippet<[V]>;
	}
	let { tabs, value = $bindable(), label, panel }: Props = $props();
	const uid = $props.id();
	let list: HTMLDivElement;

	function onkey(e: KeyboardEvent) {
		const i = tabs.findIndex((t) => t.id === value);
		let j = i;
		if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === 'Home') j = 0;
		else if (e.key === 'End') j = tabs.length - 1;
		else return;
		e.preventDefault();
		value = tabs[j].id;
		(list.querySelectorAll('[role="tab"]')[j] as HTMLElement | undefined)?.focus();
	}
</script>

<div class="tabs">
	<div class="list" role="tablist" aria-label={label} bind:this={list} tabindex="-1" onkeydown={onkey}>
		{#each tabs as t (t.id)}
			<button
				type="button"
				role="tab"
				id="{uid}-tab-{t.id}"
				aria-selected={t.id === value}
				aria-controls="{uid}-panel"
				tabindex={t.id === value ? 0 : -1}
				onclick={() => (value = t.id)}
			>
				{t.label}{#if t.hint !== undefined}<span class="hint num">{t.hint}</span>{/if}
			</button>
		{/each}
	</div>
	<div class="panel" role="tabpanel" id="{uid}-panel" aria-labelledby="{uid}-tab-{value}" tabindex="0">
		{@render panel(value)}
	</div>
</div>

<style>
	.list {
		display: flex;
		gap: var(--space-5);
		overflow-x: auto;
		border-bottom: 1px solid var(--rule);
		scrollbar-width: none;
	}
	.list:focus { outline: none; }
	button {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 40px;
		padding: 0 2px;
		border: 0;
		background: none;
		color: var(--ink-dim);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	button:hover { color: var(--ink); }
	button[aria-selected='true'] { color: var(--ink); }
	button[aria-selected='true']::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 2px;
		background: var(--accent);
	}
	.hint {
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.panel {
		padding-top: var(--space-5);
	}
	.panel:focus-visible { outline-offset: 4px; }
</style>
