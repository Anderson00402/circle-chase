<script lang="ts">
	/**
	 * A 1-7 agreement scale for the questionnaire. Native radios: Tab reaches the group, arrow keys
	 * move, and number keys 1-7 pick directly while the group has focus.
	 *   <Scale7 question="I could tell when the power was about to run out" low="Not at all" high="Completely" bind:value />
	 */
	interface Props {
		question: string;
		low: string;
		high: string;
		/** null until the person answers. */
		value: number | null;
		required?: boolean;
	}
	let { question, low, high, value = $bindable(), required = false }: Props = $props();
	const name = $props.id();
	const POINTS = [1, 2, 3, 4, 5, 6, 7];

	function onkey(e: KeyboardEvent) {
		const n = Number(e.key);
		if (n >= 1 && n <= 7) {
			value = n;
			(e.currentTarget as HTMLElement).querySelector<HTMLInputElement>(`input[value="${n}"]`)?.focus();
			e.preventDefault();
		}
	}
</script>

<fieldset class="scale">
	<legend>{question}</legend>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="row" onkeydown={onkey}>
		{#each POINTS as p (p)}
			<label class:on={value === p}>
				<input type="radio" {name} value={p} checked={value === p} onchange={() => (value = p)} {required} />
				<span class="num">{p}</span>
				{#if p === 1}<span class="visually-hidden">{low}</span>{/if}
				{#if p === 7}<span class="visually-hidden">{high}</span>{/if}
			</label>
		{/each}
	</div>
	<div class="ends" aria-hidden="true">
		<span>{low}</span>
		<span>{high}</span>
	</div>
</fieldset>

<style>
	fieldset {
		margin: 0;
		padding: 0;
		border: 0;
		min-width: 0;
	}
	legend {
		margin-bottom: var(--space-3);
		padding: 0;
		font-size: var(--text-lg);
		font-weight: 650;
		line-height: 1.35;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 6px;
	}
	label {
		position: relative;
		display: grid;
		place-items: center;
		height: 48px;
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--ink-dim);
		font-size: var(--text-lg);
		font-weight: 600;
		cursor: pointer;
		transition: background var(--dur) var(--ease), border-color var(--dur) var(--ease), color var(--dur) var(--ease);
	}
	label:hover {
		border-color: var(--ink-faint);
		color: var(--ink);
	}
	label.on {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--on-accent);
	}
	label:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
	input {
		position: absolute;
		opacity: 0;
		pointer-events: none;
	}
	.ends {
		display: flex;
		justify-content: space-between;
		gap: var(--space-4);
		margin-top: 8px;
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.ends span:last-child { text-align: right; }
</style>
