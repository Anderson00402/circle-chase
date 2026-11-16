/**
 * Plays one simulated block as fast as the CPU allows and measures it with the real tracker and
 * clip recorder, exactly as `Game.svelte` + `client.svelte.ts` do in the browser:
 * - the engine steps at the game's fixed 1/120 s, the bot looks before every step;
 * - a scene is taken every second step (a 60 Hz display), fed to the recorder and the tracker;
 * - each finished trial becomes `trials.save` arguments through the shared `trialWrite`;
 * - at the end of the block `tracker.finish()` closes a running power-up as `quit`, like `endBlock`.
 * Pure: no DOM, no Convex. Deterministic for a seed.
 */
import { createBot, type BotOptions } from '../game/engine/bot';
import { createGame, STUDY_CONFIG } from '../game/engine/game';
import type { GameConfig } from '../game/types';
import { createRecorder } from '../telemetry/recorder';
import { createTracker } from '../telemetry/tracker';
import type { TrialMeasures } from '../telemetry/types';
import { trialWrite } from '../telemetry/write';
import type { TrialAwareness } from './model';

const STEP = 1 / 120;
/** Engine steps per measured scene: 2 steps of 1/120 s = one 60 Hz display frame. */
const STEPS_PER_FRAME = 2;

export interface BlockPlan {
	cue: string;
	seed: number;
	/** Seconds of play in the block. */
	seconds: number;
	skill: number;
	/** Awareness for the k-th power-up of this block (0-based). */
	awareness: (k: number) => TrialAwareness;
	/** Engine settings on top of the study rules (diagnosis and tests; stored data uses the study rules). */
	config?: Partial<GameConfig>;
	/** Bot settings on top of skill and awareness (diagnosis: another way of chasing). */
	bot?: Partial<BotOptions>;
}

export interface BlockKeys {
	sessionKey: string;
	blockKey: string;
	/** Makes a fresh unique key for a trial. */
	trialKey: () => string;
	/** Trial index to start counting from (0 for a new block). */
	firstTrialIndex?: number;
}

export type TrialArgs = ReturnType<typeof trialWrite>;

export interface SimTrial {
	args: TrialArgs;
	measures: TrialMeasures;
	/** What the bot was given for this power-up (null only if the tracker saw a power the loop did not). */
	awareness: TrialAwareness | null;
	/** The belief error the bot drew for this power-up, seconds (positive: thought it had more time). */
	error: number | null;
}

export interface BlockResult {
	trials: SimTrial[];
	deaths: number;
	score: number;
	/** Game seconds simulated. */
	seconds: number;
}

export function simulateBlock(plan: BlockPlan, keys: BlockKeys): BlockResult {
	const game = createGame({ ...STUDY_CONFIG, ...plan.config, seed: plan.seed });
	// Awareness is set at each power-up below; before the first one it does not matter.
	const bot = createBot(game, { ...plan.bot, seed: plan.seed, skill: plan.skill });
	const tracker = createTracker();
	const recorder = createRecorder();
	const out: SimTrial[] = [];
	// The awareness each power-up was played with, by power serial.
	const bySerial = new Map<number, TrialAwareness>();
	const errors = new Map<number, number>();
	let trialIndex = keys.firstTrialIndex ?? 0;
	let serial = 0, k = 0;

	const store = (m: TrialMeasures) => {
		const args = trialWrite(m, recorder, {
			key: keys.trialKey(), sessionKey: keys.sessionKey, blockKey: keys.blockKey, trialIndex: trialIndex++,
			cue: plan.cue, sound: true, reducedMotion: false, inputType: 'none', difficulty: game.config.difficulty
		});
		out.push({ args, measures: m, awareness: bySerial.get(m.serial) ?? null, error: errors.get(m.serial) ?? null });
	};

	const steps = Math.round(plan.seconds / STEP);
	for (let i = 1; i <= steps; i++) {
		// A new power-up: set this trial's awareness before the bot draws its error for it.
		const s = game.peek().power.serial;
		if (s !== serial) {
			serial = s;
			const a = plan.awareness(k++);
			bySerial.set(s, a);
			bot.options.awarenessNoise = a.noise;
			bot.options.caution = a.caution;
			bot.options.reaction = a.reaction;
		}
		bot.step();
		if (s > 0 && !errors.has(s)) errors.set(s, bot.error);
		game.update(STEP);
		if (i % STEPS_PER_FRAME === 0) {
			const scene = game.scene();
			recorder.push(scene);
			for (const t of tracker.onScene(scene)) store(t);
		}
	}
	for (const t of tracker.finish()) store(t);
	return { trials: out, deaths: game.deaths, score: game.peek().score, seconds: plan.seconds };
}
