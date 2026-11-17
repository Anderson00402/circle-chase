<script lang="ts">
	/**
	 * A strip saying who is playing right now (from presence heartbeats) and when the last power-up
	 * arrived. Shows only players of the page's data source: no simulated players in the human view.
	 */
	import { useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { Badge } from '#lib/ui/index.ts';
	import { ago, condition } from '#lib/charts/encoding.ts';

	interface Props {
		lastAt: number | null;
		now: number;
		source: 'human' | 'bot';
		/**
		 * Simulated view: the run shown is finished, so a simulated player playing now (a scripted
		 * check, a new run) is not in it. They are still listed, with that said.
		 */
		finished?: boolean;
		/** The database connection is lost: say so instead of "nobody is playing". */
		offline?: boolean;
	}
	let { lastAt, now, source, finished = false, offline = false }: Props = $props();
	const playing = useQuery(api.presence.nowPlaying, {});
	/**
	 * Heartbeats older than this (convex/presence.ts STALE_MS, plus one tick of the page clock) are a page that went away. The query's own cut-off is fixed when it
	 * last ran (a cached result does not age), so the page applies it again with its own clock.
	 */
	const STALE = 25_000;
	const rows = $derived((playing.data ?? []).filter((r) => r.source === source && now - r.updatedAt < STALE));
	const fresh = $derived(lastAt !== null && now - lastAt < 60_000);
</script>

<div class="np" aria-live="polite">
	<Badge tone={rows.length && !offline ? 'live' : 'neutral'}>{offline ? 'Offline' : rows.length ? 'Live' : 'Idle'}</Badge>
	{#if offline}
		<span class="who">Can't reach the database, so who is playing is unknown. This updates by itself when it is back.</span>
	{:else if rows.length}
		<span class="who">
			{rows.length} playing now:
			{#each rows.slice(0, 4) as r, i (r.sessionKey)}
				<span class="p">
					{condition(r.cue).code} {condition(r.cue).name}{#if r.source === 'bot'} <Badge tone="sim">sim</Badge>{/if}{i < Math.min(rows.length, 4) - 1 ? ',' : ''}
				</span>
			{/each}
			{#if rows.length > 4}<span class="p">and {rows.length - 4} more</span>{/if}
			{#if finished}<span class="note">(not part of the finished run shown here)</span>{/if}
		</span>
	{:else}
		<span class="who">{source === 'bot' ? 'No simulated players running right now.' : 'Nobody is playing right now. The page updates by itself when someone does.'}</span>
	{/if}
	{#if lastAt}<span class="last" class:fresh>Last power-up {ago(lastAt, now)}</span>{/if}
</div>

<style>
	.np {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px var(--space-3);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.who {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.p {
		color: var(--ink);
	}
	.note {
		color: var(--ink-faint);
	}
	.last {
		margin-left: auto;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.last.fresh {
		color: var(--good);
	}
</style>
