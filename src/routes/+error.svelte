<script lang="ts">
	/** Any page that does not exist, or that failed to load: say so plainly and offer the way back. */
	import { page } from '$app/state';
	import { Button, EmptyState, Page } from '#lib/ui/index.ts';

	const missing = $derived(page.status === 404);
	const title = $derived(missing ? 'There is no page here' : 'Something went wrong');
</script>

<svelte:head><title>{missing ? 'Page not found' : 'Error'} · Circle Chase</title></svelte:head>

<Page width="narrow">
	<div class="wrap">
		<EmptyState {title}>
			{#if missing}
				<p>Nothing lives at <code>{page.url.pathname}</code>. It may be an old link: the study now runs from the console.</p>
			{:else}
				<p>The page could not be shown{page.error?.message ? `: ${page.error.message}` : '.'} Nothing that was already saved is lost.</p>
			{/if}
			{#snippet actions()}
				<Button variant="primary" href="/">Back to the run console</Button>
				<Button variant="ghost" href="/replays">Replays</Button>
				<Button variant="ghost" href="/dashboard">Dashboard</Button>
			{/snippet}
		</EmptyState>
		<p class="code num">Error {page.status}</p>
	</div>
</Page>

<style>
	.wrap { padding-top: var(--space-7); display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
	code { font-family: var(--font-mono); font-size: 0.95em; color: var(--ink); overflow-wrap: anywhere; }
	.code { color: var(--ink-faint); font-size: var(--text-xs); }
</style>
