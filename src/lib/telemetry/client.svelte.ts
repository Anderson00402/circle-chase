/**
 * Browser side of telemetry: wires the tracker and the clip recorder to Convex.
 *
 *   const tel = createTelemetry(useConvexClient(), { cue: cue.id, mode: 'arcade' });
 *   <Game onframe={tel.onFrame} onstart={tel.onStart} />
 *   tel.live.readout / tel.live.recent  (reactive)
 *
 * It never blocks or breaks the game: every write goes through a queue that is processed one item
 * at a time in the background, retried with back-off, kept in localStorage so nothing is lost when
 * the page closes or Convex is unreachable, and picked up again on the next visit. All writes are
 * idempotent by a key made here, so sending one twice is harmless.
 */
import type { ConvexClient } from 'convex/browser';
import { api } from '#convex/_generated/api.js';
import { packSeries } from '#convex/lib/series.ts';
import type { Game, Scene } from '../game/types';
import { createRecorder } from './recorder';
import { createTracker } from './tracker';
import type { LiveReadout, Outcome, TrialMeasures } from './types';
import pkg from '../../../package.json';

export const APP_VERSION: string = pkg.version;

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
	/** Trials stored in this block. */
	saved: number;
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

// ---------- write queue ----------

const FNS = {
	ensure: api.participants.ensure,
	sessionStart: api.sessions.start,
	sessionUpdate: api.sessions.update,
	blockStart: api.blocks.start,
	blockEnd: api.blocks.end,
	trial: api.trials.save,
	rateBlock: api.ratings.saveBlock,
	rateSession: api.ratings.saveSession
} as const;
type FnName = keyof typeof FNS;
interface Item { fn: FnName; args: Record<string, unknown>; tries: number; tag?: string }

const STORE_PREFIX = 'cc.queue.';
const MAX_TRIES = 6;

function storage(): Storage | null {
	try { return window.localStorage; } catch { return null; }
}

/** ArrayBuffers do not survive JSON; store them as base64. */
function toJSON(items: Item[]): string {
	return JSON.stringify(items, (_k, v) => {
		if (v instanceof ArrayBuffer) {
			let s = '';
			const b = new Uint8Array(v);
			for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
			return { __b64: btoa(s) };
		}
		return v;
	});
}
function fromJSON(text: string): Item[] {
	return JSON.parse(text, (_k, v) => {
		if (v && typeof v === 'object' && typeof v.__b64 === 'string') {
			const s = atob(v.__b64);
			const b = new Uint8Array(s.length);
			for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
			return b.buffer;
		}
		return v;
	});
}

function uid(): string {
	try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function detectSource(): Source {
	try {
		if (navigator.webdriver) return 'bot';
		if (new URLSearchParams(location.search).has('bot')) return 'bot';
	} catch { /* not in a browser */ }
	return 'human';
}

function participantId(source: Source): string {
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

function inputLabel(seen: Set<string>): string {
	if (seen.size === 0) return 'none';
	if (seen.size > 1) return 'mixed';
	return [...seen][0];
}

const MOVE_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD']);

export function createTelemetry(client: ConvexClient, ctx: TelemetryContext): Telemetry {
	const source = ctx.source ?? detectSource();
	const pid = participantId(source);
	const sessionKey = ctx.session?.key ?? freePlaySession(ctx.mode, false).key;
	const blockKey = uid();
	const instance = uid();
	const sound = ctx.sound ?? (() => true);

	const live: TelemetryLive = $state({
		readout: { state: 'idle', left: 0, total: 0, nearest: null, chasing: false, engaged: false, guess: null },
		recent: [], pending: 0, online: true, saved: 0, source, participantNumber: null
	});

	// ----- queue -----
	let queue: Item[] = [];
	let busy = false, retryTimer: ReturnType<typeof setTimeout> | null = null, destroyed = false;
	// A write that hangs means Convex cannot be reached (a stalled socket does not always close).
	let stuck = false;

	function persist() {
		const s = storage();
		if (!s) return;
		try {
			if (queue.length) s.setItem(STORE_PREFIX + instance, toJSON(queue));
			else s.removeItem(STORE_PREFIX + instance);
		} catch { /* storage full: the in-memory queue still works */ }
	}

	/** Writes left behind by an earlier page (closed before they were sent). */
	function adoptLeftovers() {
		const s = storage();
		if (!s) return;
		for (let i = s.length - 1; i >= 0; i--) {
			const k = s.key(i);
			if (!k || !k.startsWith(STORE_PREFIX) || k === STORE_PREFIX + instance) continue;
			try { queue.push(...fromJSON(s.getItem(k) ?? '[]').map((it) => ({ ...it, tries: 0 }))); } catch { /* broken entry */ }
			s.removeItem(k);
		}
	}

	function enqueue(fn: FnName, args: Record<string, unknown>, tag?: string) {
		queue.push({ fn, args, tries: 0, tag });
		live.pending = queue.length;
		persist();
		pump();
	}

	async function pump() {
		if (busy || destroyed && !queue.length) return;
		busy = true;
		try {
			while (queue.length) {
				const item = queue[0];
				const watch = setTimeout(() => { stuck = true; live.online = false; }, 4000);
				try {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const res = await client.mutation(FNS[item.fn] as any, item.args as any);
					queue.shift();
					onSent(item, res);
				} catch (err) {
					item.tries++;
					if (item.tries >= MAX_TRIES) {
						console.warn('[telemetry] giving up on', item.fn, err);
						queue.shift();
					} else {
						const wait = Math.min(30_000, 500 * 2 ** item.tries);
						retryTimer = setTimeout(() => { retryTimer = null; pump(); }, wait);
						break;
					}
				} finally {
					clearTimeout(watch);
					stuck = false;
				}
				live.pending = queue.length;
				persist();
			}
		} finally {
			busy = false;
		}
	}

	function onSent(item: Item, res: unknown) {
		if (item.fn === 'ensure') live.participantNumber = (res as { number: number }).number;
		if (item.fn === 'trial') {
			live.saved++;
			const r = live.recent.find((x) => x.key === item.args.key);
			if (r) r.saved = true;
		}
	}

	// ----- session and block -----
	const inputSeen = new Set<string>(), trialInput = new Set<string>();
	adoptLeftovers();
	enqueue('ensure', { pid, source, device: deviceInfo(), ...(ctx.nickname ? { nickname: ctx.nickname } : {}) });
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
		enqueue('blockStart', { key: blockKey, sessionKey, cue: ctx.cue, orderIndex: blockIndex });
	}

	// ----- measuring -----
	const tracker = createTracker();
	const recorder = createRecorder();
	let trialIndex = 0, deathsBefore = 0, scoreBefore = 0, lastScore = 0, lastLevel = 1, powerLeft = 0;
	let game: Game | null = null;
	let lastFrameAt = 0, lastLiveAt = 0, ended = false;

	function store(trial: TrialMeasures) {
		const key = uid();
		const keepClip = trial.engaged || trial.after.caught;
		const clip = keepClip ? recorder.clipFor(trial, ctx.cue) : null;
		const { series, ...m } = trial;
		enqueue('trial', {
			key, sessionKey, blockKey, trialIndex: trialIndex++, sound: sound(), reducedMotion: reducedMotion(),
			inputType: inputLabel(trialInput), appVersion: APP_VERSION, difficulty: ctx.difficulty ?? 'normal',
			...m, series: packSeries(series), ...(clip ? { clip } : {})
		}, 'trial');
		trialInput.clear();
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
		for (const t of tracker.onScene(scene)) store(t);
		const f = scene.frame;
		lastScore = f.score;
		lastLevel = f.level;
		powerLeft = f.power.left;
		const now = performance.now();
		lastFrameAt = now;
		// The panel does not need 60 updates a second.
		if (now - lastLiveAt > 100) {
			lastLiveAt = now;
			live.readout = tracker.live;
		}
	}

	function onStart(g: Game) {
		if (game && game !== g) {
			for (const t of tracker.finish()) store(t);
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
		try { live.online = !stuck && client.connectionState().isWebSocketConnected; } catch { /* ignore */ }
	}, 1000);

	function closeBlock() {
		if (ended) return;
		ended = true;
		if (!opened) return;
		for (const t of tracker.finish()) store(t);
		enqueue('blockEnd', { key: blockKey, deaths: deathsBefore + (game?.deaths ?? 0), score: scoreBefore + lastScore });
		client.mutation(api.presence.leave, { sessionKey }).catch(() => {});
	}

	function onHide() {
		closeBlock();
		persist();
	}
	function onShow(ev: PageTransitionEvent) {
		// Back from the back/forward cache: keep recording into the same block.
		if (ev.persisted) { ended = false; pump(); }
	}
	function onVisibility() { if (document.visibilityState === 'hidden') persist(); }

	window.addEventListener('keydown', onKey, true);
	window.addEventListener('pointerdown', onPointer, true);
	window.addEventListener('pagehide', onHide);
	window.addEventListener('pageshow', onShow);
	document.addEventListener('visibilitychange', onVisibility);

	return {
		onFrame,
		onStart,
		live,
		keys: { pid, sessionKey, blockKey },
		async endBlock(timeout = 3000) {
			closeBlock();
			const until = Date.now() + timeout;
			while (queue.length && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
		},
		endSession() {
			if (opened) enqueue('sessionUpdate', { key: sessionKey, end: true });
		},
		rateBlock(clarity, distraction) {
			if (!opened) open();
			enqueue('rateBlock', { key: blockKey + ':rating', blockKey, clarity, distraction });
		},
		rateSession(a) {
			if (!opened) open();
			enqueue('rateSession', { key: sessionKey + ':rating', sessionKey, ...a });
		},
		destroy() {
			destroyed = true;
			clearInterval(beat);
			clearInterval(conn);
			if (retryTimer) clearTimeout(retryTimer);
			persist();
			window.removeEventListener('keydown', onKey, true);
			window.removeEventListener('pointerdown', onPointer, true);
			window.removeEventListener('pagehide', onHide);
			window.removeEventListener('pageshow', onShow);
			document.removeEventListener('visibilitychange', onVisibility);
		}
	};
}
