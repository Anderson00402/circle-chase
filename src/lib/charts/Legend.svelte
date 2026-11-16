<script lang="ts">
	/**
	 * A one-line legend: a mark and a label per item. Marks are a role shape, a filled swatch (with
	 * optional hatching) or a line (with optional dash). Labels stay in text colour.
	 */
	import type { Shape } from './encoding';
	import RoleMark from './RoleMark.svelte';
	export interface LegendItem {
		label: string;
		color: string;
		kind?: 'shape' | 'swatch' | 'line' | 'band';
		shape?: Shape;
		hatch?: boolean;
		dash?: string;
		hollow?: boolean;
	}
	interface Props {
		items: LegendItem[];
		label?: string;
	}
	let { items, label = 'Legend' }: Props = $props();
	const pid = $props.id();
</script>

<ul class="legend" aria-label={label}>
	{#each items as it, i (it.label)}
		<li>
			{#if (it.kind ?? 'shape') === 'shape'}
				<RoleMark shape={it.shape ?? 'circle'} color={it.color} hollow={it.hollow} />
			{:else if it.kind === 'line'}
				<svg width="22" height="10" aria-hidden="true">
					<line x1="1" y1="5" x2="21" y2="5" stroke={it.color} stroke-width="2" stroke-dasharray={it.dash} stroke-linecap="round" />
				</svg>
			{:else}
				<svg width="14" height="12" aria-hidden="true">
					{#if it.hatch}
						<defs>
							<pattern id="{pid}-h{i}" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
								<rect width="4" height="4" fill={it.color} opacity="0.35" />
								<line x1="0" y1="0" x2="0" y2="4" stroke={it.color} stroke-width="2.2" />
							</pattern>
						</defs>
					{/if}
					<rect
						x="0.5"
						y="0.5"
						width="13"
						height="11"
						rx="3"
						fill={it.hatch ? `url(#${pid}-h${i})` : it.color}
						opacity={it.kind === 'band' ? 0.35 : 1}
					/>
				</svg>
			{/if}
			<span>{it.label}</span>
		</li>
	{/each}
</ul>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		padding: 0;
		list-style: none;
		color: var(--ink-dim);
		font-size: var(--text-xs);
	}
	li {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	svg {
		flex-shrink: 0;
	}
</style>
