<script lang="ts">
	/**
	 * The top bar's small status: is the database reachable, and are the run's own writes saved?
	 * A dot and a word; the full sentence is in the tooltip and for screen readers.
	 */
	import { connection, CONN_LABEL } from './connection.svelte.ts';

	interface Props {
		/** Writes waiting in the outbox, and whether they keep failing (null when unknown). */
		saving?: { pending: number; failing: boolean; failingCount?: number } | null;
	}
	let { saving = null }: Props = $props();

	const s = $derived(connection.status);
	const tone = $derived(s === 'connected' ? (saving?.failing ? 'warn' : 'good') : s === 'offline' ? 'bad' : 'warn');
	const words = $derived.by(() => {
		if (s !== 'connected') return CONN_LABEL[s];
		if (saving?.failing) return `Saving is failing${saving.failingCount ? ` (${saving.failingCount})` : ''}`;
		if (saving && saving.pending > 0) return `Saving ${saving.pending}`;
		return 'Saved';
	});
	const title = $derived.by(() => {
		if (s === 'offline') return "Can't reach the database. Anything played is kept on this machine and sent when it is back.";
		if (s === 'reconnecting') return 'Lost the database for a moment: reconnecting.';
		if (s === 'connecting') return 'Connecting to the database.';
		if (saving?.failing) return 'Connected, but some writes keep failing. They are kept and tried again.';
		if (saving && saving.pending > 0) return `Connected. ${saving.pending} write${saving.pending === 1 ? '' : 's'} on the way.`;
		return 'Connected to the database. Everything is saved.';
	});
</script>

<span class="conn {tone}" {title} role="status" aria-live="polite">
	<span class="led" aria-hidden="true"></span><span class="w">{words}</span>
</span>

<style>
	.conn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 10px;
		border-radius: var(--radius-pill);
		border: 1px solid var(--rule);
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		color: var(--ink-dim);
	}
	.led { width: 7px; height: 7px; border-radius: 50%; background: var(--good); flex: none; }
	.warn .led { background: var(--warn); }
	.bad .led { background: var(--bad); }
	.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 40%, transparent); }
	.bad { color: var(--bad); border-color: color-mix(in srgb, var(--bad) 45%, transparent); background: var(--bad-soft); }
	@media (max-width: 760px) {
		.good .w { display: none; }
		.conn.good { padding: 0 6px; border: 0; }
	}
</style>
