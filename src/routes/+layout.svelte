<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import { setupConvex } from 'convex-svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	setupConvex(import.meta.env.PUBLIC_CONVEX_URL);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>Circle Chase</title>
</svelte:head>

{@render children()}

<style>
	:global(html, body) { margin: 0; background: #0a1024; color: #eef3ff; font: 15px/1.5 system-ui, sans-serif; }
</style>
