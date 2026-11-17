/**
 * The app's one write outbox: every telemetry and run-console write goes through here.
 *
 *   startOutbox(client)        once, in the root layout (adopts writes left by closed pages)
 *   outboxStatus               reactive: { state, pending, failing, failingCount, lastError, parked, parkedWrites, savedAt }
 *   getOutbox(client).send(fn, args, { id?, lane?, onDone?, about? })
 *   retryParked(id?), discardParked(id), parkedJson()   what the researcher can do with parked writes
 *   <OutboxParked />           (outbox-parked.svelte) the small button and panel that lists them
 *
 * Promises:
 * - **Nothing is dropped.** A write is retried with back-off (up to 30 s apart) for as long as the
 *   page lives, and it is kept in localStorage until Convex has it, so a closed tab, a refresh or
 *   a lost connection only delays it. Every write is idempotent by a key, so sending one twice is
 *   harmless.
 * - **Order where it matters.** Writes with the same `lane` (a session key) go in order: a trial is
 *   never sent before its session and block. A lane whose head keeps failing waits; other lanes go on.
 * - **One bad write does not hold the rest.** A write the server keeps rejecting (not a lost
 *   connection: that only delays) is *parked* after `PARK_AFTER` rejections: it stays stored, is
 *   tried again every `PARKED_RETRY_MS`, counts as failing with its error (`parked`, `parkedErrors`),
 *   and no longer holds its lane, so the later writes of its session go on. It is never counted as
 *   "on the way" (`pending`): it is listed in `parkedWrites` (what, whose, the server's error, since
 *   when), and the researcher can try it again now, download it as JSON or discard it. A parked
 *   write stays parked (with its count and error) when another page adopts it.
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
/** The Convex function each write calls, for the JSON download. */
const FN_NAMES: Record<OutboxFn, string> = {
	ensure: 'participants:ensure', sessionStart: 'sessions:start', sessionUpdate: 'sessions:update',
	blockStart: 'blocks:start', blockEnd: 'blocks:end', trial: 'trials:save', rateBlock: 'ratings:saveBlock',
	rateSession: 'ratings:saveSession', setup: 'runs:setup', markBlock: 'runs:markBlock'
};

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
	/** Rejected by the server `PARK_AFTER` times: retried slowly, no longer holds its lane. */
	parked?: boolean;
	/** Not before this time (ms): back-off. */
	at?: number;
	lastError?: string;
	/** When it was queued, first rejected, parked and last tried (ms). */
	queuedAt?: number;
	firstErrorAt?: number;
	parkedAt?: number;
	lastTryAt?: number;
	/** Who and what it is about, for the researcher (participant label, case). */
	about?: WriteAbout;
}

/** Context a caller can attach to a write so a stuck one can be named in plain words. */
export interface WriteAbout {
	participant?: string | null;
	cue?: string | null;
}

/** A write the server kept rejecting, as the researcher sees it. */
export interface ParkedWrite {
	id: string;
	fn: OutboxFn;
	/** Plain words: "Power-up 3 (trial)", "Answers after a run"... */
	what: string;
	/** Participant label when known. */
	participant: string | null;
	/** The session key (one run console participant or one play page). */
	session: string | null;
	cue: string | null;
	/** The server's last error. */
	error: string;
	tries: number;
	queuedAt: number | null;
	firstErrorAt: number | null;
	parkedAt: number | null;
	lastTryAt: number | null;
}

export type OutboxState = 'saved' | 'saving' | 'offline' | 'failing';

export interface OutboxStatus {
	/** saved: nothing waiting. saving: on the way. offline: waiting for the connection. failing: some writes keep erroring. */
	state: OutboxState;
	/** Writes on the way (not counting `waiting` or `parked`: a parked write is not on the way). */
	pending: number;
	/** Notes waiting for their session or block to be played (a label typed before the first run). */
	waiting: number;
	/** Some write has failed 3 times or more in a row (it is still kept and tried again). */
	failing: boolean;
	failingCount: number;
	lastError: string | null;
	/** Writes the server kept rejecting, set aside so the rest go on (still stored, still retried, counted in `failingCount`). */
	parked: number;
	/** What those writes are and why they fail, oldest first (at most 5). */
	parkedErrors: { fn: string; error: string }[];
	/** Every parked write in full, oldest first (for the panel: `OutboxParked`). */
	parkedWrites: ParkedWrite[];
	/** When a write last went through (ms), null before the first. */
	savedAt: number | null;
}

/** The outbox status (reactive). Pass it to the header's status, or read `.state`. */
export const outboxStatus: OutboxStatus = $state({ state: 'saved', pending: 0, waiting: 0, failing: false, failingCount: 0, lastError: null, parked: 0, parkedErrors: [], parkedWrites: [], savedAt: null });

export interface SendOptions {
	/** Queuing the same id again replaces the waiting one (default: a new id). */
	id?: string;
	/** Writes of one lane go in order (use the session key). Default: none (independent). */
	lane?: string;
	/** Called once Convex has the write, with its result (not kept across pages). */
	onDone?: (result: unknown) => void;
	/** Who and what it is about, shown if the write gets stuck. */
	about?: WriteAbout;
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
	/** Try parked writes again now (one by id, or all). */
	retryParked(id?: string): void;
	/** Drop a parked write for good (only parked ones; the caller confirms first). Returns whether one was dropped. */
	discardParked(id: string): boolean;
	/** Parked writes with their stored arguments, as JSON text (bytes as base64), for a download. */
	parkedJson(id?: string): string;
}

// ---------- storage ----------

const PREFIX = 'cc.outbox.';
const LEGACY_QUEUE = 'cc.queue.';
const LEGACY_RUN = 'cc.run.outbox';
/** A tab rewrites its entry at least this often while it has writes; quieter entries are adopted. */
const BEAT_MS = 3000;
const STALE_MS = 12_000;
/** Server rejections in a row after which a write is parked (about a minute and a half of back-off). */
export const PARK_AFTER = 8;
/** A parked write is tried again this often. */
export const PARKED_RETRY_MS = 5 * 60_000;

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

/** Plain words for a write, for the parked list. */
const WHAT: Record<OutboxFn, string> = {
	ensure: 'Participant record',
	sessionStart: 'Start of a session',
	sessionUpdate: 'Session details',
	blockStart: 'Start of a run',
	blockEnd: 'End of a run',
	trial: 'Power-up',
	rateBlock: 'Answers after a run',
	rateSession: 'Answers at the end',
	setup: 'Participant label and case order',
	markBlock: 'Run notes (pauses)'
};

const str = (x: unknown): string | null => (typeof x === 'string' && x ? x : null);

export function describeWrite(job: Job): ParkedWrite {
	const a = job.args;
	const run = (a.run ?? null) as { participantLabel?: string } | null;
	const index = typeof a.trialIndex === 'number' ? ` ${a.trialIndex + 1}` : '';
	return {
		id: job.id, fn: job.fn,
		what: WHAT[job.fn] + (job.fn === 'trial' ? index : ''),
		participant: job.about?.participant ?? str(run?.participantLabel) ?? str(a.nickname) ?? null,
		session: str(a.sessionKey) ?? (job.fn === 'sessionStart' || job.fn === 'sessionUpdate' ? str(a.key) : null),
		cue: job.about?.cue ?? str(a.cue) ?? null,
		error: job.lastError ?? '', tries: job.tries,
		queuedAt: job.queuedAt ?? null, firstErrorAt: job.firstErrorAt ?? null, parkedAt: job.parkedAt ?? null, lastTryAt: job.lastTryAt ?? null
	};
}

// ---------- the outbox ----------

let shared: Outbox | null = null;

/** Start the app's outbox (idempotent). Call once from the root layout. */
export function startOutbox(client: ConvexClient): Outbox {
	return (shared ??= createOutbox(client));
}

/** The app's outbox (started on first use if the layout has not yet). */
export const getOutbox = startOutbox;

/** Try parked writes again now (one, or all). Does nothing before the outbox started. */
export function retryParked(id?: string): void { shared?.retryParked(id); }
/** Drop a parked write for good (confirm with the researcher first). */
export function discardParked(id: string): boolean { return shared?.discardParked(id) ?? false; }
/** Parked writes (one, or all) as JSON text for a download. */
export function parkedJson(id?: string): string { return shared?.parkedJson(id) ?? '{"writes":[]}'; }

/** A new outbox (the app uses the one from `startOutbox`; tests make their own). */
export function createOutbox(client: ConvexClient): Outbox {
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
		outboxStatus.waiting = waiting;
		const parked = jobs.filter((j) => j.parked);
		// A parked write is not on the way: it is listed apart, never counted as pending.
		outboxStatus.pending = jobs.length - waiting - parked.length;
		outboxStatus.parkedWrites = parked.map(describeWrite);
		outboxStatus.failingCount = failing.length;
		outboxStatus.failing = failing.length > 0;
		outboxStatus.lastError = failing[0]?.lastError ?? null;
		outboxStatus.parked = parked.length;
		outboxStatus.parkedErrors = parked.slice(0, 5).map((j) => ({ fn: j.fn, error: j.lastError ?? '' }));
		const online = connection.status === 'connected' || connection.status === 'connecting';
		outboxStatus.state = failing.length ? (online ? 'failing' : 'offline') : jobs.length === waiting ? 'saved' : !online ? 'offline' : 'saving';
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
		// A fresh start for writes that were only delayed; a parked write keeps its count, its error and
		// its slow retry (it was rejected, not delayed), so it is never shown as "on the way" again.
		jobs = [...found.filter((j) => FNS[j.fn] && !known.has(j.id)).map((j) => (j.parked ? { ...j, at: Math.min(j.at ?? 0, Date.now() + PARKED_RETRY_MS) } : { ...j, tries: 0, at: undefined })), ...jobs];
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
				// A parked write neither waits for its lane nor holds it.
				const holds = !!job.lane && !job.parked;
				if (holds && held.has(job.lane!)) continue;
				if (job.at && job.at > Date.now()) { if (holds) held.add(job.lane!); continue; }
				let waiting = false;
				job.lastTryAt = Date.now();
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
						job.firstErrorAt ??= Date.now();
						job.lastError = String((err as Error)?.message ?? err).slice(0, 300);
						job.at = Date.now() + backoff(job.tries);
						if (job.tries === 3) console.warn('[outbox] still failing (kept, will retry):', job.fn, job.lastError);
						// The server keeps rejecting it (a lost connection only delays writes, it does not
						// reject them): set it aside so the rest of its lane goes on.
						if (!job.parked && job.tries >= PARK_AFTER && connection.status !== 'offline') {
							job.parked = true;
							job.parkedAt = Date.now();
							console.warn('[outbox] parked (kept, tried again every 5 minutes; later writes go on):', job.fn, job.lastError);
						}
						if (job.parked) job.at = Date.now() + PARKED_RETRY_MS;
					}
					if (job.lane && !job.parked) held.add(job.lane);
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
			const job: Job = { id, fn, args, tries: 0, queuedAt: Date.now(), ...(o.lane ? { lane: o.lane } : {}), ...(o.about ? { about: o.about } : {}) };
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
		persist,
		retryParked(id) {
			for (const j of jobs) if (j.parked && (!id || j.id === id)) j.at = undefined;
			persist();
			kick();
		},
		discardParked(id) {
			const before = jobs.length;
			jobs = jobs.filter((j) => !(j.parked && j.id === id));
			if (jobs.length === before) return false;
			callbacks.delete(id);
			persist();
			refresh();
			return true;
		},
		parkedJson(id) {
			const list = jobs.filter((j) => j.parked && (!id || j.id === id)).map((j) => ({ ...describeWrite(j), function: FN_NAMES[j.fn], args: j.args }));
			return encodeJobs({ savedAt: new Date().toISOString(), note: 'Writes the database kept rejecting, kept by the outbox. Bytes (series, clips) are base64 under __b64.', writes: list });
		}
	};
}
