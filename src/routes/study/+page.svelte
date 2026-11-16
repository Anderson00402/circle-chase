<script lang="ts">
	/**
	 * The guided study. Steps: welcome -> practice (not counted) -> for each condition in the
	 * counterbalanced order: intro ("Round n of N"), play, two ratings -> pick the clearest and least
	 * clear round -> thank you with own results.
	 *
	 * Progress lives in localStorage (src/lib/study/progress.ts): a refresh resumes at the same step;
	 * a round left half way is played again from its start (the unfinished block is marked
	 * `abandoned`); finished rounds are never replayed. The order comes from the participant number
	 * (src/lib/study/order.ts). Gameplay goes through telemetry; the study's own writes (setup,
	 * ratings, pauses, finish) through a durable outbox (src/lib/study/outbox.svelte.ts).
	 */
	import { onDestroy, onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '#convex/_generated/api.js';
	import { CUES, cueById } from '#lib/game/cues/index.ts';
	import type { Cue, CueId } from '#lib/game/types.ts';
	import { detectSource, participantId } from '#lib/telemetry/client.svelte.ts';
	import { QUICK_SIZE, studyOrder } from '#lib/study/order.ts';
	import { createOutbox } from '#lib/study/outbox.svelte.ts';
	import { loadProgress, newSeed, saveProgress, uid, type StudyProgress } from '#lib/study/progress.ts';
	import StudyBlock, { type BlockResult } from '#lib/study/StudyBlock.svelte';
	import Welcome, { type WelcomeChoice } from '#lib/study/Welcome.svelte';
	import RateRound, { type RoundAnswers } from '#lib/study/RateRound.svelte';
	import PickRounds, { type Picks } from '#lib/study/PickRounds.svelte';
	import StudyResults from '#lib/study/StudyResults.svelte';
	import { Button, Dialog, Kbd, Page } from '#lib/ui/index.ts';

	// Round length (STUDY.md "Many trials"). In development, ?trials=2&cap=30&practice=10 shortens them.
	const dev = import.meta.env.DEV ? page.url.searchParams : new URLSearchParams();
	const TARGET = +(dev.get('trials') ?? 6);
	const CAP = +(dev.get('cap') ?? 100);
	const PRACTICE = +(dev.get('practice') ?? 30);

	const client = useConvexClient();
	const outbox = createOutbox(client);
	onDestroy(() => outbox.destroy());

	let p = $state<StudyProgress | null>(null);
	let loaded = $state(false);
	let starting = $state(false);
	let startError = $state('');
	let notice = $state('');
	let confirmRestart = $state(false);

	const commit = () => saveProgress(p ? $state.snapshot(p) as StudyProgress : null);
	const roundCues = $derived<Cue[]>(p ? p.rounds.map((r) => cueById(r.cue)) : []);
	const cueOrder = $derived(p ? p.rounds.map((r) => r.cue as string) : []);

	onMount(() => {
		const saved = loadProgress();
		if (saved) {
			// A round (or the practice) that was being played when the page went away starts again.
			if (saved.step === 'play') {
				const r = saved.rounds[saved.index];
				outbox.send('markBlock', { blockKey: r.blockKey, abandoned: true }, `abandon:${r.blockKey}`);
				r.abandoned.push(r.blockKey);
				r.blockKey = uid();
				r.seed = newSeed();
				saved.step = 'intro';
				notice = 'Welcome back. The round you were playing was interrupted, so it starts again from the beginning.';
			} else if (saved.step === 'practice') {
				outbox.send('markBlock', { blockKey: saved.practice.blockKey, abandoned: true }, `abandon:${saved.practice.blockKey}`);
				saved.practice = { blockKey: uid(), seed: newSeed(), done: false };
				saved.step = 'practice-intro';
				notice = 'Welcome back. The practice round starts again.';
			} else if (saved.step !== 'done') {
				notice = 'Welcome back. You can carry on where you left off.';
			}
			p = saved;
			commit();
		}
		loaded = true;
	});

	function deviceInfo() {
		return {
			userAgent: navigator.userAgent.slice(0, 300),
			platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
			language: navigator.language ?? '',
			touch: (navigator.maxTouchPoints ?? 0) > 0,
			screenW: screen.width, screenH: screen.height, dpr: window.devicePixelRatio || 1
		};
	}

	async function start(c: WelcomeChoice) {
		starting = true;
		startError = '';
		const source = detectSource();
		const pid = participantId(source);
		// The participant number picks the counterbalanced order. If Convex cannot be reached the
		// study still runs, with a random number (recorded as such).
		let number: number, numberFrom: 'server' | 'local' = 'server';
		try {
			const r = await Promise.race([
				client.mutation(api.participants.ensure, { pid, source, device: deviceInfo(), ...(c.nickname ? { nickname: c.nickname } : {}) }),
				new Promise<never>((_, no) => setTimeout(() => no(new Error('timeout')), 6000))
			]);
			number = r.number;
		} catch {
			number = 1 + Math.floor(Math.random() * 1000);
			numberFrom = 'local';
		}
		const order = studyOrder(number, c.length, CUES.map((x) => x.id));
		const sound = c.soundCheck !== 'muted';
		try { localStorage.setItem('cc:sound', sound ? '1' : '0'); } catch { /* ignore */ }
		p = {
			v: 1, sessionKey: uid(), source, length: c.length, number, numberFrom, row: order.row, nickname: c.nickname,
			sound, soundCheck: c.soundCheck, step: 'practice-intro', index: 0,
			practice: { blockKey: uid(), seed: newSeed(), done: false },
			rounds: order.cues.map((cue: CueId) => ({ cue, blockKey: uid(), seed: newSeed(), played: false, rated: false, abandoned: [] })),
			picks: { clearest: null, leastClear: null, comment: '' },
			startedAt: Date.now()
		};
		commit();
		outbox.send('setup', {
			sessionKey: p.sessionKey,
			study: { length: c.length, soundCheck: c.soundCheck, participantNumber: number, orderRow: order.row, numberFrom }
		}, 'setup');
		starting = false;
		scrollTop();
	}

	async function scrollTop() {
		await tick();
		window.scrollTo(0, 0);
		// Put keyboard focus on the step's main button, so Enter carries on.
		document.querySelector<HTMLElement>('main .btn.primary:not([disabled])')?.focus();
	}

	function go(step: StudyProgress['step']) {
		if (!p) return;
		p.step = step;
		notice = '';
		commit();
		scrollTop();
	}

	function practiceDone(r: BlockResult) {
		if (!p) return;
		outbox.send('markBlock', { blockKey: p.practice.blockKey, pauses: r.pauses, pausedSeconds: r.pausedSeconds }, `pauses:${p.practice.blockKey}`);
		p.practice.done = true;
		p.index = 0;
		go('intro');
	}

	function roundDone(r: BlockResult) {
		if (!p) return;
		const round = p.rounds[p.index];
		outbox.send('markBlock', { blockKey: round.blockKey, pauses: r.pauses, pausedSeconds: r.pausedSeconds }, `pauses:${round.blockKey}`);
		round.played = true;
		go('rate');
	}

	function rated(a: RoundAnswers) {
		if (!p) return;
		const round = p.rounds[p.index];
		outbox.send('rateBlock', {
			key: `${round.blockKey}:rating`, blockKey: round.blockKey, clarity: a.clarity, distraction: a.distraction,
			...(a.note ? { note: a.note } : {})
		}, `rate:${round.blockKey}`);
		round.rated = true;
		p.index++;
		go(p.index < p.rounds.length ? 'intro' : 'pick');
	}

	function picked(x: Picks) {
		if (!p) return;
		p.picks = { clearest: x.clearest, leastClear: x.leastClear, comment: x.comment };
		outbox.send('rateSession', {
			key: `${p.sessionKey}:rating`, sessionKey: p.sessionKey,
			clearest: p.rounds[x.clearest].cue, leastClear: p.rounds[x.leastClear].cue,
			...(x.comment ? { comment: x.comment } : {})
		}, 'rateSession');
		outbox.send('finish', { sessionKey: p.sessionKey }, 'finish');
		go('done');
	}

	function restart() {
		if (p && p.step === 'play') {
			const r = p.rounds[p.index];
			outbox.send('markBlock', { blockKey: r.blockKey, abandoned: true }, `abandon:${r.blockKey}`);
		}
		p = null;
		notice = '';
		confirmRestart = false;
		commit();
		scrollTop();
	}

	const playing = $derived(p?.step === 'play' || p?.step === 'practice');
	const title = $derived(
		!p ? 'Study' : p.step === 'practice' || p.step === 'practice-intro' ? 'Practice · Study' : p.step === 'done' ? 'Thank you · Study'
			: p.step === 'pick' ? 'Last step · Study' : `Round ${Math.min(p.index + 1, p.rounds.length)} of ${p.rounds.length} · Study`
	);
	if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__ccStudy = { get progress() { return p; }, outbox };
</script>

<svelte:head><title>{title} · Circle Chase</title></svelte:head>

{#if !loaded}
	<Page width="narrow"><p class="loading">Loading...</p></Page>
{:else if !p}
	<Welcome total={CUES.length} quick={Math.min(QUICK_SIZE, CUES.length)} busy={starting} error={startError} onstart={start} />
{:else if p.step === 'practice-intro' || p.step === 'intro'}
	{@const practice = p.step === 'practice-intro'}
	<Page width="narrow">
		<div class="intro">
			{#if notice}<p class="notice" role="status">{notice}</p>{/if}
			<ol class="steps" aria-label="Progress">
				<li class:done={p.practice.done} class:now={practice}><span class="visually-hidden">Practice</span></li>
				{#each p.rounds as r, i (i)}
					<li class:done={r.rated} class:now={!practice && i === p.index}><span class="visually-hidden">Round {i + 1}{r.rated ? ', done' : ''}</span></li>
				{/each}
			</ol>
			{#if practice}
				<p class="eyebrow">Practice round</p>
				<h1>Get used to the controls</h1>
				<p class="lead">About {PRACTICE} seconds of play. It does not count, so try catching a scared ghost or two.</p>
			{:else}
				<p class="eyebrow">{p.index === 0 ? 'Practice done' : `${p.index} of ${p.rounds.length} done`}</p>
				<h1>Round {p.index + 1} of {p.rounds.length}</h1>
				<p class="lead">The game may show how much power is left in a different way each round. Play to win.</p>
			{/if}
			<p class="keys"><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>↓</Kbd><Kbd>→</Kbd> or <Kbd>W</Kbd><Kbd>A</Kbd><Kbd>S</Kbd><Kbd>D</Kbd> to move, <Kbd>P</Kbd> to pause. The round ends by itself after about a minute and a half.</p>
			<div class="go">
				<Button variant="primary" size="lg" onclick={() => go(practice ? 'practice' : 'play')}>
					{practice ? 'Start practice' : `Start round ${p.index + 1}`}
				</Button>
				<button class="link" onclick={() => (confirmRestart = true)}>Start over</button>
			</div>
		</div>
	</Page>
{:else if p.step === 'practice'}
	<div class="stage">
		{#key p.practice.blockKey}
			<StudyBlock
				cue={cueById('none')} label="Practice" practice sessionKey={p.sessionKey} {cueOrder} blockIndex={-1}
				blockKey={p.practice.blockKey} seed={p.practice.seed} nickname={p.nickname} bind:sound={p.sound}
				target={Infinity} cap={PRACTICE} ondone={practiceDone}
			/>
		{/key}
	</div>
{:else if p.step === 'play'}
	{@const round = p.rounds[p.index]}
	<div class="stage">
		{#key round.blockKey}
			<StudyBlock
				cue={roundCues[p.index]} label="Round {p.index + 1} of {p.rounds.length}" sessionKey={p.sessionKey} {cueOrder}
				blockIndex={p.index} blockKey={round.blockKey} seed={round.seed} nickname={p.nickname} bind:sound={p.sound}
				target={TARGET} cap={CAP} ondone={roundDone}
			/>
		{/key}
	</div>
{:else if p.step === 'rate'}
	<RateRound round={p.index + 1} of={p.rounds.length} last={p.index === p.rounds.length - 1} onsubmit={rated} />
{:else if p.step === 'pick'}
	<PickRounds cues={roundCues} onsubmit={picked} />
{:else}
	<StudyResults
		sessionKey={p.sessionKey} pending={outbox.state.pending} onrestart={restart}
		clearest={p.picks.clearest !== null ? p.rounds[p.picks.clearest].cue : null}
		leastClear={p.picks.leastClear !== null ? p.rounds[p.picks.leastClear].cue : null}
	/>
{/if}

{#if playing && outbox.state.failing}
	<p class="offline" role="status">Offline: your answers are kept on this device and sent when the connection is back.</p>
{/if}

<Dialog bind:open={confirmRestart} title="Start over?" width="sm">
	<p>Your progress in this session will be cleared and a new session starts from the welcome screen. What you played so far stays saved.</p>
	{#snippet actions()}
		<Button onclick={() => (confirmRestart = false)}>Keep going</Button>
		<Button variant="danger" onclick={restart}>Start over</Button>
	{/snippet}
</Dialog>

<style>
	.loading { color: var(--ink-dim); padding: var(--space-6) 0; }
	.intro { display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-6) 0 var(--space-7); }
	.notice { padding: var(--space-3) var(--space-4); border: 1px solid var(--rule-strong); border-radius: var(--radius-md); background: var(--surface); color: var(--ink-dim); }
	.steps { display: flex; gap: 6px; margin: 0; padding: 0; list-style: none; }
	.steps li { flex: 1; max-width: 48px; height: 6px; border-radius: var(--radius-pill); background: var(--surface-3); }
	.steps li:first-child { max-width: 24px; }
	.steps li.done { background: var(--ink-dim); }
	.steps li.now { background: var(--accent); }
	.eyebrow { color: var(--accent); }
	h1 { font-size: var(--text-3xl); font-weight: 600; line-height: 1.05; }
	.lead { color: var(--ink-dim); font-size: var(--text-lg); max-width: 52ch; }
	.keys { color: var(--ink-faint); font-size: var(--text-sm); }
	.keys :global(kbd) { margin-right: 2px; }
	.go { display: flex; align-items: center; gap: var(--space-5); margin-top: var(--space-3); flex-wrap: wrap; }
	.link { background: none; border: 0; padding: 0; color: var(--ink-dim); font: inherit; font-size: var(--text-sm); text-decoration: underline; cursor: pointer; }
	.stage { display: flex; flex-direction: column; padding: var(--space-3) var(--gutter); min-height: 0; }
	.offline { position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: var(--radius-pill); background: var(--surface-3); color: var(--warn); font-size: var(--text-sm); }
</style>
