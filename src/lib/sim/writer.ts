/**
 * Writes simulated sessions to Convex through the same mutations the browser client uses
 * (`participants.ensure`, `sessions.start`, `blocks.start`, `trials.save`, `blocks.end`,
 * `ratings.saveBlock`, `ratings.saveSession`, `sessions.update`), in the same order and with the
 * same keys scheme (`<block>:rating`, `<session>:rating`). Every row is `source: 'bot'`.
 *
 * The CPU work (one block at a time) and the writes overlap: a block's writes are sent while the
 * next block is simulated. Convex runs one client's mutations in the order they were sent.
 */
import type { ConvexClient } from 'convex/browser';
import { api } from '#convex/_generated/api.js';
import { APP_VERSION } from '../telemetry/write';
import type { Preset } from './model';
import { planSession, playSession, simPid, type SimBlock } from './session';

export const SIM_DEVICE = {
	userAgent: 'Circle Chase simulator (bot, not a person)',
	platform: 'simulator', language: 'en', touch: false, screenW: 1440, screenH: 900, dpr: 2
};
const SIM_VIEWPORT = { w: 1440, h: 900, dpr: 2 };

export interface RunOptions {
	preset: Preset;
	/** Every condition in display order. */
	allCues: readonly string[];
	/** Conditions each session plays. */
	cues: readonly string[];
	participants: number;
	/** Seed of the run; random when absent. */
	seed?: number;
	blockSeconds?: number;
	signal?: AbortSignal;
	onProgress?: (p: RunProgress) => void;
}

export interface RunProgress {
	run: string;
	seed: number;
	preset: Preset;
	participants: number;
	/** Participants whose session is fully written. */
	done: number;
	/** Participant being simulated (1-based within the run), 0 when idle. */
	current: number;
	blocks: number;
	trials: number;
	engaged: number;
	clips: number;
	outcomes: Record<string, number>;
	/** Game seconds simulated. */
	gameSeconds: number;
	/** Wall time so far, ms, and the part spent simulating (rest: waiting for writes). */
	elapsedMs: number;
	simMs: number;
	state: 'running' | 'done' | 'stopped' | 'failed';
	error: string | null;
}

export function newRunId(): string {
	const t = Date.now().toString(36).slice(-5);
	const r = Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, '0');
	return t + r;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function runSimulation(client: ConvexClient, o: RunOptions): Promise<RunProgress> {
	const run = newRunId();
	const seed = o.seed ?? Math.floor(Math.random() * 2 ** 31);
	const t0 = performance.now();
	const p: RunProgress = {
		run, seed, preset: o.preset, participants: o.participants, done: 0, current: 0, blocks: 0, trials: 0,
		engaged: 0, clips: 0, outcomes: {}, gameSeconds: 0, elapsedMs: 0, simMs: 0, state: 'running', error: null
	};
	const report = () => { p.elapsedMs = performance.now() - t0; o.onProgress?.({ ...p, outcomes: { ...p.outcomes } }); };

	try {
		for (let i = 0; i < o.participants; i++) {
			if (o.signal?.aborted) { p.state = 'stopped'; break; }
			p.current = i + 1;
			report();
			await participant(client, o, run, seed, i, p, report);
			p.done++;
			report();
		}
		if (p.state === 'running') p.state = 'done';
	} catch (err) {
		p.state = 'failed';
		p.error = err instanceof Error ? err.message : String(err);
	}
	p.current = 0;
	report();
	return p;
}

async function participant(
	client: ConvexClient, o: RunOptions, run: string, seed: number, index: number, p: RunProgress, report: () => void
) {
	const plan0 = { run, runSeed: seed, index };
	const pid = simPid(run, index);
	const { number } = await client.mutation(api.participants.ensure, { pid, source: 'bot', device: SIM_DEVICE });
	const plan = planSession({ preset: o.preset, allCues: o.allCues, cues: o.cues, participantNumber: number, blockSeconds: o.blockSeconds, ...plan0 });
	const sessionKey = plan.key;
	await client.mutation(api.sessions.start, {
		key: sessionKey, pid, mode: 'study', source: 'bot', cueOrder: plan.cueOrder, appVersion: APP_VERSION,
		difficulty: 'normal', sound: true, reducedMotion: false, inputType: 'none', viewport: SIM_VIEWPORT, sim: plan.sim
	});

	let inFlight: Promise<unknown>[] = [];
	const it = playSession(plan);
	for (;;) {
		await tick(); // let the page paint between blocks
		if (o.signal?.aborted) break;
		const s0 = performance.now();
		const r = it.next();
		p.simMs += performance.now() - s0;
		// Wait for the previous block's writes before sending more, so a failure stops the run early.
		await Promise.all(inFlight);
		if (r.done) {
			const final = r.value;
			if (final) {
				await client.mutation(api.ratings.saveSession, { key: sessionKey + ':rating', sessionKey, ...final });
				await client.mutation(api.sessions.update, { key: sessionKey, end: true });
			}
			break;
		}
		inFlight = writeBlock(client, sessionKey, r.value);
		tally(p, r.value);
		report();
	}
	await Promise.all(inFlight);
}

function writeBlock(client: ConvexClient, sessionKey: string, b: SimBlock): Promise<unknown>[] {
	const out: Promise<unknown>[] = [];
	out.push(client.mutation(api.blocks.start, { key: b.key, sessionKey, cue: b.cue, orderIndex: b.orderIndex }));
	for (const t of b.trials) out.push(client.mutation(api.trials.save, t.args));
	out.push(client.mutation(api.blocks.end, { key: b.key, deaths: b.deaths, score: b.score }));
	if (b.rating) out.push(client.mutation(api.ratings.saveBlock, { key: b.key + ':rating', blockKey: b.key, ...b.rating }));
	return out;
}

function tally(p: RunProgress, b: SimBlock) {
	p.blocks++;
	p.gameSeconds += b.seconds;
	for (const t of b.trials) {
		p.trials++;
		if (t.measures.engaged) p.engaged++;
		if (t.args.clip) p.clips++;
		p.outcomes[t.measures.outcome] = (p.outcomes[t.measures.outcome] ?? 0) + 1;
	}
}
