<script lang="ts">
	/**
	 * Label + control + hint/error. The control receives the id to put on its input:
	 *   <Field label="Cue">{#snippet children(id)}<Select {id} options={...} bind:value />{/snippet}</Field>
	 */
	import type { Snippet } from 'svelte';
	interface Props {
		label: string;
		hint?: string;
		error?: string;
		/** Label above (default) or beside the control. */
		inline?: boolean;
		children: Snippet<[string]>;
	}
	let { label, hint, error, inline = false, children }: Props = $props();
	const id = $props.id();
</script>

<div class="field" class:inline>
	<label for={id}>{label}</label>
	<div class="control">
		{@render children(id)}
		{#if error}<p class="msg error" role="alert">{error}</p>
		{:else if hint}<p class="msg">{hint}</p>{/if}
	</div>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.inline {
		flex-direction: row;
		align-items: center;
		gap: var(--space-3);
	}
	label {
		color: var(--ink-dim);
		font-size: var(--text-sm);
		font-weight: 600;
		white-space: nowrap;
	}
	.msg {
		margin-top: 6px;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.error { color: var(--bad); }
</style>
