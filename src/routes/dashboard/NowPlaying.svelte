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
	}
	let { lastAt, now, source }: Props = $props();
	const playing = useQuery(api.presence.nowPlaying, {});
	const rows = $derived((playing.data ?? []).filter((r) => r.source === source));
	const fresh = $derived(lastAt !== null && now - lastAt < 60_000);
</script>

<div class="np" aria-live="polite">
	<Badge tone={rows.length ? 'live' : 'neutral'}>{rows.length ? 'Live' : 'Idle'}</Badge>
	{#if rows.length}
		<span class="who">
			{rows.length} playing now:
			{#each rows.slice(0, 4) as r, i (r.sessionKey)}
				<span class="p">
					{condition(r.cue).code} {condition(r.cue).name}{#if r.source === 'bot'} <Badge tone="sim">sim</Badge>{/if}{i < Math.min(rows.length, 4) - 1 ? ',' : ''}
				</span>
			{/each}
			{#if rows.length > 4}<span class="p">and {rows.length - 4} more</span>{/if}
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
	.last {
		margin-left: auto;
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}
	.last.fresh {
		color: var(--good);
	}
</style>
