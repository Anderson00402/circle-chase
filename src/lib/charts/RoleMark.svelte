<script lang="ts">
	/**
	 * The marker of a condition role (or any shape) as a small inline SVG, for legends, chips and
	 * table cells. Hollow = thin data, or a reference drawn as an outline.
	 *   <RoleMark shape="diamond" color="var(--chart-reference)" />
	 */
	import type { Shape } from './encoding';
	import { shapePath } from './shapes';
	interface Props {
		shape: Shape;
		color: string;
		size?: number;
		hollow?: boolean;
		label?: string;
	}
	let { shape, color, size = 12, hollow = false, label }: Props = $props();
	const r = $derived(size / 2 - 1.5);
</script>

<svg
	class="mark"
	width={size}
	height={size}
	viewBox="0 0 {size} {size}"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
>
	<path
		d={shapePath(shape, size / 2, size / 2, r)}
		fill={hollow ? 'var(--surface)' : color}
		stroke={color}
		stroke-width={hollow ? 1.6 : 1}
	/>
</svg>

<style>
	.mark {
		display: inline-block;
		flex-shrink: 0;
		vertical-align: middle;
		overflow: visible;
	}
</style>
