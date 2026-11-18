<script lang="ts">
	/**
	 * The run console: pick a case, then play it with the participant.
	 *
	 * Left: the thirteen cases as live previews (references and the timer bar apart from the ten
	 * ideas), and the run sheet of the current participant. Right: the selected case with a larger
	 * preview, the run settings and the Play button. Keys: arrows move, 0-9 / A / B pick a case
	 * (1 then 0 for 10), Enter plays.
	 */
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { useConvexClient, useQuery } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { CUES, cueById } from '#lib/game/cues/index.ts';
	import type { Cue, CueId } from '#lib/game/types.ts';
	import CuePreview from '#lib/ui/CuePreview.svelte';
	import { previewMoment } from '#lib/ui/preview-moment.svelte.ts';
	import { MOMENTS } from '#lib/study/preview-scenes.ts';
	import { Button, CueChip, InfoTip, Kbd, Segmented, ROLE_LABEL, slow, whereLabel } from '#lib/ui/index.ts';
	import OutcomeBar from '#lib/study/OutcomeBar.svelte';
	import { MODE_LABEL, outcomeMix as mixWords } from '#lib/outcomes.ts';
	import { ensureIfNamed, newParticipant, persist, playHref, reload, run, setLabel, suggestedNext, summaryHref } from '#lib/study/run.svelte.ts';
	import { RUN_LENGTH, RUN_LENGTHS, runLengthWords } from '#lib/study/length.ts';

	const client = useConvexClient();

	const REFS = CUES.filter((c) => c.role !== 'idea');
	const IDEAS = CUES.filter((c) => c.role === 'idea');
	const ALL = [...REFS, ...IDEAS];


	const selected = $derived(cueById(run.settings.selected));

	/**
	 * Thumbnails of cues drawn on the characters zoom on the chase (at thumbnail size the whole board
	 * makes them look like "No signal"); cues drawn on the maze or around the board need the whole board.
	 */
	const closeUp = (c: Cue) => (c.channel === 'ghosts' ? 'ghost' : c.channel === 'player' ? 'player' : false) as false | 'ghost' | 'player';
	const momentValue = $derived(previewMoment.left === null ? 'live' : String(previewMoment.left));
	const momentOptions = [{ value: 'live', label: 'Playing' }, ...MOMENTS.map((m) => ({ value: String(m.left), label: m.label }))];
	function setMoment(v: string) { previewMoment.left = v === 'live' ? null : Number(v); }
	function select(id: CueId, focus = false) {
		run.settings.selected = id;
		persist();
		if (focus) tick().then(() => cards[id]?.focus());
	}

	// ----- participant and run sheet -----
	let labelDraft = $state(run.p.label);
	$effect(() => { labelDraft = run.p.label; });
	let labelInput = $state<HTMLInputElement>();
	function commitLabel() {
		if (labelDraft.trim() !== run.p.label) setLabel(client, labelDraft);
	}
	/**
	 * The keyboard path of a run: the participant label is the first Tab stop, then the run length,
	 * then Play; after Play, Tab goes on in page order. Enter in the label goes on to the run length,
	 * and Enter there plays. (Done by hand: a positive tabindex is ignored once the router has reset
	 * the focus, which it does on every page load.)
	 */
	const lengthInput = () => document.querySelector('.length input[type="radio"]:checked') as HTMLElement | null;
	const playButton = () => document.querySelector('[data-play]') as HTMLElement | null;
	function toLength() {
		tick().then(() => lengthInput()?.focus());
	}
	function keyboardPath(e: KeyboardEvent): boolean {
		if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return false;
		const a = document.activeElement as HTMLElement | null;
		const go = (el: HTMLElement | null | undefined) => { if (!el) return false; e.preventDefault(); el.focus(); return true; };
		const nowhere = !a || a === document.body;
		if (e.shiftKey) {
			if (a?.closest('[data-play]')) return go(lengthInput());
			if (a?.closest('.length')) return go(labelInput);
			return false;
		}
		if (nowhere) return go(labelInput);
		if (a === labelInput) return go(lengthInput());
		if (a?.closest('.length')) return go(playButton());
		return false;
	}
	function freshParticipant() {
		newParticipant(client);
		labelDraft = '';
		tick().then(() => labelInput?.focus());
	}

	const sheet = useQuery(api.runs.session, () => ({ sessionKey: run.p.sessionKey }));
	interface Played { runs: number; trials: number; counted: number; wellTimed: number; caught: number; outcomes: Record<string, number> }
	const played = $derived.by(() => {
		const m = new Map<string, Played>();
		for (const r of sheet.data?.runs ?? []) {
			const x = m.get(r.cue) ?? { runs: 0, trials: 0, counted: 0, wellTimed: 0, caught: 0, outcomes: {} };
			x.runs++; x.trials += r.trials; x.counted += r.counted; x.wellTimed += r.wellTimed; x.caught += r.caught;
			for (const [k, n] of Object.entries(r.outcomes)) x.outcomes[k] = (x.outcomes[k] ?? 0) + n;
			m.set(r.cue, x);
		}
		// Runs not yet on the server (offline) still count as played.
		for (const r of run.p.runs) if (!m.has(r.cue)) m.set(r.cue, { runs: 1, trials: 0, counted: 0, wellTimed: 0, caught: 0, outcomes: {} });
		return m;
	});
	const runs = $derived([...(sheet.data?.runs ?? [])].sort((a, b) => a.orderIndex - b.orderIndex));
	const next = $derived(suggestedNext(played.keys()));
	const sheetLate = slow(() => sheet.isLoading);

	/** This participant's totals for the status line. */
	const totals = $derived(runs.reduce((t, r) => ({ trials: t.trials + r.trials, counted: t.counted + r.counted, clips: t.clips + r.clips }), { trials: 0, counted: 0, clips: 0 }));

	// The suggested next case is selected for the researcher whenever it changes: once a label is
	// entered (the order arrives with the participant number) and when coming back from a run (the
	// case just played drops out). A case picked by hand that has not been played is left alone.
	let lastNext: string | null = null;
	$effect(() => {
		const id = next?.id ?? null;
		if (id === lastNext) return;
		lastNext = id;
		if (!id) return;
		const pickedPlayed = played.has(run.settings.selected);
		const fresh = run.p.runs.length === 0;
		if (pickedPlayed || fresh) select(id as CueId);
	});

	// ----- settings -----
	const lengthOptions = RUN_LENGTHS.map((n) => ({ value: String(n), label: n ? String(n) : 'No limit' }));
	function setLength(v: string) {
		run.settings.runLength = Number(v);
		persist();
	}
	let sound = $state(true);
	function setSound(on: boolean) {
		sound = on;
		try { localStorage.setItem('cc:sound', on ? '1' : '0'); } catch { /* ignore */ }
	}

	function play(cue: Cue = selected) {
		commitLabel();
		persist();
		goto(playHref(cue.id));
	}

	// ----- keyboard -----
	const cards: Record<string, HTMLButtonElement | undefined> = $state({});
	let pendingOne = 0;
	function byCode(code: string) { return ALL.find((c) => c.code.toLowerCase() === code.toLowerCase()); }

	function spatial(dir: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
		const from = cards[selected.id]?.getBoundingClientRect();
		if (!from) return;
		const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
		let best: Cue | null = null, bestD = Infinity;
		for (const c of ALL) {
			const r = cards[c.id]?.getBoundingClientRect();
			if (!r || c.id === selected.id) continue;
			const dx = r.left + r.width / 2 - fx, dy = r.top + r.height / 2 - fy;
			const along = dir === 'ArrowLeft' ? -dx : dir === 'ArrowRight' ? dx : dir === 'ArrowUp' ? -dy : dy;
			const across = dir === 'ArrowLeft' || dir === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
			if (along < 8) continue;
			const d = along + across * 2.5;
			if (d < bestD) { bestD = d; best = c; }
		}
		// Left / right walk the list in order when nothing lies that way (end of a row).
		if (!best && (dir === 'ArrowLeft' || dir === 'ArrowRight')) {
			const i = ALL.findIndex((c) => c.id === selected.id) + (dir === 'ArrowRight' ? 1 : -1);
			best = ALL[(i + ALL.length) % ALL.length];
		}
		if (best) select(best.id, true);
	}

	function onkeydown(e: KeyboardEvent) {
		if (keyboardPath(e)) return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const t = e.target as HTMLElement;
		// Enter on the run length (the stop after the label) plays, as everywhere else on the console.
		if (e.key === 'Enter' && t.matches('.length input[type="radio"]')) { e.preventDefault(); play(); return; }
		if (t.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
		const inCases = !!t.closest('.cases-grid');
		if (e.key.startsWith('Arrow') && (inCases || t === document.body)) {
			e.preventDefault();
			spatial(e.key as 'ArrowUp');
			return;
		}
		if (e.key === 'Enter') {
			if (t.tagName === 'A' || (t.tagName === 'BUTTON' && !inCases)) return;
			e.preventDefault();
			play();
			return;
		}
		const k = e.key.toLowerCase();
		if (/^[0-9ab]$/.test(k)) {
			// "1" then "0" quickly picks case 10.
			if (k === '0' && pendingOne && performance.now() - pendingOne < 800 && byCode('10')) { select(byCode('10')!.id, inCases); pendingOne = 0; return; }
			pendingOne = k === '1' ? performance.now() : 0;
			const c = byCode(k);
			if (c) select(c.id, inCases);
		}
	}

	/** This participant's replays: their console number within their own data source (humans or simulated). */
	const participantReplays = $derived(`/replays?${new URLSearchParams({ ...(run.p.source !== 'human' ? { source: run.p.source } : {}), ...(run.p.number ? { p: String(run.p.number) } : {}) })}`);
	const n = (x: number | undefined) => (x === undefined ? '-' : x.toLocaleString('en-US'));

	onMount(() => {
		reload();
		labelDraft = run.p.label;
		try { sound = localStorage.getItem('cc:sound') !== '0'; } catch { /* ignore */ }
		ensureIfNamed(client);
	});
</script>

<svelte:head><title>Run · Circle Chase</title></svelte:head>
<svelte:window {onkeydown} />

{#snippet card(c: Cue)}
	{@const p = played.get(c.id)}
	<button
		bind:this={cards[c.id]}
		class="case {c.role}"
		class:on={c.id === selected.id}
		class:done={!!p}
		class:next={next?.id === c.id}
		role="radio"
		aria-checked={c.id === selected.id}
		tabindex={c.id === selected.id ? 0 : -1}
		onclick={() => select(c.id)}
		ondblclick={() => play(c)}
		data-preview-host
	>
		<span class="thumb"><CuePreview cue={c} fps={15} zoom={closeUp(c)} />{#if closeUp(c)}<span class="zoomtag" title="This thumbnail zooms on the {closeUp(c) === 'ghost' ? 'ghosts' : 'player'}, where the cue is drawn; the selected case shows the whole board">close-up</span>{/if}</span>
		<span class="meta">
			<span class="code num">{c.code}</span>
			<span class="name">{c.name}</span>
			{#if p}
				<span class="tick" title="Played {p.runs} time{p.runs === 1 ? '' : 's'}: {p.counted} decision{p.counted === 1 ? '' : 's'} measured from {p.trials} power-ups{p.trials ? `, ${mixWords(p.outcomes)}` : ''}">
					<svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
					<span class="num">{p.counted}</span><span class="visually-hidden"> decisions measured</span>
				</span>
			{/if}
		</span>
		{#if p && p.trials}<span class="mix"><OutcomeBar outcomes={p.outcomes} height={3} /></span>{/if}
	</button>
{/snippet}

<div class="console">
	<section class="cases" aria-labelledby="cases-title">
		<header class="top">
			<h1 id="cases-title">Run console</h1>
			<p>Pick a case, then play it with the participant.</p>
			<span class="keys"><Kbd>←</Kbd><Kbd>→</Kbd> or <Kbd>0</Kbd>-<Kbd>9</Kbd> <Kbd>A</Kbd> <Kbd>B</Kbd> to pick, <Kbd>Enter</Kbd> to play</span>
		</header>
		<div class="compare">
			<span class="lab">Compare all at <InfoTip term="Compare at a moment">Freezes every preview at the same time left, so the thirteen cases can be compared side by side. Cases drawn on the characters show a close-up of the chase; the selected case shows the whole board.</InfoTip></span>
			<Segmented label="Compare all previews at a moment" size="sm" options={momentOptions} value={momentValue} onchange={setMoment} />
			<span class="dim">left</span>
		</div>

		<div class="cases-grid" role="radiogroup" aria-label="Case">
			<div class="group refs">
				<h2>References and baseline</h2>
				<div class="row">{#each REFS as c (c.id)}{@render card(c)}{/each}</div>
			</div>

			<aside class="sheet" aria-labelledby="sheet-title">
				<div class="sheet-head">
					<h2 id="sheet-title" class="visually-hidden">Participant and runs</h2>
					<label for="participant" class="plabel">Participant</label>
					<input
						id="participant"
						bind:this={labelInput}
						bind:value={labelDraft}
						onchange={commitLabel}
						onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitLabel(); toLength(); } }}
						maxlength="24"
						autocomplete="off"
						spellcheck="false"
						placeholder="e.g. P07"
					/>
					<Button size="sm" variant="ghost" onclick={freshParticipant}>New participant</Button>
					<span class="dim count-line">{run.p.number ? `#${run.p.number} · ` : ''}{runs.length || run.p.runs.length} run{(runs.length || run.p.runs.length) === 1 ? '' : 's'} · {played.size} of {CUES.length} cases</span>
				</div>
				{#if next}
					<p class="suggest">
						Suggested next: <button class="link" onclick={() => select(next.id, true)}><span class="num">{next.code}</span> · {next.name}</button>
						<InfoTip term="Suggested next">From a counterbalanced order (balanced Latin square, row {(run.p.row ?? 0) + 1}) picked by participant number, so no case always comes early or late. Any case may be played; the real order is recorded.</InfoTip>
					</p>
				{:else if run.p.number === null}
					<p class="suggest dim">{run.p.label ? 'Connecting to suggest an order...' : 'Type a label for the participant. The suggested order of cases, and each run played, appear here.'}</p>
				{:else}
					<p class="suggest good">Every case has been played.</p>
				{/if}
				{#if runs.length}
					<p class="runs-head" aria-hidden="true"><span>Run</span><span>Case</span><span title="Decisions measured: the power-ups that ended in a decision about the end, which the rates use">Decisions</span></p>
					<ol class="runs">
						{#each runs as r (r.key)}
							{@const c = cueById(r.cue)}
							<li>
								<a class="row" href={summaryHref(r.cue, r.key, r.mode)} title="Open the summary of run {r.orderIndex + 1}: {r.counted} decision{r.counted === 1 ? '' : 's'} from {r.trials} power-ups{r.trials ? `; ${mixWords(r.outcomes, 8)}` : ''}">
									<span class="i num">{r.orderIndex + 1}</span>
									<span class="what"><span class="num">{c.code}</span> {c.name}{r.mode === 'arcade' ? ` (${MODE_LABEL.arcade.toLowerCase()})` : ''}</span>
									<span class="count num">{r.counted}<span class="of"> / {r.trials}</span></span>
									<span class="bar"><OutcomeBar outcomes={r.outcomes} height={4} /></span>
								</a>
								<a class="whole" href="/replays/run/{r.key}" title="Watch run {r.orderIndex + 1} from start to end" aria-label="Watch run {r.orderIndex + 1} from start to end">
									<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 3l9 5-9 5z" fill="currentColor" /></svg>
								</a>
							</li>
						{/each}
					</ol>
				{:else if !run.p.label && run.p.number === null}
					<!-- The line above already says what to do. -->
				{:else if sheetLate.offline}
					<p class="empty">Can't reach the database: runs played now are kept on this machine and appear here when it is back.</p>
				{:else if sheetLate.late}
					<p class="empty">Still loading the runs: the database is connected but slow to answer.</p>
				{:else if sheet.error}
					<p class="empty">Could not load the runs: the request failed. Reload to try again.</p>
				{:else}
					<p class="empty">No runs yet for this participant. Each case played appears here; click one to open its summary.</p>
				{/if}
			</aside>

			<div class="group ideas">
				<h2>Ideas</h2>
				<div class="row">{#each IDEAS as c (c.id)}{@render card(c)}{/each}</div>
			</div>
		</div>
	</section>

	<section class="selected" aria-labelledby="sel-title">
		<div class="sel-body">
			<div class="sel-head">
				<CueChip cue={selected} size="sm" />
				<span class="role">{ROLE_LABEL[selected.role]} · {whereLabel(selected)}</span>
			</div>
			<h2 id="sel-title">{selected.name}</h2>
			<p class="tagline">{selected.tagline}</p>
			<div class="big">{#key selected.id}<CuePreview cue={selected} controls fps={30} />{/key}</div>
			<p class="desc">{selected.description}</p>

			<div class="settings">
				<div class="set">
					<span class="lab">Rules <InfoTip term="Rules">Study rules: each power-up lasts a random 4 to 8 s, power dots grow back, no game over, one maze. Arcade rules: the normal game with fixed power lengths, lives and levels. Both are measured.</InfoTip></span>
					<Segmented label="Rules" size="sm" options={[{ value: 'study', label: MODE_LABEL.study }, { value: 'arcade', label: MODE_LABEL.arcade }]} bind:value={run.settings.rules} onchange={() => persist()} />
				</div>
				<div class="set length">
					<span class="lab" title={runLengthWords(run.settings.runLength ?? RUN_LENGTH)}>Run length <InfoTip term="Run length">A run ends by itself after this many power-ups (the one in progress is measured to its end first). About one power-up in three ends in a decision, and one comes about every 15 s, so {RUN_LENGTH} power-ups take about 4 minutes and measure 5 or 6 decisions. End run still ends a run early.</InfoTip></span>
					<Segmented label="Run length in power-ups" size="sm" options={lengthOptions} value={String(run.settings.runLength ?? RUN_LENGTH)} onchange={setLength} />
				</div>
				<div class="set">
					<span class="lab">Sound</span>
					<Segmented label="Sound" size="sm" options={[{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]} value={sound ? 'on' : 'off'} onchange={(v) => setSound(v === 'on')} />
				</div>
			</div>
		</div>

		<Button variant="primary" size="lg" block onclick={() => play()} data-play>
			<span class="wide-only">Play this case</span><span class="phone-only">Play {selected.code} · {selected.name}</span>
			<span class="enter"><Kbd>Enter</Kbd></span>
		</Button>
	</section>

	<footer class="status">
		<span class="who-line">{run.p.label || 'This participant'}:</span>
		<span><span class="num">{sheet.isLoading ? '-' : n(totals.trials)}</span> power-up{totals.trials === 1 ? '' : 's'} measured</span>
		<span><span class="num">{sheet.isLoading ? '-' : n(totals.counted)}</span> decision{totals.counted === 1 ? '' : 's'} measured</span>
		<span><span class="num">{sheet.isLoading ? '-' : n(totals.clips)}</span> replay{totals.clips === 1 ? '' : 's'}</span>
		<span class="links"><a href={participantReplays}>This participant's replays</a><a href="/dashboard">Dashboard</a></span>
	</footer>
</div>

<style>
	/*
	 * Two columns that share the width and never overlap: the cases (left, as wide as is left) and the
	 * selected case (right, clamped). Both tracks are minmax(0, ...) and every child has min-width: 0,
	 * so nothing in one column can push into the other. The page is as tall as its content (the
	 * status line sits right under it); the card size is chosen so that it fits one screen.
	 */
	.console {
		--gap: 10px;
		--panel-w: clamp(340px, 26vw, 460px);
		--status-h: 40px;
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, var(--panel-w));
		grid-template-rows: auto auto;
		align-content: start;
		align-items: start;
		gap: var(--space-4) var(--space-5);
		width: 100%;
		max-width: 1720px;
		margin: 0 auto;
		padding: var(--space-4) var(--gutter) var(--space-3);
		box-sizing: border-box;
	}
	.cases { min-width: 0; container-type: inline-size; }

	/* ----- cases ----- */
	.top { display: flex; align-items: baseline; gap: var(--space-4); flex-wrap: wrap; margin-bottom: var(--space-3); }
	h1 { font-size: var(--text-xl); font-weight: 600; }
	.top p { color: var(--ink-dim); }
	.keys { margin-left: auto; color: var(--ink-faint); font-size: var(--text-xs); }
	.keys :global(kbd) { margin: 0 1px; }
	.compare { display: flex; align-items: center; flex-wrap: wrap; gap: 4px var(--space-2); margin: calc(-1 * var(--space-2)) 0 var(--space-2); }
	.compare .lab { font-size: var(--text-xs); }
	/* Comparing all thirteen side by side is a laptop task; on a phone the participant comes first. */
	@media (max-width: 600px) { .compare { display: none; } }
	.cases-grid {
		/*
		 * Card size from the width this column really has (100cqi) and the screen height: five cards
		 * across, three rows on one screen, never larger than 200px. The idea grid then fits as many
		 * columns as that width holds.
		 */
		--thumb: clamp(72px, min(calc((100dvh - var(--bar-h) - 344px) / 3), calc((100cqi - 4 * var(--gap)) / 5 - 14px)), 200px);
		--card: calc(var(--thumb) + 14px);
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		grid-template-areas: 'refs sheet' 'ideas ideas';
		gap: var(--space-3) var(--space-4);
		align-items: start;
		min-width: 0;
	}
	.refs { grid-area: refs; min-width: 0; }
	.ideas { grid-area: ideas; min-width: 0; }
	.sheet { grid-area: sheet; }
	/* The key hint only where it fits on the title line. */
	@container (max-width: 860px) { .keys { display: none; } }
	/* Too narrow for the run sheet beside the three references: it goes above them, still at the top. */
	@container (max-width: 520px) {
		.cases-grid { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'sheet' 'refs' 'ideas'; }
		.sheet { margin-top: 0; contain: none; max-height: 260px; }
	}
	h2 { font-size: var(--text-xs); font-family: var(--font-mono); font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink-dim); margin-bottom: 6px; }
	/* At most five across (ten ideas make two even rows), fewer when the column is narrower. */
	.row { display: grid; grid-template-columns: repeat(auto-fill, var(--card)); gap: var(--gap); min-width: 0; max-width: calc(5 * var(--card) + 4 * var(--gap)); }
	.refs .row { grid-template-columns: repeat(3, var(--card)); }
	.case { min-width: 0; }

	.case {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 6px 6px 7px;
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--ink);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.case:hover { border-color: var(--rule-strong); }
	.case.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent), var(--glow-accent); }
	.case:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
	.case.reference { --c: var(--role-reference); }
	.case.baseline { --c: var(--role-baseline); }
	.case.idea { --c: var(--role-idea); }
	.thumb { position: relative; display: block; width: var(--thumb); height: var(--thumb); border-radius: var(--radius-sm); overflow: hidden; background: #05070f; }
	.zoomtag { position: absolute; right: 4px; bottom: 4px; padding: 0 5px; border-radius: var(--radius-pill); background: rgba(8, 12, 24, 0.8); color: var(--ink-dim); font-size: 10px; line-height: 16px; }
	.meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: var(--text-sm); line-height: 1.2; }
	.code {
		flex: none;
		min-width: 20px;
		padding: 1px 4px;
		border-radius: 4px;
		border: 1px solid color-mix(in srgb, var(--c) 60%, transparent);
		color: var(--c);
		font-size: var(--text-xs);
		font-weight: 700;
		text-align: center;
	}
	.reference .code { border-style: dashed; }
	.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
	.tick { flex: none; display: inline-flex; align-items: center; gap: 2px; color: var(--good); font-size: var(--text-xs); }
	.mix { display: block; padding: 0 1px; }
	.case.next:not(.on)::after {
		content: 'next';
		position: absolute;
		top: 10px;
		left: 10px;
		padding: 1px 6px;
		border-radius: var(--radius-pill);
		background: var(--accent);
		color: var(--on-accent);
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	/* ----- run sheet ----- */
	.sheet {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		/* Exactly as tall as the reference cards beside it (adds no height of its own); scrolls inside if it must. */
		align-self: stretch;
		contain: size;
		min-height: 0;
		min-width: 0;
		overflow-y: auto;
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius-md);
		background: var(--surface);
		margin-top: 22px;
	}
	.sheet-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
	.plabel { color: var(--ink-dim); font-size: var(--text-sm); font-weight: 600; }
	.sheet-head input {
		flex: 1 1 90px;
		min-width: 0;
		max-width: 180px;
		height: 32px;
		padding: 0 10px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--rule-strong);
		background: var(--surface-2);
		color: var(--ink);
		font: inherit;
		font-family: var(--font-mono);
		font-weight: 600;
	}
	.sheet-head input::placeholder { color: var(--ink-faint); font-family: var(--font-body); font-weight: 400; }
	.sheet-head input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
	.count-line { margin-left: auto; }
	.who { font-family: var(--font-mono); }
	.dim { color: var(--ink-faint); font-size: var(--text-xs); }
	.suggest { display: flex; align-items: center; gap: 6px; font-size: var(--text-sm); color: var(--ink-dim); }
	.suggest.good { color: var(--good); }
	.link { background: none; border: 0; padding: 0; color: var(--accent); font: inherit; font-weight: 650; cursor: pointer; text-decoration: underline; text-underline-offset: 3px; }
	.runs { list-style: none; margin: 0; padding: 0; overflow-y: auto; min-height: 0; display: flex; flex-direction: column; gap: 4px; }
	.runs-head { display: grid; grid-template-columns: 22px minmax(0, 1fr) 52px 70px; gap: 8px; padding: 0 30px 0 4px; margin: 0; color: var(--ink-faint); font-size: var(--text-xs); }
	.runs li { display: flex; align-items: center; gap: 4px; }
	.runs a.row { flex: 1; min-width: 0; }
	.runs a.whole { flex: none; display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--radius-sm); color: var(--ink-faint); }
	.runs a.whole:hover { color: var(--accent); background: var(--surface-2); }
	.runs a.whole:focus-visible { outline: 2px solid var(--focus); }
	.runs-head span:first-child, .runs-head span:nth-child(3) { text-align: right; }
	.runs a.row { display: grid; grid-template-columns: 22px minmax(0, 1fr) 52px 70px; align-items: center; gap: 8px; padding: 2px 4px; border-radius: var(--radius-sm); font-size: var(--text-sm); color: var(--ink); text-decoration: none; }
	.runs a.row:hover { background: var(--surface-2); }
	.runs a.row:focus-visible { outline: 2px solid var(--focus); outline-offset: 0; }
	.runs .i { color: var(--ink-faint); text-align: right; }
	.runs .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.runs .count { text-align: right; color: var(--ink); font-weight: 650; }
	.runs .count .of { color: var(--ink-faint); font-weight: 400; }
	.empty { color: var(--ink-faint); font-size: var(--text-sm); }

	/* ----- selected case ----- */
	/*
	 * One compact block (preview, description, settings, Play), as tall as its content and never
	 * taller than the screen: when space is short the preview gives way first (down to 150px), then
	 * the block scrolls inside itself. Sticky when the cases are taller.
	 */
	.selected {
		grid-row: 1 / 2;
		grid-column: 2;
		position: sticky;
		top: calc(var(--bar-h) + var(--space-3));
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
		max-height: calc(100dvh - var(--bar-h) - 2 * var(--space-4) - var(--status-h) - var(--space-3));
		overflow: hidden;
		overflow-wrap: anywhere;
		padding: var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.sel-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); min-width: 0; }
	.role { color: var(--ink-faint); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.06em; }
	.selected h2 { margin: 0; color: var(--ink); font-family: var(--font-display); font-size: var(--text-xl); letter-spacing: 0; text-transform: none; }
	.tagline { color: var(--ink); }
	/* The preview takes what the text leaves, so the description is never cut off. */
	/* Everything but Play; it scrolls inside itself only when even the smallest preview does not fit. */
	.sel-body { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; gap: var(--space-2); overflow-y: auto; overflow-x: hidden; }
	.selected > :global(.btn.primary) { flex: none; }
	.big { width: 100%; flex: 0 1 360px; height: 360px; min-height: 150px; }
	.sel-body > :not(.big) { flex: none; }
	.desc { color: var(--ink-dim); font-size: var(--text-sm); }
	.settings { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-2) 0; border-top: 1px solid var(--rule); }
	.set { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-1) var(--space-3); min-width: 0; }
	.set :global(.seg) { max-width: 100%; }
	.lab { display: inline-flex; align-items: center; gap: 4px; color: var(--ink-dim); font-size: var(--text-sm); }
	.enter { margin-left: 6px; opacity: 0.75; }
	.phone-only { display: none; }
	.enter :global(kbd) { background: transparent; color: inherit; border-color: currentColor; }

	/* ----- status line ----- */
	.status {
		grid-column: 1 / -1;
		min-height: var(--status-h);
		box-sizing: border-box;
		min-width: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding-top: var(--space-2);
		border-top: 1px solid var(--rule);
		color: var(--ink-dim);
		font-size: var(--text-sm);
	}
	.status .num { color: var(--ink); font-weight: 650; }
	.who-line { color: var(--ink); font-weight: 650; }
	.links { margin-left: auto; display: flex; gap: var(--space-4); }
	.links a { font-weight: 650; }

	/* ----- narrower screens ----- */
	@media (max-width: 1100px) {
		.keys { display: none; }
	}
	@media (max-width: 860px) {
		.console { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto; }
		.cases-grid { --thumb: min(200px, calc((100cqi - 2 * var(--gap)) / 3 - 14px)); grid-template-columns: minmax(0, 1fr); grid-template-areas: 'sheet' 'refs' 'ideas'; }
		.row, .refs .row { grid-template-columns: repeat(3, var(--card)); }
		.sheet { margin-top: 0; contain: none; max-height: 260px; }
		.selected { grid-row: auto; grid-column: auto; position: relative; top: auto; max-height: none; overflow: visible; }
		.sel-body { overflow: visible; }
		.big { flex: none; height: min(80vw, 340px); }
		/* The Play button stays in reach at the bottom of the screen. */
		.selected :global(.btn.primary) { position: fixed; left: var(--gutter); right: var(--gutter); bottom: 12px; width: auto; z-index: 30; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6); }
		.console { padding-bottom: 84px; }
		.phone-only { display: inline; }
		.wide-only, .enter { display: none; }
		.links { margin-left: 0; }
		.top p { display: none; }
	}
</style>
