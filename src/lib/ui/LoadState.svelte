<script lang="ts">
	/**
	 * What a page says while its data has not arrived, in three distinct states:
	 * - lost connection: "Can't reach the database" (only then);
	 * - a query that failed: "Could not load ..." with the reason;
	 * - slow (connected, still waiting after a few seconds): "Still loading ...".
	 * Otherwise a plain "Loading ..." line. Pair with `slow()` from connection.svelte.ts.
	 */
	import EmptyState from './EmptyState.svelte';

	interface Props {
		/** From `slow(() => q.isLoading)`. */
		wait: { readonly offline: boolean; readonly late: boolean };
		/** The query's error, if it failed. */
		error?: Error | null | undefined;
		/** What is loading, plural or with its article: "the replays", "this replay". */
		what: string;
		icon?: 'maze' | 'chart' | 'replay' | 'study';
		compact?: boolean;
	}
	let { wait, error = null, what, icon = 'maze', compact = true }: Props = $props();

	/** The server's own words, without the request id and stack Convex wraps around them. */
	const reason = $derived.by(() => {
		if (!error) return '';
		const m = (error.message ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[Request ID|^at |Called by client/.test(l));
		const line = (m.find((l) => /Error:/.test(l)) ?? m[0] ?? '').replace(/^.*?(Uncaught )?Error:\s*/, '');
		return line.slice(0, 160);
	});
</script>

{#if error}
	<EmptyState title="Could not load {what}" {icon} {compact}>
		The database is connected, but the request failed{reason ? `: ${reason}` : ''}. Reload the page to try again.
	</EmptyState>
{:else if wait.offline}
	<EmptyState title="Can't reach the database" {icon} {compact}>
		The connection to the database is lost. {what.charAt(0).toUpperCase() + what.slice(1)} will appear as soon as it is back; nothing needs to be reloaded.
	</EmptyState>
{:else if wait.late}
	<p class="status" role="status">Still loading {what}. The database is connected but slow to answer; this fills in by itself.</p>
{:else}
	<p class="status" role="status">Loading {what}&hellip;</p>
{/if}

<style>
	.status { color: var(--ink-dim); font-size: var(--text-sm); margin: 0; padding: var(--space-4) 0; }
</style>
