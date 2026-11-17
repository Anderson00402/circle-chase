<script lang="ts">
	/**
	 * What a dashboard panel says while its query has no data, in distinct states:
	 * - the query failed (an error, or the server's time limit): says so in its own words, with Retry;
	 * - the connection is lost: "Can't reach the database" (only then);
	 * - connected but slow: "Still loading ...";
	 * - otherwise a plain "Loading ...".
	 * Never "Loading" forever: a failed query always shows its error.
	 */
	import { Button } from '#lib/ui/index.ts';

	interface Props {
		/** The query's error, if it failed. */
		error?: Error | null;
		/** From `slow(() => q.isLoading)`. */
		wait: { readonly offline: boolean; readonly late: boolean };
		/** What is loading: "results", "every power-up". */
		what: string;
		onretry: () => void;
		/** Taller box (big panels), or a single line. */
		tall?: boolean;
	}
	let { error = null, wait, what, onretry, tall = false }: Props = $props();

	/** The server's own words, without the request id and stack Convex wraps around them. */
	const reason = $derived.by(() => {
		if (!error) return '';
		const lines = (error.message ?? '').split('\n').map((l) => l.trim()).filter((l) => l && !/^\[Request ID|^at |Called by client/.test(l));
		const line = (lines.find((l) => /Error:/.test(l)) ?? lines[0] ?? '').replace(/^.*?(Uncaught )?(Server )?Error:\s*/, '');
		return line.slice(0, 180).replace(/[.\s]+$/, '');
	});
	const timedOut = $derived(/timed out|time limit|maximum duration/i.test(reason));
</script>

<div class="qs" class:tall role="status" aria-live="polite">
	{#if error}
		<p class="err">
			<b>Could not load {what}.</b>
			{timedOut
				? 'The database is connected, but this question took longer than its time limit (often right after the database starts).'
				: `The database is connected, but the request failed${reason ? `: ${reason}` : ''}.`}
		</p>
		<Button size="sm" variant="quiet" onclick={onretry}>Retry</Button>
	{:else if wait.offline}
		<p><b>Can't reach the database.</b> The connection is lost; {what} will appear as soon as it is back.</p>
	{:else if wait.late}
		<p>Still loading {what}. The database is connected but slow to answer; this fills in by itself.</p>
	{:else}
		<p>Loading {what}…</p>
	{/if}
</div>

<style>
	.qs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2) var(--space-3);
		padding: var(--space-5) 0;
		color: var(--ink-faint);
		text-align: center;
	}
	.qs.tall {
		min-height: 160px;
	}
	p {
		max-width: 70ch;
		margin: 0;
	}
	b {
		color: var(--ink);
	}
	.err {
		color: var(--ink-dim);
	}
</style>
