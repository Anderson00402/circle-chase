<script lang="ts" module>
	export interface Column<R> {
		key: string;
		label: string;
		/** Right-aligned, mono, tabular figures. */
		numeric?: boolean;
		/** Text for the cell. Defaults to row[key]. */
		format?: (row: R) => string | number | null | undefined;
		/** Small unit after the header label, e.g. "s" or "%". */
		unit?: string;
		/** Definition shown in an InfoTip next to the header. */
		info?: string;
		/** CSS width, e.g. "120px" or "20%". */
		width?: string;
	}
</script>

<script lang="ts" generics="T">
	/**
	 * A plain, readable table: sticky header, numeric columns right-aligned in mono, optional
	 * definitions on headers. Pass `cell` to render a column yourself (chips, badges, bars).
	 *   <DataTable rows={trials} key={(r) => r._id} columns={[
	 *     { key: 'cue', label: 'Cue' },
	 *     { key: 'left', label: 'Time left', numeric: true, format: (r) => r.left.toFixed(2), unit: 's' }
	 *   ]} />
	 */
	import type { Snippet } from 'svelte';
	import InfoTip from './InfoTip.svelte';

	interface Props {
		columns: Column<T>[];
		rows: T[];
		key: (row: T) => string | number;
		/** Accessible caption; shown visually only if `showCaption`. */
		caption: string;
		showCaption?: boolean;
		/** Scroll inside the table past this height (the header stays put). */
		maxHeight?: string;
		/** Shown when there are no rows. */
		empty?: string;
		cell?: Snippet<[T, Column<T>]>;
		onrowclick?: (row: T) => void;
		dense?: boolean;
	}
	let {
		columns,
		rows,
		key,
		caption,
		showCaption = false,
		maxHeight,
		empty = 'Nothing to show yet.',
		cell,
		onrowclick,
		dense = false
	}: Props = $props();

	function text(row: T, c: Column<T>) {
		const v = c.format ? c.format(row) : (row as Record<string, unknown>)[c.key];
		return v === null || v === undefined || v === '' ? '–' : String(v);
	}
</script>

<div class="scroll" style:max-height={maxHeight}>
	<table class:dense class:clickable={!!onrowclick}>
		<caption class:visually-hidden={!showCaption}>{caption}</caption>
		<colgroup>
			{#each columns as c (c.key)}<col style:width={c.width} />{/each}
		</colgroup>
		<thead>
			<tr>
				{#each columns as c (c.key)}
					<th scope="col" class:numeric={c.numeric}>
						<span class="h">
							{c.label}{#if c.unit}<span class="unit">{c.unit}</span>{/if}
							{#if c.info}<InfoTip term={c.label} align={c.numeric ? 'end' : 'start'}>{c.info}</InfoTip>{/if}
						</span>
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (key(row))}
				<tr
					onclick={onrowclick ? () => onrowclick(row) : undefined}
					onkeydown={onrowclick ? (e) => e.key === 'Enter' && onrowclick(row) : undefined}
					tabindex={onrowclick ? 0 : undefined}
				>
					{#each columns as c (c.key)}
						<td class:numeric={c.numeric}>
							{#if cell}{@render cell(row, c)}{:else}{text(row, c)}{/if}
						</td>
					{/each}
				</tr>
			{:else}
				<tr><td class="none" colspan={columns.length}>{empty}</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow: auto;
		max-width: 100%;
	}
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}
	caption {
		padding: 0 var(--space-4) var(--space-2);
		color: var(--ink-dim);
		text-align: left;
	}
	th {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 10px var(--space-4);
		background: var(--surface);
		border-bottom: 1px solid var(--rule-strong);
		color: var(--ink-dim);
		font-size: var(--text-xs);
		font-weight: 650;
		letter-spacing: 0.02em;
		text-align: left;
		white-space: nowrap;
	}
	.h {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.unit {
		margin-left: 3px;
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-weight: 500;
	}
	td {
		padding: 10px var(--space-4);
		border-bottom: 1px solid var(--rule);
		vertical-align: middle;
	}
	th:first-child, td:first-child { padding-left: var(--space-5); }
	th:last-child, td:last-child { padding-right: var(--space-5); }
	.dense th, .dense td { padding-top: 6px; padding-bottom: 6px; }
	tbody tr:last-child td { border-bottom: 0; }
	.numeric {
		text-align: right;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums slashed-zero;
	}
	th.numeric { font-family: var(--font-body); }
	th.numeric .h { justify-content: flex-end; }
	tbody tr:hover td { background: rgba(255, 255, 255, 0.025); }
	.clickable tbody tr { cursor: pointer; }
	.clickable tbody tr:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }
	.none {
		padding: var(--space-6);
		color: var(--ink-faint);
		text-align: center;
	}
</style>
