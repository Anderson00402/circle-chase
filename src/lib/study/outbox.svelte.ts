/**
 * The app's one write outbox: every telemetry and run-console write goes through here.
 *
 *   startOutbox(client)        once, in the root layout (adopts writes left by closed pages)
 *   outboxStatus               reactive: { state, pending, failing, failingCount, lastError, savedAt }
 *   getOutbox(client).send(fn, args, { id?, lane?, onDone? })
 *
 * Promises:
 * - **Nothing is dropped.** A write is retried with back-off (up to 30 s apart) for as long as the
 *   page lives, and it is kept in localStorage until Convex has it, so a closed tab, a refresh or
 *   a lost connection only delays it. Every write is idempotent by a key, so sending one twice is
 *   harmless.
 * - **Order where it matters.** Writes with the same `lane` (a session key) go in order: a trial is
 *   never sent before its session and block. A lane whose head keeps failing waits; other lanes go on.
 * - **Rows that are not there yet.** The run notes (`setup`, `markBlock`) and ratings answer null
 *   while the session or block they belong to has not arrived (it may still be in another tab's
 *   queue); they are tried again every few seconds and do not count as failing.
 * - **Leftovers.** Each tab keeps its queue under its own storage key with a heartbeat. Entries
 *   whose tab has gone quiet (closed, crashed) are adopted by any live page, also the console alone,
 *   including the older formats (`cc.queue.*`, `cc.run.outbox`).
 */
import type { ConvexClient } from 'convex/browser';
import { api } from '#convex/_generated/api.js';
import { connection } from '../ui/connection.svelte.ts';

const FNS = {
	ensure: api.participants.ensure,
	sessionStart: api.sessions.start,
	sessionUpdate: api.sessions.update,
	blockStart: api.blocks.start,
	blockEnd: api.blocks.end,
	trial: api.trials.save,
	rateBlock: api.ratings.saveBlock,
	rateSession: api.ratings.saveSession,
	setup: api.runs.setup,
	markBlock: api.runs.markBlock
} as const;
export type OutboxFn = keyof typeof FNS;

/** These answer null while the row they refer to does not exist yet: wait, do not count as failing. */
const WAITS = new Set<OutboxFn>(['setup', 'markBlock', 'rateBlock', 'rateSession', 'sessionUpdate', 'blockEnd']);

interface Job {
	id: string;
	fn: OutboxFn;
	args: Record<string, unknown>;
	lane?: string;
	/** Errors so far (not counting "not there yet"). */
	tries: number;
	/** Times the row it refers to was not there yet (cleared once it goes through). */
	waits?: number;
	/** Not before this time (ms): back-off. */
	at?: number;
	lastError?: string;
}

export type OutboxState = 'saved' | 'saving' | 'offline' | 'failing';

export interface OutboxStatus {
	/** saved: nothing waiting. saving: on the way. offline: waiting for the connection. failing: some writes keep erroring. */
	state: OutboxState;
	/** Writes on the way (not counting `waiting`). */
	pending: number;
	/** Notes waiting for their session or block to be played (a label typed before the first run). */
	waiting: number;
	/** Some write has failed 3 times or more in a row (it is still kept and tried again). */
	failing: boolean;
	failingCount: number;
	lastError: string | null;
	/** When a write last went through (ms), null before the first. */
	savedAt: number | null;
}

/** The outbox status (reactive). Pass it to the header's status, or read `.state`. */
export const outboxStatus: OutboxStatus = $state({ state: 'saved', pending: 0, waiting: 0, failing: false, failingCount: 0, lastError: null, savedAt: null });

export interface SendOptions {
	/** Queuing the same id again replaces the waiting one (default: a new id). */
	id?: string;
	/** Writes of one lane go in order (use the session key). Default: none (independent). */
	lane?: string;
	/** Called once Convex has the write, with its result (not kept across pages). */
	onDone?: (result: unknown) => void;
}

export interface Outbox {
	send(fn: OutboxFn, args: Record<string, unknown>, opts?: SendOptions | string): string;
	/** Writes waiting (all, or those whose id starts with `prefix`). */
	count(prefix?: string): number;
	/** Resolves when nothing (with `prefix`: nothing of those) is waiting, or after `timeout` ms. */
	flush(timeout?: number, prefix?: string): Promise<void>;
	/** Status (same object as `outboxStatus`). */
	readonly state: OutboxStatus;
	/** Write the queue to storage now (the page is going away). */
	persist(): void;
}

// ---------- storage ----------

const PREFIX = 'cc.outbox.';
const LEGACY_QUEUE = 'cc.queue.';
const LEGACY_RUN = 'cc.run.outbox';
/** A tab rewrites its entry at least this often while it has writes; quieter entries are adopted. */
const BEAT_MS = 3000;
const STALE_MS = 12_000;

function storage(): Storage | null {
	try { return window.localStorage; } catch { return null; }
}

/** ArrayBuffers (series, clips) do not survive JSON; store them as base64. */
export function encodeJobs(value: unknown): string {
	return JSON.stringify(value, (_k, v) => {
		if (v instanceof ArrayBuffer) {
			let s = '';
			const b = new Uint8Array(v);
			for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
			return { __b64: btoa(s) };
		}
		return v;
	});
}
export function decodeJobs<T>(text: string): T {
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

/** Back-off after `tries` errors: 0.5 s, 1 s, 2 s... capped at 30 s, with a little jitter. */
export function backoff(tries: number): number {
	return Math.min(30_000, 500 * 2 ** Math.max(0, tries - 1)) * (0.85 + Math.random() * 0.3);
}

/** The lane of a job in an older stored format (ordered by session where the args say which). */
function laneOf(fn: string, args: Record<string, unknown>): string | undefined {
	if (fn === 'sessionStart' || fn === 'sessionUpdate') return String(args.key);
	if (fn === 'blockStart' || fn === 'trial') return String(args.sessionKey);
	return undefined;
}

// ---------- the outbox ----------

let shared: Outbox | null = null;

/** Start the app's outbox (idempotent). Call once from the root layout. */
export function startOutbox(client: ConvexClient): Outbox {
	return (shared ??= createOutbox(client));
}

/** The app's outbox (started on first use if the layout has not yet). */
export const getOutbox = startOutbox;

function createOutbox(client: ConvexClient): Outbox {
	const self = PREFIX + uid();
	let jobs: Job[] = [];
	const callbacks = new Map<string, (r: unknown) => void>();
	let busy = false, timer: ReturnType<typeof setTimeout> | null = null;
	let lastBeat = 0;

	function persist() {
		const s = storage();
		if (!s) return;
		lastBeat = Date.now();
		try {
			if (jobs.length) s.setItem(self, encodeJobs({ at: lastBeat, jobs }));
			else s.removeItem(self);
		} catch { /* storage full or blocked: the in-memory queue still works */ }
	}

	function refresh() {
		const now = Date.now();
		const failing = jobs.filter((j) => j.tries >= 3);
		const waiting = jobs.filter((j) => j.waits && !j.tries).length;
		outboxStatus.pending = jobs.length - waiting;
		outboxStatus.waiting = waiting;
		outboxStatus.failingCount = failing.length;
		outboxStatus.failing = failing.length > 0;
		outboxStatus.lastError = failing[0]?.lastError ?? null;
		const online = connection.status === 'connected' || connection.status === 'connecting';
		outboxStatus.state = failing.length ? 'failing' : jobs.length === waiting ? 'saved' : !online ? 'offline' : 'saving';
		if (jobs.length && now - lastBeat > BEAT_MS) persist();
	}

	/** Take over queues of pages that are gone (and the older formats). */
	function adopt() {
		const s = storage();
		if (!s) return;
		const now = Date.now();
		const found: Job[] = [];
		for (let i = s.length - 1; i >= 0; i--) {
			const k = s.key(i);
			if (!k || k === self) continue;
			try {
				if (k.startsWith(PREFIX)) {
					const e = decodeJobs<{ at: number; jobs: Job[] }>(s.getItem(k) ?? '{}');
					if (now - (e.at ?? 0) < STALE_MS) continue; // its tab is still alive
					found.push(...(e.jobs ?? []));
				} else if (k.startsWith(LEGACY_QUEUE)) {
					const items = decodeJobs<{ fn: OutboxFn; args: Record<string, unknown> }[]>(s.getItem(k) ?? '[]');
					found.push(...items.map((it) => ({ id: uid(), fn: it.fn, args: it.args, lane: laneOf(it.fn, it.args), tries: 0 })));
				} else if (k === LEGACY_RUN) {
					const items = JSON.parse(s.getItem(k) ?? '[]') as { id: string; fn: OutboxFn; args: Record<string, unknown> }[];
					found.push(...items.map((it) => ({ id: it.id, fn: it.fn, args: it.args, tries: 0 })));
				} else continue;
			} catch { continue; /* broken entry: leave it */ }
			s.removeItem(k);
		}
		if (!found.length) return;
		const known = new Set(jobs.map((j) => j.id));
		jobs = [...found.filter((j) => FNS[j.fn] && !known.has(j.id)).map((j) => ({ ...j, tries: 0, at: undefined })), ...jobs];
		persist();
		kick();
	}

	function kick(delay = 0) {
		if (timer) { clearTimeout(timer); timer = null; }
		if (delay) timer = setTimeout(() => { timer = null; pump(); }, delay);
		else queueMicrotask(pump);
	}

	/**
	 * One pass over the queue. In a lane only the first job is tried; a job backing off (or waiting
	 * for its row) holds its lane but not the others.
	 */
	async function pump() {
		if (busy) return;
		busy = true;
		try {
			const held = new Set<string>();
			for (const job of [...jobs]) {
				if (!jobs.includes(job)) continue;
				if (job.lane && held.has(job.lane)) continue;
				if (job.at && job.at > Date.now()) { if (job.lane) held.add(job.lane); continue; }
				let waiting = false;
				try {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const res = await client.mutation(FNS[job.fn] as any, job.args as any);
					if (res === null && WAITS.has(job.fn)) { waiting = true; throw new Error('not there yet'); }
					jobs = jobs.filter((j) => j !== job);
					outboxStatus.savedAt = Date.now();
					const cb = callbacks.get(job.id);
					callbacks.delete(job.id);
					try { cb?.(res); } catch (err) { console.error('[outbox] callback', err); }
				} catch (err) {
					if (waiting) {
						// Every 3 s at first, then every 15 s: the row may only come with the first run.
						job.waits = (job.waits ?? 0) + 1;
						job.at = Date.now() + Math.min(15_000, 3000 * (1 + Math.floor(job.waits / 20)));
					} else {
						job.tries++;
						job.lastError = String((err as Error)?.message ?? err).slice(0, 300);
						job.at = Date.now() + backoff(job.tries);
						if (job.tries === 3) console.warn('[outbox] still failing (kept, will retry):', job.fn, job.lastError);
					}
					if (job.lane) held.add(job.lane);
				}
				persist();
				refresh();
			}
		} finally {
			busy = false;
		}
		refresh();
		if (jobs.length) {
			const next = Math.min(...jobs.map((j) => j.at ?? 0));
			kick(Math.max(200, next - Date.now()));
		}
	}

	function count(prefix?: string) {
		return prefix ? jobs.filter((j) => j.id.startsWith(prefix)).length : jobs.length;
	}

	// Writes left behind by a page whose tab is still open are picked up once that tab goes quiet.
	jobs = [];
	adopt();
	setInterval(() => { adopt(); refresh(); }, 5000);
	const onOnline = () => { for (const j of jobs) j.at = undefined; kick(); };
	window.addEventListener('online', onOnline);
	window.addEventListener('pagehide', persist);
	document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });
	refresh();

	return {
		state: outboxStatus,
		send(fn, args, opts) {
			const o: SendOptions = typeof opts === 'string' ? { id: opts } : opts ?? {};
			const id = o.id ?? uid();
			const job: Job = { id, fn, args, tries: 0, ...(o.lane ? { lane: o.lane } : {}) };
			const at = jobs.findIndex((j) => j.id === id);
			if (at >= 0) jobs[at] = job;
			else jobs.push(job);
			if (o.onDone) callbacks.set(id, o.onDone);
			persist();
			refresh();
			kick();
			return id;
		},
		count,
		async flush(timeout = 4000, prefix) {
			const until = Date.now() + timeout;
			while (count(prefix) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
		},
		persist
	};
}
