/**
 * Browser side of telemetry: wires the tracker and the clip recorder to Convex.
 *
 *   const tel = createTelemetry(useConvexClient(), { cue: cue.id, mode: 'arcade' });
 *   <Game onframe={tel.onFrame} onstart={tel.onStart} />
 *   tel.live.readout / tel.live.recent  (reactive)
 *
 * It never blocks or breaks the game: every write goes through the app's outbox
 * (src/lib/study/outbox.svelte.ts), in order per session, retried with back-off for as long as the
 * page lives, kept in localStorage so nothing is lost when the page closes or Convex is unreachable,
 * and picked up by the next page (the root layout starts the outbox). All writes are idempotent by
 * a key made here, so sending one twice is harmless.
 */
import type { ConvexClient } from 'convex/browser';
import { api } from '#convex/_generated/api.js';
import type { Game, Scene } from '../game/types';
import { getOutbox, type OutboxFn } from '../study/outbox.svelte.ts';
import { createRecorder } from './recorder';
import { mergeProgress, readLocal, writeLocal } from './resume';
import { createTracker } from './tracker';
import type { LiveReadout, Outcome, TrialMeasures } from './types';
import { APP_VERSION, createWriteQueue, trialWrite } from './write';
import { isDecision } from '#convex/lib/rules.ts';

export { APP_VERSION };

export type Source = 'human' | 'bot';
export type Mode = 'study' | 'arcade';

export interface TelemetryContext {
	cue: string;
	mode: Mode;
	difficulty?: string;
	/** Default: 'bot' when the browser is driven by automation (navigator.webdriver) or the URL has ?bot. */
	source?: Source;
	nickname?: string;
	/** Current sound setting. */
	sound?: () => boolean;
	/** A study flow passes its own session (and the block's position); free play makes one per tab. */
	session?: { key: string; cueOrder: string[] };
	blockIndex?: number;
	/** Study warm-up round: the block (and its trials) are stored with `practice: true`. */
	practice?: boolean;
	/** A study flow's own block key (so it can rate and annotate the block later). Default: a new one. */
	blockKey?: string;
	/** Anonymous participant id to record under (the run console makes one per participant label). Default: this browser's. */
	pid?: string;
}

export interface RecentTrial {
	key: string;
	outcome: Outcome;
	engaged: boolean;
	total: number;
	turnLeft: number | null;
	eats: number;
	hasClip: boolean;
	saved: boolean;
}

export interface TelemetryLive {
	readout: LiveReadout;
	recent: RecentTrial[];
	/** Writes waiting to be sent. */
	pending: number;
	online: boolean;
	/** Trials this page has stored in the block. */
	saved: number;
	/** Power-ups measured in this block so far (trials closed, whatever their outcome), counting those of earlier pages of a resumed run. Changes only when a trial closes. */
	measured: number;
	/** Decision trials among them (`isDecision`: the trials the rates use). Changes only when a trial closes. */
	decisions: number;
	source: Source;
	participantNumber: number | null;
}

export interface Telemetry {
	onFrame(scene: Scene, game: Game): void;
	/** A new game started (also the first). */
	onStart(game: Game): void;
	readonly live: TelemetryLive;
	readonly keys: { pid: string; sessionKey: string; blockKey: string };
	/** Close the block (running power-up is kept as `quit`). Resolves when the queue is empty or after `timeout`. */
	endBlock(timeout?: number): Promise<void>;
	endSession(): void;
	rateBlock(clarity: number, distraction: number): void;
	rateSession(answers: { clearest?: string; leastClear?: string; comment?: string }): void;
	/** Stop timers and listeners. Call `endBlock` first. */
	destroy(): void;
}

function storage(): Storage | null {
	try { return window.localStorage; } catch { return null; }
}

function uid(): string {
	try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

export function detectSource(): Source {
	try {
		if (navigator.webdriver) return 'bot';
		if (new URLSearchParams(location.search).has('bot')) return 'bot';
	} catch { /* not in a browser */ }
	return 'human';
}

/** The anonymous participant id of this browser (made on first use). */
export function participantId(source: Source): string {
	const key = source === 'bot' ? 'cc.pid.bot' : 'cc.pid';
	const s = storage();
	let pid = s?.getItem(key) ?? null;
	if (!pid) { pid = (source === 'bot' ? 'bot-' : '') + uid(); s?.setItem(key, pid); }
	return pid;
}

/**
 * Free play: one session per tab, reused until 30 minutes without play, one block per cue played.
 * `claim` takes the next block number (done when play actually starts).
 */
function freePlaySession(mode: Mode, claim: boolean): { key: string; blockIndex: number } {
	const name = `cc.session.${mode}`;
	let s: { key: string; blocks: number; at: number } | null = null;
	try { s = JSON.parse(sessionStorage.getItem(name) ?? 'null'); } catch { /* ignore */ }
	if (!s || Date.now() - s.at > 30 * 60_000) s = { key: uid(), blocks: 0, at: Date.now() };
	const blockIndex = s.blocks;
	if (claim) { s.blocks++; s.at = Date.now(); }
	try { sessionStorage.setItem(name, JSON.stringify(s)); } catch { /* ignore */ }
	return { key: s.key, blockIndex };
}

function deviceInfo() {
	return {
		userAgent: navigator.userAgent.slice(0, 300),
		platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
		language: navigator.language ?? '',
		touch: (navigator.maxTouchPoints ?? 0) > 0,
		screenW: screen.width, screenH: screen.height, dpr: window.devicePixelRatio || 1
	};
}

const viewport = () => ({ w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 });
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

function automated(): boolean {
	try { return !!navigator.webdriver; } catch { return false; }
}

/**
 * keyboard, touch, mouse, mixed (more than one), none (nothing pressed yet). In a browser driven
 * by automation the events are synthetic, so it says so: `automated` (no input events, steered by a
 * script) or `automated-keyboard` and so on.
 */
export function inputLabel(seen: Set<string>, auto = automated()): string {
	const kind = seen.size === 0 ? 'none' : seen.size > 1 ? 'mixed' : [...seen][0];
	if (!auto) return kind;
	return kind === 'none' ? 'automated' : `automated-${kind}`;
}

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export function createTelemetry(client: ConvexClient, ctx: TelemetryContext): Telemetry {
	const source = ctx.source ?? detectSource();
	const pid = ctx.pid ?? participantId(source);
	const sessionKey = ctx.session?.key ?? freePlaySession(ctx.mode, false).key;
	const blockKey = ctx.blockKey ?? uid();
	const instance = uid();
	const sound = ctx.sound ?? (() => true);

	const live: TelemetryLive = $state({
		readout: { state: 'idle', left: 0, total: 0, nearest: null, chasing: false, engaged: false, guess: null },
		recent: [], pending: 0, online: true, saved: 0, measured: 0, decisions: 0, source, participantNumber: null
	});

	// ----- writes (through the app's outbox, in order for this session) -----
	const outbox = getOutbox(client);
	const mine = `tel:${instance}:`;
	let seq = 0;
	function enqueue(fn: OutboxFn, args: Record<string, unknown>, onDone?: (r: unknown) => void) {
		outbox.send(fn, args, { id: `${mine}${seq++}`, lane: sessionKey, onDone });
		live.pending = outbox.count(mine);
	}

	// ----- session and block -----
	const inputSeen = new Set<string>(), trialInput = new Set<string>();
	enqueue('ensure', { pid, source, device: deviceInfo(), ...(ctx.nickname ? { nickname: ctx.nickname } : {}) }, (r) => {
		live.participantNumber = (r as { number: number }).number;
	});
	// The session and block are opened with the first live frame, so a page that is opened and left
	// without playing leaves no empty block behind.
	let opened = false;
	function open() {
		opened = true;
		const blockIndex = ctx.blockIndex ?? (ctx.session ? 0 : freePlaySession(ctx.mode, true).blockIndex);
		enqueue('sessionStart', {
			key: sessionKey, pid, mode: ctx.mode, source, cueOrder: ctx.session?.cueOrder ?? [], appVersion: APP_VERSION,
			difficulty: ctx.difficulty ?? 'normal', sound: sound(), reducedMotion: reducedMotion(), inputType: inputLabel(inputSeen), viewport: viewport()
		});
		enqueue('blockStart', { key: blockKey, sessionKey, cue: ctx.cue, orderIndex: blockIndex, mode: ctx.mode, segment: instance, ...(ctx.practice ? { practice: true } : {}) });
	}

	// ----- measuring -----
	const tracker = createTracker();
	const recorder = createRecorder();
	// A trial that ended in a death is stored half a second later, so its clip shows the death.
	const queue = createWriteQueue();
	// A run resumed after a refresh carries on counting (resume.ts): this browser's record now, the
	// server's once it answers, if no trial has closed on this page by then.
	const seed = readLocal(blockKey);
	let trialIndex = seed.next, ownTrials = 0;
	live.measured = seed.measured;
	live.decisions = seed.decisions;
	if (ctx.blockKey) {
		client.query(api.blocks.progress, { key: blockKey }).then((server) => {
			if (!server || ownTrials > 0) return;
			const m = mergeProgress(readLocal(blockKey), server);
			trialIndex = m.next;
			live.measured = m.measured;
			live.decisions = m.decisions;
		}).catch(() => { /* offline: the local record stands */ });
	}
	let deathsBefore = 0, scoreBefore = 0, lastScore = 0, lastLevel = 1, powerLeft = 0;
	let game: Game | null = null;
	let lastFrameAt = 0, lastLiveAt = 0, ended = false, pauses = 0, pausedSeconds = 0;

	function store(trial: TrialMeasures) {
		const key = uid();
		const args = trialWrite(trial, recorder, {
			key, sessionKey, blockKey, trialIndex: trialIndex++, cue: ctx.cue, sound: sound(), reducedMotion: reducedMotion(),
			inputType: inputLabel(trialInput), difficulty: ctx.difficulty ?? 'normal'
		});
		const clip = args.clip ?? null;
		enqueue('trial', args, () => {
			live.saved++;
			const r = live.recent.find((x) => x.key === key);
			if (r) r.saved = true;
			live.pending = outbox.count(mine);
		});
		trialInput.clear();
		ownTrials++;
		live.measured++;
		if (isDecision(trial)) live.decisions++;
		writeLocal(blockKey, { next: trialIndex, measured: live.measured, decisions: live.decisions });
		live.recent = [
			{ key, outcome: trial.outcome, engaged: trial.engaged, total: trial.total, turnLeft: trial.turnLeft, eats: trial.eats.length, hasClip: !!clip, saved: false },
			...live.recent
		].slice(0, 8);
	}

	function onFrame(scene: Scene, g: Game) {
		if (ended) return;
		if (!opened) open();
		game = g;
		recorder.push(scene);
		for (const t of tracker.onScene(scene)) queue.add(t);
		for (const t of queue.ready(scene.frame.t)) store(t);
		const f = scene.frame;
		lastScore = f.score;
		lastLevel = f.level;
		powerLeft = f.power.left;
		const now = performance.now();
		// The game sends no frames while paused (or while the tab is hidden): a gap is a pause.
		if (lastFrameAt && now - lastFrameAt > 400) { pauses++; pausedSeconds += (now - lastFrameAt) / 1000; }
		lastFrameAt = now;
		// The panel does not need 60 updates a second.
		if (now - lastLiveAt > 100) {
			lastLiveAt = now;
			live.readout = tracker.live;
		}
	}

	function onStart(g: Game) {
		if (game && game !== g) {
			for (const t of tracker.finish()) queue.add(t);
			for (const t of queue.drain()) store(t);
			deathsBefore += game.deaths;
			scoreBefore += lastScore;
		}
		tracker.reset();
		recorder.reset();
		game = g;
		lastScore = 0;
	}

	// ----- input, presence, page lifecycle -----
	function onKey(ev: KeyboardEvent) { if (MOVE_KEYS.has(ev.code)) note('keyboard'); }
	function onPointer(ev: PointerEvent) { note(ev.pointerType === 'touch' ? 'touch' : 'mouse'); }
	function note(kind: string) {
		trialInput.add(kind);
		if (!inputSeen.has(kind)) {
			inputSeen.add(kind);
			if (opened) enqueue('sessionUpdate', { key: sessionKey, inputType: inputLabel(inputSeen) });
		}
	}

	let beatBusy = false;
	async function heartbeat() {
		if (beatBusy || ended || !opened) return;
		beatBusy = true;
		try {
			await client.mutation(api.presence.heartbeat, {
				sessionKey, pid, cue: ctx.cue, mode: ctx.mode, source, ...(ctx.nickname ? { nickname: ctx.nickname } : {}),
				state: performance.now() - lastFrameAt < 2000 ? 'playing' : 'idle',
				score: lastScore, level: lastLevel, powerLeft: Math.round(powerLeft * 10) / 10
			});
		} catch { /* presence is best effort */ } finally { beatBusy = false; }
	}
	const beat = setInterval(heartbeat, 5000);
	const conn = setInterval(() => {
		live.online = outbox.state.state !== 'offline';
		live.pending = outbox.count(mine);
	}, 1000);

	function closeBlock() {
		if (ended) return;
		ended = true;
		if (!opened) return;
		for (const t of tracker.finish()) queue.add(t);
		for (const t of queue.drain()) store(t);
		enqueue('blockEnd', {
			key: blockKey, deaths: deathsBefore + (game?.deaths ?? 0), score: scoreBefore + lastScore,
			pauses, pausedSeconds: Math.round(pausedSeconds * 10) / 10, segment: instance
		});
		client.mutation(api.presence.leave, { sessionKey }).catch(() => {});
	}

	function onHide() {
		closeBlock();
		outbox.persist();
	}
	function onShow(ev: PageTransitionEvent) {
		// Back from the back/forward cache: keep recording into the same block.
		if (ev.persisted) ended = false;
	}

	window.addEventListener('keydown', onKey, true);
	window.addEventListener('pointerdown', onPointer, true);
	window.addEventListener('pagehide', onHide);
	window.addEventListener('pageshow', onShow);

	return {
		onFrame,
		onStart,
		live,
		keys: { pid, sessionKey, blockKey },
		async endBlock(timeout = 3000) {
			closeBlock();
			await outbox.flush(timeout, mine);
		},
		endSession() {
			if (opened) enqueue('sessionUpdate', { key: sessionKey, end: true });
		},
		rateBlock(clarity, distraction) {
			if (!opened) open();
			outbox.send('rateBlock', { key: blockKey + ':rating', blockKey, clarity, distraction }, { id: `rate:${blockKey}` });
		},
		rateSession(a) {
			if (!opened) open();
			outbox.send('rateSession', { key: sessionKey + ':rating', sessionKey, ...a }, { id: `rate:${sessionKey}` });
		},
		destroy() {
			clearInterval(beat);
			clearInterval(conn);
			outbox.persist();
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('pagehide', onHide);
			window.removeEventListener('pageshow', onShow);
		}
	};
}
