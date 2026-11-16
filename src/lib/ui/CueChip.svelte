<script lang="ts">
	/**
	 * A condition's code and name, coloured by its role: references neutral, the timer bar baseline
	 * blue, the ten ideas yellow. Use it wherever a cue is named (tables, legends, filters, cards).
	 *   <CueChip cue={cueById('timer-bar')} />   <CueChip cue={c} href="/play/{c.id}" />
	 */
	import type { Cue } from '#lib/game/types.ts';
	interface Props {
		cue: Pick<Cue, 'code' | 'name' | 'role'>;
		href?: string;
		/** Hide the name and show the code only (the name stays for screen readers and the tooltip). */
		compact?: boolean;
		size?: 'sm' | 'md';
		/** Let a long name wrap onto two lines instead of being cut (cards). */
		wrap?: boolean;
	}
	let { cue, href, compact = false, size = 'md', wrap = false }: Props = $props();
	const ROLE_LABEL = { reference: 'Reference', baseline: 'Baseline', idea: 'Idea' } as const;
</script>

<svelte:element
	this={href ? 'a' : 'span'}
	{href}
	class="chip {cue.role} {size}"
	class:wrap
	title="{ROLE_LABEL[cue.role]} {cue.code}: {cue.name}"
>
	<span class="code" aria-hidden={compact ? undefined : 'true'}>{cue.code}</span>
	{#if compact}<span class="visually-hidden">{cue.name}</span>{:else}<span class="name">{cue.name}</span>{/if}
</svelte:element>

<style>
	.chip {
		--c: var(--role-reference);
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		max-width: 100%;
		color: var(--ink);
		text-decoration: none;
		vertical-align: middle;
	}
	.baseline { --c: var(--role-baseline); }
	.idea { --c: var(--role-idea); }
	.code {
		display: inline-grid;
		place-items: center;
		flex-shrink: 0;
		min-width: 24px;
		height: 24px;
		padding: 0 5px;
		border-radius: 6px;
		border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
		background: color-mix(in srgb, var(--c) 14%, transparent);
		color: var(--c);
		font-family: var(--font-mono);
		font-size: 12px;
		font-weight: 700;
		line-height: 1;
	}
	.reference .code { border-style: dashed; }
	.sm .code { min-width: 20px; height: 20px; font-size: 11px; border-radius: 5px; }
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.sm .name { font-size: var(--text-sm); }
	.wrap .name { white-space: normal; line-height: 1.25; }
	a.chip:hover .name { text-decoration: underline; text-underline-offset: 3px; }
</style>
