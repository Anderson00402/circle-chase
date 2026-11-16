/**
 * One simulated study session, start to end, as plain data: the same structure a human session
 * has (counterbalanced cue order, one study-mode block per cue, trials with clips, block ratings,
 * session ratings), ready to be written by `writer.ts` through the real Convex mutations.
 * Pure and deterministic for (seed, participant number, options).
 */
import { simulateBlock, type SimTrial } from './block';
import { cueOrder } from './order';
import {
	blockRatings, drawProfile, levelsFor, mix, MODEL_VERSION, sessionRatings, trialAwareness,
	type PlantedLevel, type Preset, type Profile
} from './model';
import { makeRng } from '../game/engine/game';

/** Seconds per block, as in the study (STUDY.md "Design"). */
export const BLOCK_SECONDS = 90;

export interface SessionOptions {
	preset: Preset;
	/** Every condition in display order (for the Latin square). */
	allCues: readonly string[];
	/** Conditions this session plays (all of them, or a subset). */
	cues: readonly string[];
	/** Run id: groups the sessions of one simulator run; part of every key. */
	run: string;
	/** Seed of the whole run. */
	runSeed: number;
	/** 0-based index of the participant within the run. */
	index: number;
	/** 1-based participant number given by the server (picks the Latin square row). */
	participantNumber: number;
	blockSeconds?: number;
}

/** Stored on the session row (`sessions.sim`) so the dashboard can show planted vs recovered. */
export interface SimInfo {
	preset: Preset;
	run: string;
	seed: number;
	modelVersion: number;
	planted: PlantedLevel[];
	profile: Profile;
}

export interface SimBlock {
	key: string;
	cue: string;
	orderIndex: number;
	seconds: number;
	trials: SimTrial[];
	deaths: number;
	score: number;
	/** Null when the participant left during this block. */
	rating: { clarity: number; distraction: number } | null;
}

export interface SimSession {
	pid: string;
	key: string;
	cueOrder: string[];
	sim: SimInfo;
	blocks: SimBlock[];
	/** Null when the participant left before the end. */
	final: { clearest?: string; leastClear?: string } | null;
}

export function participantSeed(runSeed: number, index: number): number {
	return mix(runSeed, 1000 + index);
}

export function simPid(run: string, index: number): string {
	return `bot-sim-${run}-${index + 1}`;
}

/** Everything decided before the first block: order, levels, traits, keys. */
export interface SessionPlan {
	options: SessionOptions;
	seed: number;
	pid: string;
	key: string;
	cueOrder: string[];
	levels: PlantedLevel[];
	profile: Profile;
	sim: SimInfo;
}

export function planSession(o: SessionOptions): SessionPlan {
	const seed = participantSeed(o.runSeed, o.index);
	const order = cueOrder(o.allCues, o.cues, o.participantNumber, seed);
	const profile = drawProfile(seed, order.length);
	return {
		options: o, seed, pid: simPid(o.run, o.index), key: `sim-${o.run}-p${o.index + 1}`,
		cueOrder: order, levels: levelsFor(o.preset, order), profile,
		sim: {
			preset: o.preset, run: o.run, seed, modelVersion: MODEL_VERSION, profile,
			// In display order, so every session of a run lists the same table.
			planted: levelsFor(o.preset, o.allCues.filter((c) => order.includes(c)))
		}
	};
}

/**
 * Plays the blocks one by one (so a page can stay responsive between them). Returns the end of
 * session answers, or null when the participant left early.
 */
export function* playSession(plan: SessionPlan): Generator<SimBlock, SimSession['final'], void> {
	const { profile, levels, seed, key } = plan;
	const full = plan.options.blockSeconds ?? BLOCK_SECONDS;
	const played = profile.quitAfter ?? levels.length;
	let sessionTrial = 0;
	for (let b = 0; b < played; b++) {
		const level = levels[b];
		const rng = makeRng(mix(seed, 50 + b));
		const leaving = profile.quitAfter !== null && b === played - 1;
		// The block someone leaves in is cut short somewhere in its middle.
		const seconds = leaving ? Math.round(15 + rng() * (full - 30)) : full;
		const blockKey = `${key}:b${b + 1}`;
		let t = 0;
		const res = simulateBlock({
			cue: level.cue, seed: mix(seed, 100 + b), seconds, skill: profile.skill,
			awareness: () => trialAwareness(profile, level, sessionTrial++, rng)
		}, { sessionKey: key, blockKey, trialKey: () => `${blockKey}:t${++t}` });
		yield {
			key: blockKey, cue: level.cue, orderIndex: b, seconds, trials: res.trials, deaths: res.deaths, score: res.score,
			rating: leaving ? null : blockRatings(profile, level, rng)
		};
	}
	return profile.quitAfter === null ? sessionRatings(levels, makeRng(mix(seed, 999))) : null;
}

/** The whole session at once (tests, scripts). */
export function simulateSession(o: SessionOptions): SimSession {
	const plan = planSession(o);
	const blocks: SimBlock[] = [];
	const it = playSession(plan);
	for (;;) {
		const r = it.next();
		if (r.done) return { pid: plan.pid, key: plan.key, cueOrder: plan.cueOrder, sim: plan.sim, blocks, final: r.value };
		blocks.push(r.value);
	}
}
