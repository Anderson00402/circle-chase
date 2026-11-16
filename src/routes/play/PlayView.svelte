<script lang="ts">
	/**
	 * Free play: the arcade game with any condition, measured, with the live measurement panel
	 * beside the board (under it on narrow screens). Used by /play (last condition played) and
	 * /play/[cue]. Rules and difficulty live in the URL: ?mode=study&difficulty=hard.
	 */
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { CUES } from '#lib/game/cues/index.ts';
	import type { Cue, Difficulty } from '#lib/game/types.ts';
	import type { Mode } from '#lib/telemetry/client.svelte.ts';
	import PlaySession from './PlaySession.svelte';
	import { CueChip, InfoTip, Segmented, Select, ROLE_LABEL } from '#lib/ui/index.ts';

	interface Props { cue: Cue }
	let { cue }: Props = $props();

	const mode = $derived<Mode>(page.url.searchParams.get('mode') === 'study' ? 'study' : 'arcade');
	const difficulty = $derived<Difficulty>(
		(['easy', 'hard'] as const).find((d) => d === page.url.searchParams.get('difficulty')) ?? 'normal'
	);

	const GROUP: Record<Cue['role'], string> = { reference: 'References', baseline: 'Baseline', idea: 'Ideas' };
	const options = $derived(CUES.map((c) => ({ value: c.id as string, label: `${c.code} · ${c.name}`, group: GROUP[c.role] })));

	function go(next: { cue?: string; mode?: Mode; difficulty?: Difficulty }) {
		const c = next.cue ?? cue.id, m = next.mode ?? mode, d = next.difficulty ?? difficulty;
		const q = new URLSearchParams();
		if (m === 'study') q.set('mode', 'study');
		if (d !== 'normal') q.set('difficulty', d);
		const s = q.toString();
		goto(`/play/${c}${s ? `?${s}` : ''}`, { replace: true, reset: false });
	}

	let cueValue = $state('');
	let modeValue = $state<Mode>('arcade');
	let diffValue = $state<Difficulty>('normal');
	$effect.pre(() => { cueValue = cue.id; modeValue = mode; diffValue = difficulty; });

	$effect(() => { try { localStorage.setItem('cc.play.last', cue.id); } catch { /* ignore */ } });

	let showTime = $state(false);
	let panelOpen = $state(true);
</script>

<svelte:head><title>{cue.name} · Free play · Circle Chase</title></svelte:head>

<div class="play">
	<div class="toolbar" role="group" aria-label="Game settings">
		<label class="pick">
			<span class="lab">Condition</span>
			<Select options={options} bind:value={cueValue} size="sm" onchange={() => go({ cue: cueValue })} aria-label="Condition" />
		</label>
		<div class="about">
			<CueChip cue={cue} size="sm" />
			<span class="role">{ROLE_LABEL[cue.role]}</span>
			<InfoTip term={cue.name}>{cue.description}</InfoTip>
		</div>
		<div class="seg">
			<span class="lab">Rules <InfoTip term="Rules">Arcade: the normal game, fixed power length, three lives. Study: each power-up lasts a random 4 to 8 s, power dots grow back, lives never run out, one maze. Both are measured.</InfoTip></span>
			<Segmented label="Rules" size="sm" options={[{ value: 'arcade', label: 'Arcade' }, { value: 'study', label: 'Study' }]} bind:value={modeValue} onchange={(v) => go({ mode: v })} />
		</div>
		<div class="seg">
			<span class="lab">Difficulty</span>
			<Segmented label="Difficulty" size="sm" options={[{ value: 'easy', label: 'Easy' }, { value: 'normal', label: 'Normal' }, { value: 'hard', label: 'Hard' }]} bind:value={diffValue} onchange={(v) => go({ difficulty: v })} />
		</div>
		<button class="panel-toggle" aria-expanded={panelOpen} aria-controls="live-panel" onclick={() => (panelOpen = !panelOpen)}>
			{panelOpen ? 'Hide' : 'Show'} measurement
		</button>
	</div>

	{#key `${cue.id}:${mode}:${difficulty}`}
		<PlaySession {cue} {mode} {difficulty} {panelOpen} bind:showTime />
	{/key}
</div>

<style>
	.play {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-3) var(--gutter) var(--space-3);
		overflow: auto;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		max-width: 1240px;
		width: 100%;
		margin: 0 auto;
	}
	.pick, .seg { display: flex; align-items: center; gap: var(--space-2); }
	.lab { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-dim); font-size: var(--text-sm); }
	.about { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
	.role { color: var(--ink-faint); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.08em; }
	.panel-toggle {
		margin-left: auto;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-size: var(--text-sm);
		cursor: pointer;
	}
	.panel-toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	@media (max-width: 720px) {
		.play { gap: var(--space-2); padding-top: var(--space-2); }
		.toolbar { gap: var(--space-2) var(--space-3); }
		.about, .panel-toggle { display: none; }
		.pick { flex: 1 1 100%; }
		.pick :global(.wrap) { flex: 1; }
		.pick .lab, .seg .lab { display: none; }
	}
</style>
