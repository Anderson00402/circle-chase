<script lang="ts">
	/**
	 * Development tool: fill the database with simulated study sessions (bots), clearly labelled
	 * `source: 'bot'`, so the dashboard and replays can be built and checked before real people play.
	 *
	 *   /dev/simulate?preset=planted&participants=24&cues=all&seed=7
	 *
	 * The simulator (src/lib/sim) plays every block with the real engine, tracker and clip recorder,
	 * as fast as the CPU allows, and writes through the same Convex mutations the game uses.
	 * `scripts/simulate.mjs` drives this page from the command line through `window.__simulate`.
	 */
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { CUE_IDS } from '#lib/game/cues/index.ts';
	import { OUTCOMES } from '#lib/telemetry/types.ts';
	import { OUTCOME_LABEL, outcomeColor } from '#lib/outcomes.ts';
	import { FLAT_NOISE, levelsFor, PRESETS, type Preset } from '#lib/sim/model.ts';
	import { runSimulation, type RunProgress } from '#lib/sim/writer.ts';
	import { BLOCK_POWER_UPS } from '#lib/sim/session.ts';
	import { Badge, Button, CueChip, DataTable, Dialog, Field, Page, PageHeader, Panel, Segmented, Stat, cueListings } from '#lib/ui/index.ts';

	const client = useConvexClient();
	const listings = cueListings();
	const q = page.url.searchParams;

	let preset = $state<Preset>(q.get('preset') === 'flat' ? 'flat' : 'planted');
	let participants = $state(clampInt(+(q.get('participants') ?? 24), 1, 200));
	let seedText = $state(q.get('seed') ?? '');
	const qCues = q.get('cues');
	let length = $state<'all' | 'subset'>(qCues && qCues !== 'all' ? 'subset' : 'all');
	let chosen = $state<string[]>(qCues && qCues !== 'all' ? qCues.split(',').filter((c) => CUE_IDS.includes(c as never)) : [...CUE_IDS]);

	let progress = $state<RunProgress | null>(null);
	let controller: AbortController | null = null;
	const running = $derived(progress?.state === 'running');

	const counters = useQuery(api.live.counters, () => ({ source: 'bot' as const }));
	const runs = useQuery(api.sim.runs, () => ({}));

	const cues = $derived(length === 'all' ? [...CUE_IDS] : CUE_IDS.filter((c) => chosen.includes(c)));
	const planted = $derived(levelsFor(preset, CUE_IDS));
	const canRun = $derived(!running && cues.length > 0 && participants >= 1);

	function clampInt(v: number, lo: number, hi: number) {
		return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : lo;
	}

	async function run(opts?: { preset?: Preset; participants?: number; cues?: string[]; seed?: number; recordRuns?: boolean }) {
		if (running) throw new Error('a run is already going');
		if (opts?.preset) preset = opts.preset;
		if (opts?.participants) participants = clampInt(opts.participants, 1, 500);
		if (opts?.cues) { length = opts.cues.length === CUE_IDS.length ? 'all' : 'subset'; chosen = opts.cues; }
		if (opts?.seed !== undefined) seedText = String(opts.seed);
		controller = new AbortController();
		const seed = seedText.trim() === '' ? undefined : clampInt(+seedText, 0, 2 ** 31 - 1);
		const result = await runSimulation(client, {
			preset, allCues: CUE_IDS, cues, participants, seed, signal: controller.signal, recordRuns: opts?.recordRuns === true,
			onProgress: (p) => (progress = p)
		});
		progress = result;
		controller = null;
		return result;
	}

	function stop() { controller?.abort(); }

	// ----- clearing -----
	let deleteOpen = $state(false), wipeOpen = $state(false), wipeText = $state(''), deleteText = $state('');
	let clearing = $state<string | null>(null);
	async function deleteBots() {
		if (deleteText !== 'delete simulated data') return;
		clearing = 'Deleting simulated data...';
		try {
			const r = await client.mutation(api.admin.deleteBotData, { confirm: 'delete bot data' });
			clearing = r.continuing ? 'Deleting simulated data in the background. The counts below fall to zero when it is done.' : 'Simulated data deleted.';
		} catch (e) { clearing = 'Could not delete: ' + (e instanceof Error ? e.message : String(e)); }
		deleteOpen = false;
		deleteText = '';
	}
	async function wipe() {
		if (wipeText !== 'wipe everything') return;
		clearing = 'Wiping everything...';
		try {
			const r = await client.mutation(api.admin.wipeEverything, { confirm: 'wipe everything' });
			clearing = r.continuing ? 'Wiping in the background.' : 'Everything deleted.';
		} catch (e) { clearing = 'Could not wipe: ' + (e instanceof Error ? e.message : String(e)); }
		wipeOpen = false;
		wipeText = '';
	}

	// Hook for scripts/simulate.mjs (development builds only).
	onMount(() => {
		if (!import.meta.env.DEV) return;
		const w = window as unknown as Record<string, unknown>;
		w.__simulate = {
			run,
			stop,
			deleteBots: () => client.mutation(api.admin.deleteBotData, { confirm: 'delete bot data' }),
			summary: () => client.query(api.summary.byCue, { source: 'bot', mode: 'study' }),
			counters: () => client.query(api.live.counters, { source: 'bot' }),
			// Without a run, check the latest one.
			check: async (run?: string) => {
				const id = run ?? (await client.query(api.sim.runs, {})).sort((a, b) => b.startedAt - a.startedAt)[0]?.run;
				return id ? client.query(api.dashboard.simCheck, { run: id }) : null;
			},
			runs: () => client.query(api.sim.runs, {}),
			get progress() { return progress; }
		};
		return () => { delete w.__simulate; };
	});

	const fmt = (n: number) => n.toLocaleString('en');
	const secs = (ms: number) => (ms / 1000).toFixed(1);
	const outcomeTotal = $derived(progress ? Object.values(progress.outcomes).reduce((a, b) => a + b, 0) : 0);
	const OUTCOME_TONE = Object.fromEntries(OUTCOMES.map((o) => [o, outcomeColor(o)])) as Record<string, string>;
	const listing = (id: string) => listings.find((l) => l.id === id)!;
	const toggle = (id: string) => { chosen = chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]; };
</script>

<svelte:head><title>Simulate · Circle Chase</title></svelte:head>

<Page width="wide">
	<PageHeader
		eyebrow="Developer tool"
		title="Simulated participants"
		lead="Fill the database with bot-played study sessions so the dashboard and replays can be built and checked before real people play."
	>
		<div class="badges">
			<Badge tone="sim">Simulated data</Badge>
			<Badge tone="neutral">Recorded as source: bot</Badge>
		</div>
	</PageHeader>

	<div class="notice" role="note">
		<strong>Nothing made here is evidence about the cues.</strong>
		Bots cannot see a cue. Each simulated power-up is given an awareness of the time left by this
		tool, then played by the bot and measured exactly like a person's. With the
		<em>planted</em> preset the dashboard should recover the made-up ranking below; that shows the
		pipeline can detect a difference of that size, nothing more. With <em>flat</em> every condition is
		the same, so any difference the dashboard shows is chance. Simulated rows are kept apart from
		human data in every view.
	</div>

	<div class="grid">
		<Panel title="Run a simulation" sub="Each participant plays a study session: one run per condition, in a counterbalanced order, each ending after {BLOCK_POWER_UPS} power-ups like a run at the default run length.">
			<div class="form">
				<Field label="Behaviour preset" hint={PRESETS.find((p) => p.value === preset)?.hint}>
					{#snippet children()}
						<Segmented label="Behaviour preset" options={PRESETS.map((p) => ({ value: p.value, label: p.label }))} bind:value={preset} />
					{/snippet}
				</Field>
				<div class="row">
					<Field label="Participants" hint="About 10 s each to simulate, plus writing, which slows as the database grows.">
						{#snippet children(id)}
							<input {id} class="input num" type="number" min="1" max="200" bind:value={participants} disabled={running} data-testid="participants" />
						{/snippet}
					</Field>
					<Field label="Seed" hint="Leave empty for a new random run.">
						{#snippet children(id)}
							<input {id} class="input num" type="text" inputmode="numeric" placeholder="random" bind:value={seedText} disabled={running} />
						{/snippet}
					</Field>
				</div>
				<Field label="Session length">
					{#snippet children()}
						<Segmented label="Session length" options={[{ value: 'all', label: 'All 13 conditions' }, { value: 'subset', label: 'A subset' }]} bind:value={length} />
					{/snippet}
				</Field>
				{#if length === 'subset'}
					<fieldset class="cues" disabled={running}>
						<legend class="visually-hidden">Conditions to play</legend>
						{#each listings as l (l.id)}
							<label class="cue" class:on={chosen.includes(l.id)}>
								<input type="checkbox" checked={chosen.includes(l.id)} onchange={() => toggle(l.id)} />
								<CueChip cue={l} size="sm" />
							</label>
						{/each}
					</fieldset>
					<p class="hint">{cues.length} of 13 chosen. A subset is played in a seeded shuffled order.</p>
				{/if}
				<div class="buttons">
					{#if running}
						<Button variant="quiet" onclick={stop}>Stop after this participant</Button>
					{:else}
						<Button variant="primary" onclick={() => run()} disabled={!canRun} data-testid="run">Run {participants} simulated {participants === 1 ? 'participant' : 'participants'}</Button>
					{/if}
				</div>
			</div>
		</Panel>

		<Panel title="Progress" sub={progress ? `Run ${progress.run}, seed ${progress.seed}, ${progress.preset} preset` : 'Nothing run yet in this tab.'}>
			{#snippet actions()}
				{#if progress}<Badge tone={progress.state === 'failed' ? 'bad' : progress.state === 'running' ? 'live' : 'sim'}>{progress.state}</Badge>{/if}
			{/snippet}
			<div class="stats" data-state={progress?.state ?? 'idle'} data-testid="progress">
				<Stat label="Participants" value={progress ? `${progress.done} / ${progress.participants}` : null} sub={progress?.current ? `simulating number ${progress.current}` : undefined} tone="sim" />
				<Stat label="Trials written" value={progress ? fmt(progress.trials) : null} sub={progress ? `${fmt(progress.engaged)} engaged, ${fmt(progress.clips)} clips` : undefined} />
				<Stat label="Blocks" value={progress ? fmt(progress.blocks) : null} sub={progress ? `${Math.round(progress.gameSeconds / 60)} min of play` : undefined} />
				<Stat label="Time" value={progress ? secs(progress.elapsedMs) : null} unit="s" sub={progress ? `${secs(progress.simMs)} s simulating, ${progress.elapsedMs > 0 ? Math.round(progress.gameSeconds / (progress.elapsedMs / 1000)) : 0}x real time` : undefined} />
			</div>
			{#if progress?.error}<p class="error" role="alert">{progress.error}</p>{/if}
			{#if progress && outcomeTotal > 0}
				<div class="mix" aria-label="Outcome mix so far">
					{#each OUTCOMES as o (o)}
						{#if progress.outcomes[o]}
							<span style="flex: {progress.outcomes[o]}; background: {OUTCOME_TONE[o]}" title="{OUTCOME_LABEL[o]}: {progress.outcomes[o]}"></span>
						{/if}
					{/each}
				</div>
				<ul class="legend">
					{#each OUTCOMES as o (o)}
						<li><i style="background: {OUTCOME_TONE[o]}"></i>{OUTCOME_LABEL[o]} <span class="num">{progress.outcomes[o] ?? 0}</span></li>
					{/each}
				</ul>
			{/if}
		</Panel>
	</div>

	<div class="grid">
		<Panel title="What the {preset} preset plants" sub={preset === 'planted' ? 'Invented for validation, not a prediction. More noise should mean fewer turn-aways in time, more turned away too early, more stayed too long or caught, and a wider spread of turn-away times. Catches are left out of the rates: a bot that overstays often still eats a ghost late.' : `Every condition gets the same noise (${FLAT_NOISE} s), so the dashboard should show no real differences.`} flush>
			<DataTable
				caption="Planted awareness per condition"
				dense
				rows={planted}
				key={(r) => r.cue}
				columns={[
					{ key: 'cue', label: 'Condition' },
					{ key: 'noise', label: 'Awareness noise', unit: 's', numeric: true, info: 'Spread of the bot\'s error about the time left, before each participant\'s own scale and learning. Lower is better.', format: (r) => r.noise.toFixed(2) },
					{ key: 'distraction', label: 'Distraction', numeric: true, info: 'Mean of the simulated "got in the way" rating, 1-7.', format: (r) => r.distraction.toFixed(1) }
				]}
			>
				{#snippet cell(r, col)}
					{#if col.key === 'cue'}<CueChip cue={listing(r.cue)} size="sm" />{:else}{col.format?.(r)}{/if}
				{/snippet}
			</DataTable>
		</Panel>

		<div class="side">
			<Panel title="Simulated data in the database" sub="Live from Convex, bot rows only.">
				<div class="stats">
					<Stat label="Participants" value={counters.data ? fmt(counters.data.participants) : null} tone="sim" />
					<Stat label="Sessions" value={counters.data ? fmt(counters.data.sessions) : null} />
					<Stat label="Trials" value={counters.data ? fmt(counters.data.trials) : null} sub={counters.data ? `${fmt(counters.data.decisions)} count in rates` : undefined} />
					<Stat label="Replay clips" value={counters.data ? fmt(counters.data.clips) : null} />
				</div>
				{#if runs.data?.length}
					<ul class="runs">
						{#each runs.data.slice(0, 6) as r (r.run)}
							<li><span class="num">{r.run}</span> {r.preset}, {r.sessions} {r.sessions === 1 ? 'session' : 'sessions'} ({r.finished} finished)</li>
						{/each}
					</ul>
				{/if}
				<div class="buttons">
					<Button href="/dashboard">Open the dashboard</Button>
					<Button variant="quiet" href="/replays">Open replays</Button>
				</div>
			</Panel>

			<Panel title="Clear data" sub="Both run in the background in batches.">
				{#if clearing}<p class="hint" role="status">{clearing}</p>{/if}
				<div class="buttons">
					<Button variant="quiet" onclick={() => (deleteOpen = true)} disabled={running}>Delete all simulated data</Button>
					<Button variant="danger" onclick={() => (wipeOpen = true)} disabled={running}>Wipe everything</Button>
				</div>
			</Panel>
		</div>
	</div>
</Page>

<Dialog bind:open={deleteOpen} title="Delete all simulated data?">
	<p>Every row recorded as a bot is removed: participants, sessions, blocks, trials, clips and ratings. Human data is not touched. It cannot be undone.</p>
	<Field label='Type "delete simulated data" to confirm'>
		{#snippet children(id)}
			<input {id} class="input" type="text" autocomplete="off" bind:value={deleteText} />
		{/snippet}
	</Field>
	{#snippet actions()}
		<Button variant="quiet" onclick={() => { deleteOpen = false; deleteText = ''; }}>Cancel</Button>
		<Button variant="danger" onclick={deleteBots} disabled={deleteText !== 'delete simulated data'}>Delete simulated data</Button>
	{/snippet}
</Dialog>

<Dialog bind:open={wipeOpen} title="Wipe everything?">
	<p>This deletes <strong>all</strong> data, including every real participant's sessions and answers. It cannot be undone.</p>
	<Field label='Type "wipe everything" to confirm'>
		{#snippet children(id)}
			<input {id} class="input" type="text" autocomplete="off" bind:value={wipeText} />
		{/snippet}
	</Field>
	{#snippet actions()}
		<Button variant="quiet" onclick={() => { wipeOpen = false; wipeText = ''; }}>Cancel</Button>
		<Button variant="danger" onclick={wipe} disabled={wipeText !== 'wipe everything'}>Wipe everything</Button>
	{/snippet}
</Dialog>

<style>
	.badges {
		display: flex;
		gap: var(--space-2);
		flex-wrap: wrap;
	}
	.notice {
		border: 1px solid var(--sim);
		background: color-mix(in srgb, var(--sim) 10%, var(--surface));
		border-radius: var(--radius-md);
		padding: var(--space-4);
		margin-bottom: var(--space-5);
		color: var(--ink-dim);
		max-width: 80ch;
	}
	.notice strong {
		color: var(--ink);
		display: block;
		margin-bottom: var(--space-1);
	}
	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: var(--space-5);
		margin-bottom: var(--space-5);
		align-items: start;
	}
	@media (max-width: 900px) {
		.grid { grid-template-columns: minmax(0, 1fr); }
	}
	.side {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}
	.form {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
	.row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-4);
	}
	.input {
		width: 100%;
		background: var(--surface-2);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
		color: var(--ink);
		padding: 8px 10px;
		font: inherit;
	}
	.input:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: 1px;
	}
	.cues {
		border: 0;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	.cue {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		cursor: pointer;
		opacity: 0.6;
	}
	.cue.on {
		opacity: 1;
		border-color: var(--rule-strong);
		background: var(--surface-2);
	}
	.hint {
		color: var(--ink-dim);
		font-size: var(--text-sm);
		margin: 0;
	}
	.buttons {
		display: flex;
		gap: var(--space-3);
		flex-wrap: wrap;
		margin-top: var(--space-2);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: var(--space-4);
	}
	.error {
		color: var(--bad);
		margin: var(--space-3) 0 0;
	}
	.mix {
		display: flex;
		height: 14px;
		border-radius: var(--radius-pill);
		overflow: hidden;
		margin-top: var(--space-5);
		gap: 2px;
	}
	.legend {
		list-style: none;
		padding: 0;
		margin: var(--space-3) 0 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 4px var(--space-4);
		font-size: var(--text-sm);
		color: var(--ink-dim);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.legend .num {
		margin-left: auto;
		color: var(--ink);
	}
	.legend i {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		flex: none;
	}
	.runs {
		list-style: none;
		padding: 0;
		margin: var(--space-4) 0 0;
		font-size: var(--text-sm);
		color: var(--ink-dim);
	}
	.runs .num {
		color: var(--ink);
	}
</style>
