/**
 * The study's own writes (setup, ratings, block notes, finish), sent in order, one at a time,
 * retried with back-off and kept in localStorage until Convex has them. Gameplay (sessions, blocks,
 * trials, clips) goes through the telemetry client's queue as usual; these writes refer to rows it
 * creates, so a write that arrives first simply fails ("unknown block") and is retried a moment later.
 */
import type { ConvexClient } from 'convex/browser';
import { api } from '#convex/_generated/api.js';

const FNS = {
	setup: api.study.setup,
	finish: api.study.finish,
	markBlock: api.study.markBlock,
	rateBlock: api.ratings.saveBlock,
	rateSession: api.ratings.saveSession
} as const;
type Fn = keyof typeof FNS;
interface Job { id: string; fn: Fn; args: Record<string, unknown>; tries: number; waits?: number }

const WAITS = new Set<Fn>(['setup', 'finish', 'markBlock']);
const KEY = 'cc.study.outbox';
const MAX_TRIES = 40; // errors: with the back-off cap this is about 8 minutes of trying per write
const MAX_WAITS = 600; // waiting for a session or block to exist: 3 s apart, about 30 minutes

function load(): Job[] {
	try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
function save(jobs: Job[]) {
	try {
		if (jobs.length) localStorage.setItem(KEY, JSON.stringify(jobs));
		else localStorage.removeItem(KEY);
	} catch { /* storage full or blocked: the in-memory queue still works */ }
}

export interface Outbox {
	/** Queue a write. `id` makes it unique: queuing the same id again replaces the waiting one. */
	send(fn: Fn, args: Record<string, unknown>, id: string): void;
	readonly state: { pending: number; failing: boolean };
	/** Resolves when nothing is waiting, or after `timeout` ms. */
	flush(timeout?: number): Promise<void>;
	destroy(): void;
}

export function createOutbox(client: ConvexClient): Outbox {
	const state = $state({ pending: 0, failing: false });
	let jobs = load();
	let busy = false, timer: ReturnType<typeof setTimeout> | null = null, dead = false;

	const sync = () => { state.pending = jobs.length; save(jobs); };

	/**
	 * One pass over the queue, in order. A write whose row is not there yet is skipped and tried
	 * again on the next pass (so it never holds up the others); an error stops the pass and backs off.
	 */
	async function pump() {
		if (busy || dead) return;
		busy = true;
		let again = 0;
		try {
			for (const job of [...jobs]) {
				if (dead) return;
				let waiting = false;
				try {
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const res = await client.mutation(FNS[job.fn] as any, job.args as any);
					// The study's own mutations answer null while the row they refer to is not there yet.
					if (res === null && WAITS.has(job.fn)) { waiting = true; throw new Error('not there yet'); }
					jobs = jobs.filter((j) => j !== job);
					state.failing = false;
				} catch (err) {
					// Waiting for gameplay rows to arrive is normal; only real errors count as failing.
					if (waiting) job.waits = (job.waits ?? 0) + 1;
					else { job.tries++; state.failing = job.tries > 2; }
					if (job.tries >= MAX_TRIES || (job.waits ?? 0) >= MAX_WAITS) {
						console.warn('[study] giving up on', job.fn, err);
						jobs = jobs.filter((j) => j !== job);
					} else if (waiting) {
						again = again || 3000;
					} else {
						again = Math.min(15_000, 400 * 1.6 ** job.tries);
						break;
					}
				}
				sync();
			}
		} finally {
			busy = false;
			sync();
		}
		if (jobs.length && !dead && !timer) timer = setTimeout(() => { timer = null; pump(); }, again || 1000);
	}

	sync();
	pump();
	const onOnline = () => { if (timer) { clearTimeout(timer); timer = null; } pump(); };
	window.addEventListener('online', onOnline);

	return {
		state,
		send(fn, args, id) {
			jobs = [...jobs.filter((j) => j.id !== id), { id, fn, args, tries: 0 }];
			sync();
			if (timer) { clearTimeout(timer); timer = null; }
			pump();
		},
		async flush(timeout = 4000) {
			const until = Date.now() + timeout;
			while (jobs.length && Date.now() < until) await new Promise((r) => setTimeout(r, 60));
		},
		destroy() {
			dead = true;
			if (timer) clearTimeout(timer);
			window.removeEventListener('online', onOnline);
			save(jobs);
		}
	};
}
