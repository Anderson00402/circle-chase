<script lang="ts">
	/**
	 * Writes the database kept rejecting ("parked" by the outbox), made visible: a small button that
	 * says how many, and a panel that lists each one (what it is, whose, the server's error, since
	 * when) with "Try again now", "Download as JSON" and "Discard" (asks first). Shows nothing while
	 * there are none. Mount it beside the save indicator:
	 *   <OutboxParked />   (import OutboxParked from '#lib/study/outbox-parked.svelte')
	 */
	import Button from '../ui/Button.svelte';
	import Dialog from '../ui/Dialog.svelte';
	import { discardParked, outboxStatus, parkedJson, retryParked } from './outbox.svelte.ts';

	let open = $state(false);
	/** The write whose "Discard" was pressed once and waits for the confirmation. */
	let confirming = $state<string | null>(null);
	let retried = $state(false);

	const list = $derived(outboxStatus.parkedWrites);
	const n = $derived(list.length);

	function time(ms: number | null): string {
		if (!ms) return 'unknown';
		const d = new Date(ms);
		const today = new Date().toDateString() === d.toDateString();
		return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
	}

	function download(id?: string) {
		const blob = new Blob([parkedJson(id)], { type: 'application/json' });
		const a = document.createElement('a');
		a.href = URL.createObjectURL(blob);
		a.download = `circle-chase-rejected-writes-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	}

	function retry(id?: string) {
		retryParked(id);
		retried = true;
		setTimeout(() => (retried = false), 4000);
	}

	$effect(() => { if (n === 0) { open = false; confirming = null; } });
</script>

{#if n > 0}
	<button type="button" class="pill" onclick={() => (open = true)} title="The database refused {n === 1 ? 'a write' : `${n} writes`}. It is kept on this machine. Click to see it.">
		{n} {n === 1 ? 'write' : 'writes'} refused
	</button>
	<Dialog bind:open title={n === 1 ? 'A write the database refused' : `${n} writes the database refused`} width="lg">
		<p class="lead">
			The database turned {n === 1 ? 'this write' : 'these writes'} down several times, so {n === 1 ? 'it is' : 'they are'} not
			saved. {n === 1 ? 'It is' : 'They are'} kept on this machine and tried again every 5 minutes; the rest of the session was
			saved without {n === 1 ? 'it' : 'them'}. Download {n === 1 ? 'it' : 'them'} before discarding anything.
		</p>
		<ul class="list">
			{#each list as w (w.id)}
				<li>
					<div class="top">
						<strong>{w.what}</strong>
						{#if w.participant}<span class="who">{w.participant}</span>{/if}
						{#if w.cue}<span class="dim">case {w.cue}</span>{/if}
					</div>
					<p class="err">{w.error || 'No error text from the server.'}</p>
					<p class="dim small">
						First refused {time(w.firstErrorAt)}, set aside {time(w.parkedAt)}, last tried {time(w.lastTryAt)} ({w.tries} tries).
						{#if w.session}Session <code>{w.session.slice(0, 12)}</code>.{/if}
					</p>
					<div class="row">
						<Button size="sm" onclick={() => retry(w.id)}>Try again now</Button>
						<Button size="sm" onclick={() => download(w.id)}>Download as JSON</Button>
						{#if confirming === w.id}
							<span class="confirm">Discard it for good? It cannot be brought back.</span>
							<Button size="sm" variant="danger" onclick={() => { discardParked(w.id); confirming = null; }}>Discard</Button>
							<Button size="sm" variant="ghost" onclick={() => (confirming = null)}>Keep it</Button>
						{:else}
							<Button size="sm" variant="ghost" onclick={() => (confirming = w.id)}>Discard…</Button>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
		{#if retried}<p class="dim small" role="status">Trying again now. A write the database takes disappears from this list.</p>{/if}
		{#snippet actions()}
			{#if n > 1}
				<Button onclick={() => retry()}>Try all again now</Button>
				<Button onclick={() => download()}>Download all as JSON</Button>
			{/if}
			<Button variant="primary" onclick={() => (open = false)}>Close</Button>
		{/snippet}
	</Dialog>
{/if}

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		height: 26px;
		padding: 0 10px;
		border-radius: var(--radius-pill);
		border: 1px solid color-mix(in srgb, var(--bad) 45%, transparent);
		background: var(--bad-soft);
		color: var(--bad);
		font: inherit;
		font-size: var(--text-xs);
		font-weight: 600;
		white-space: nowrap;
		cursor: pointer;
	}
	.pill:focus-visible { outline: 2px solid var(--bad); outline-offset: 2px; }
	.lead { margin: 0 0 12px; color: var(--ink-dim); }
	.list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
	.list li { border: 1px solid var(--rule); border-radius: var(--radius, 8px); padding: 10px 12px; }
	.top { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; }
	.who { font-weight: 600; }
	.err { margin: 6px 0; font-family: var(--font-mono, monospace); font-size: var(--text-xs); overflow-wrap: anywhere; color: var(--bad); }
	.dim { color: var(--ink-dim); }
	.small { font-size: var(--text-xs); margin: 4px 0; }
	.row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 6px; }
	.confirm { font-size: var(--text-xs); color: var(--bad); }
</style>
