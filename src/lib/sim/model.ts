/**
 * Behaviour model of simulated participants. Honest and explicit: a bot cannot see a cue, so the
 * simulator *assigns* every trial an awareness of the time left instead, through the bot's
 * `awarenessNoise` (how wrong it is about the time left, SD in seconds), `caution` (seconds of
 * margin it keeps) and `reaction` (how fast it notices a ghost turned dangerous again).
 *
 * Presets
 * - `flat`: every condition gets the same awareness. The dashboard should show no real
 *   differences beyond chance: the null check.
 * - `planted`: every condition gets the awareness declared in `PLANTED` below. The dashboard should
 *   recover this ranking. That only shows the pipeline can detect a difference of this size; the
 *   table is invented and says nothing about which real cue is better.
 *
 * On top of the condition, each participant has their own skill, a scale on the noise (some are
 * better at timing than others), a caution (some are reckless, which is what gets them caught),
 * a share of power-ups they ignore, and a learning effect: noise is larger early in the session and
 * settles over the first 20 or so trials. Counterbalanced orders spread that learning over the cues.
 *
 * Measured with the real tracker under outcome rules version 3 (see diagnose.test.ts and
 * audit.test.ts): rates are over decision trials, catches are left out. "Too late" climbs steadily
 * with the bot's belief error.
 *
 * What the model does and does not show (model version 2, study rules with fleeing ghosts; numbers
 * in docs/STUDY.md "Study-rule levers" and "How long a run is"). Nothing here was tuned to the
 * planted table.
 * - The simulated participant chases eagerly (`CHASE_STYLE`): any scared ghost it can reach safely,
 *   for as long as it believes (time left - caution) is above zero, however far the ghost is. With
 *   the mean caution of 1.0 s, a participant who knows the time turns away with about 1 s left, which
 *   the rules call "in time"; underestimating the time gives "too early", overestimating "too late".
 *   Version 1 planned each chase (only a ghost it believed it could reach in time), so it gave up
 *   distant ghosts early even when it knew the time, and "too early" did not follow the plant.
 * - A simulated participant who believes the power is already over never starts a chase, so its
 *   worst underestimates still show as "not chasing near the end" rather than "too early".
 * - About 36% of its power-ups end in a decision, 23% in a catch.
 *
 * Pure and deterministic for a seed.
 */
import { makeRng } from '../game/engine/game';

export type Preset = 'flat' | 'planted';
export const PRESETS: { value: Preset; label: string; hint: string }[] = [
	{ value: 'planted', label: 'Planted', hint: 'Each condition gets a declared awareness level. The dashboard should recover the ranking.' },
	{ value: 'flat', label: 'Flat', hint: 'Every condition gets the same awareness. The dashboard should show no real differences.' }
];

/** What one condition does to a simulated player, by declaration. */
export interface PlantedLevel {
	cue: string;
	/** Awareness noise, SD in seconds, before the participant's own scale and learning. Lower is better. */
	noise: number;
	/** Mean "the signal got in the way" rating, 1-7. */
	distraction: number;
}

/**
 * The planted table. Invented for validating the pipeline, not a prediction: the "no signal"
 * control worst, the timer bar best, the reference blink in the upper middle, the ideas spread in
 * between so that some pairs are far apart (easy to tell) and some close (hard to tell).
 */
export const PLANTED: PlantedLevel[] = [
	{ cue: 'none', noise: 2.4, distraction: 1.5 },
	{ cue: 'classic-blink', noise: 1.0, distraction: 2.5 },
	{ cue: 'timer-bar', noise: 0.3, distraction: 2.5 },
	{ cue: 'ink-refill', noise: 0.6, distraction: 3 },
	{ cue: 'clock-halos', noise: 0.8, distraction: 3.5 },
	{ cue: 'burning-fuse', noise: 0.5, distraction: 3 },
	{ cue: 'wall-tide', noise: 1.4, distraction: 4.5 },
	{ cue: 'heartbeat', noise: 1.2, distraction: 4 },
	{ cue: 'waking-ghosts', noise: 0.9, distraction: 3 },
	{ cue: 'pen-hourglass', noise: 1.7, distraction: 3.5 },
	{ cue: 'deflating-player', noise: 0.7, distraction: 4 },
	{ cue: 'final-count', noise: 0.4, distraction: 3.5 },
	{ cue: 'dot-sweep', noise: 2.0, distraction: 3 }
];

/** Flat preset: the mean planted noise and distraction for every condition. */
export const FLAT_NOISE = round2(PLANTED.reduce((a, p) => a + p.noise, 0) / PLANTED.length);
export const FLAT_DISTRACTION = round2(PLANTED.reduce((a, p) => a + p.distraction, 0) / PLANTED.length);

/**
 * Bumped whenever the model changes, stored with every simulated session.
 * 1: the bot plans each chase (only goes after a ghost it believes it can reach in time).
 * 2: eager chasing (`CHASE_STYLE`): goes after any scared ghost it can reach safely until it
 *    believes the power is about to end; played under the study rules with fleeing ghosts.
 */
export const MODEL_VERSION = 2;
/**
 * How simulated participants decide to go after a scared ghost (`BotOptions.chase`). People chase
 * readily and judge the clock rather than the distance, so the simulated participant chases any
 * ghost it can reach safely while it believes (time left - caution) is above zero.
 */
export const CHASE_STYLE = 'eager' as const;

export function levelsFor(preset: Preset, cues: readonly string[]): PlantedLevel[] {
	return cues.map((cue) => {
		if (preset === 'flat') return { cue, noise: FLAT_NOISE, distraction: FLAT_DISTRACTION };
		return PLANTED.find((p) => p.cue === cue) ?? { cue, noise: FLAT_NOISE, distraction: FLAT_DISTRACTION };
	});
}

/** One simulated participant's traits. */
export interface Profile {
	/** Bot skill, 0-1 (random moves now and then below 1). */
	skill: number;
	/** Multiplies every condition's noise: below 1 is a good timer, above 1 a poor one. */
	noiseScale: number;
	/** Mean caution, seconds. Negative is reckless. */
	caution: number;
	/** Seconds to notice a ghost has turned dangerous again. */
	reaction: number;
	/** Share of power-ups this participant does not bother chasing. */
	ignoreRate: number;
	/** Extra noise at the start of the session (0.4 = 40% more), fading over the first ~20 trials. */
	learning: number;
	/** Personal offset on every rating. */
	ratingBias: number;
	/** Quits after this many blocks (the last one cut short), or null when they finish. */
	quitAfter: number | null;
}

export interface TrialAwareness {
	/** Spread (SD, seconds) of the bot's error about the time left. */
	noise: number;
	/** Seconds of margin the bot keeps before it believes the power ends. */
	caution: number;
	/** Seconds it takes to notice a ghost has turned dangerous again. */
	reaction: number;
	/** The participant did not bother with this power-up (never chases). */
	ignore: boolean;
}

/** Caution given to an ignored power-up: the bot treats scared ghosts as dangerous and keeps away. */
export const IGNORE_CAUTION = 99;
/** Trials over which the learning effect fades (e-folding). */
export const LEARNING_TRIALS = 20;

export function gauss(rng: () => number): number {
	const u = Math.max(1e-9, rng()), v = rng();
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Mixes a seed with a salt into a well spread 32-bit seed. */
export function mix(seed: number, salt: number): number {
	let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
	h ^= h >>> 15;
	h = Math.imul(h, 0x27d4eb2f);
	return (h ^ (h >>> 13)) >>> 0;
}

function round2(x: number) { return Math.round(x * 100) / 100; }
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** A participant's traits, drawn from their seed. `blocks` is how many blocks the session plans. */
export function drawProfile(seed: number, blocks: number): Profile {
	const rng = makeRng(mix(seed, 17));
	// About one in ten barely engages with power-ups; the rest skip a few.
	const lazy = rng() < 0.1;
	// About one in six leaves before the end.
	const quits = blocks > 2 && rng() < 0.17;
	return {
		skill: round2(0.72 + rng() * 0.28),
		noiseScale: round2(Math.exp(gauss(rng) * 0.25)),
		caution: round2(1.0 + gauss(rng) * 0.4),
		reaction: round2(0.25 + rng() * 0.35),
		ignoreRate: round2(lazy ? 0.45 + rng() * 0.25 : rng() * 0.12),
		learning: round2(0.2 + rng() * 0.4),
		ratingBias: round2(gauss(rng) * 0.6),
		quitAfter: quits ? 1 + Math.floor(rng() * (blocks - 1)) : null
	};
}

/**
 * Awareness for one trial. `sessionTrial` counts the participant's power-ups so far in the session
 * (drives learning); `rng` is the block's own generator.
 */
export function trialAwareness(p: Profile, level: PlantedLevel, sessionTrial: number, rng: () => number): TrialAwareness {
	const learning = 1 + p.learning * Math.exp(-sessionTrial / LEARNING_TRIALS);
	const jitter = Math.exp(gauss(rng) * 0.1);
	const ignore = rng() < p.ignoreRate;
	return {
		noise: round2(level.noise * p.noiseScale * learning * jitter),
		caution: ignore ? IGNORE_CAUTION : round2(p.caution + gauss(rng) * 0.15),
		reaction: p.reaction,
		ignore
	};
}

/** Block questionnaire, consistent with the planted level plus noise. */
export function blockRatings(p: Profile, level: PlantedLevel, rng: () => number): { clarity: number; distraction: number } {
	const felt = level.noise * p.noiseScale;
	return {
		clarity: Math.round(clamp(6.8 - 2.1 * felt + p.ratingBias + gauss(rng) * 0.8, 1, 7)),
		distraction: Math.round(clamp(level.distraction + p.ratingBias * 0.3 + gauss(rng) * 1, 1, 7))
	};
}

/** End of session: the clearest and least clear of the conditions played, as felt (planted noise plus noise). */
export function sessionRatings(levels: readonly PlantedLevel[], rng: () => number): { clearest?: string; leastClear?: string } {
	if (levels.length < 2) return {};
	const felt = levels.map((l) => ({ cue: l.cue, v: l.noise + gauss(rng) * 0.4 })).sort((a, b) => a.v - b.v);
	return { clearest: felt[0].cue, leastClear: felt[felt.length - 1].cue };
}
