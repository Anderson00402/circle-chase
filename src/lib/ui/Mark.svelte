<script lang="ts">
	/**
	 * The Circle Chase mark: a countdown ring that is almost empty, a chaser slipping into the gap,
	 * and a scared blue dot in the middle. Same drawing as src/lib/assets/favicon.svg.
	 */
	interface Props {
		size?: number;
		/** Draw the dark tile behind the mark (for icons); off when it sits on a surface. */
		tile?: boolean;
		title?: string;
	}
	let { size = 28, tile = false, title }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 32 32"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title}
>
	{#if tile}<rect width="32" height="32" rx="8" fill="var(--bg)" />{/if}
	<path
		d="M16 6.5a9.5 9.5 0 1 1-9.03 6.56"
		fill="none"
		stroke="var(--player)"
		stroke-width="3.2"
		stroke-linecap="round"
	/>
	<circle cx="9.6" cy="7.9" r="2.6" fill="var(--hunter)" />
	<circle cx="16" cy="16" r="3" fill="var(--scared)" />
</svg>
