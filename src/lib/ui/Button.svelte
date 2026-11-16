<script lang="ts">
	/**
	 * Button, or a link styled as one when `href` is set.
	 * primary: the one main action in a view. quiet: everything else. danger: deletes or ends something.
	 */
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Common = {
		variant?: 'primary' | 'quiet' | 'danger' | 'ghost';
		size?: 'sm' | 'md' | 'lg';
		/** Stretch to the width of the container. */
		block?: boolean;
		children: Snippet;
	};
	type Props = Common &
		((Omit<HTMLAnchorAttributes, 'children'> & { href: string }) | (Omit<HTMLButtonAttributes, 'children'> & { href?: undefined }));

	let { variant = 'quiet', size = 'md', block = false, children, class: cls = '', ...rest }: Props = $props();
</script>

{#if rest.href !== undefined}
	<a class="btn {variant} {size} {cls}" class:block {...rest as HTMLAnchorAttributes}>{@render children()}</a>
{:else}
	<button type="button" class="btn {variant} {size} {cls}" class:block {...rest as HTMLButtonAttributes}>{@render children()}</button>
{/if}

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		height: 40px;
		padding: 0 16px;
		border-radius: var(--radius-md);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font-family: var(--font-body);
		font-size: var(--text-md);
		font-weight: 650;
		line-height: 1;
		text-decoration: none;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--dur) var(--ease),
			border-color var(--dur) var(--ease),
			transform var(--dur) var(--ease);
	}
	.btn:hover {
		background: var(--surface-3);
		border-color: var(--ink-faint);
		text-decoration: none;
	}
	.btn:active {
		transform: translateY(1px);
	}
	.btn:disabled,
	.btn[aria-disabled='true'] {
		opacity: 0.45;
		cursor: not-allowed;
		pointer-events: none;
	}
	.sm { height: 32px; padding: 0 12px; font-size: var(--text-sm); border-radius: var(--radius-sm); }
	.lg { height: 48px; padding: 0 22px; font-size: var(--text-lg); }
	.block { display: flex; width: 100%; }

	.primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	.primary:hover {
		background: #ffe27a;
		border-color: #ffe27a;
		box-shadow: var(--glow-accent);
	}
	.danger {
		background: transparent;
		border-color: color-mix(in srgb, var(--bad) 55%, transparent);
		color: var(--bad);
	}
	.danger:hover {
		background: var(--bad-soft);
		border-color: var(--bad);
	}
	.ghost {
		background: transparent;
		border-color: transparent;
		color: var(--ink-dim);
	}
	.ghost:hover {
		background: var(--surface-2);
		border-color: transparent;
		color: var(--ink);
	}
</style>
