/**
 * How a measured trial becomes the arguments of `trials.save`. Shared by the browser client
 * (`client.svelte.ts`) and the simulator (`src/lib/sim/`), so simulated rows have exactly the shape
 * of real ones. Pure: no DOM, no Convex client.
 */
import { packSeries } from '#convex/lib/series.ts';
import pkg from '../../../package.json';
import { DYING_TAIL, deathAt, type Recorder } from './recorder';
import type { TrialMeasures } from './types';

/** Injected by vite.config.ts (`define`): package version + git commit. */
declare const __APP_BUILD__: string | undefined;

/** Build identifier stored as `appVersion`: "0.0.1+e8606d3" (".dev" from the dev server); the bare version outside Vite. */
export const APP_VERSION: string = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : pkg.version;

/** Context of a trial that the tracker does not know: who, where, with what settings. */
export interface TrialWriteContext {
	key: string;
	sessionKey: string;
	blockKey: string;
	trialIndex: number;
	cue: string;
	sound: boolean;
	reducedMotion: boolean;
	inputType: string;
	difficulty: string;
	appVersion?: string;
}

/** A clip is stored for every engaged trial, every trial that counts toward the rates and every caught trial (STUDY.md "Replay clips"). */
export function wantsClip(trial: TrialMeasures): boolean {
	return trial.engaged || trial.inRates || trial.after.caught;
}

/** Arguments for `api.trials.save`, with the clip cut from `recorder` when the trial wants one. */
export function trialWrite(trial: TrialMeasures, recorder: Recorder, c: TrialWriteContext) {
	const clip = wantsClip(trial) ? recorder.clipFor(trial, c.cue) : null;
	const { series, ...m } = trial;
	return {
		key: c.key, sessionKey: c.sessionKey, blockKey: c.blockKey, trialIndex: c.trialIndex,
		sound: c.sound, reducedMotion: c.reducedMotion, inputType: c.inputType,
		appVersion: c.appVersion ?? APP_VERSION, difficulty: c.difficulty,
		...m, series: packSeries(series), ...(clip ? { clip } : {})
	};
}

/**
 * Trials on their way to `trialWrite`, in order. A trial that ended in a death waits until
 * `DYING_TAIL` seconds of game time have passed since the death, so its clip shows the dying phase;
 * every other trial (and every trial behind a waiting one) goes as soon as it can. `drain` lets
 * everything go now (end of the run, a new game, the page closing).
 */
export interface WriteQueue {
	add(trial: TrialMeasures): void;
	/** Trials ready at game time `t`, in the order they closed. */
	ready(t: number): TrialMeasures[];
	/** Everything still waiting. */
	drain(): TrialMeasures[];
	readonly size: number;
}

export function createWriteQueue(tail = DYING_TAIL): WriteQueue {
	let waiting: TrialMeasures[] = [];
	return {
		add(trial) { waiting.push(trial); },
		ready(t) {
			let n = 0;
			while (n < waiting.length) {
				const d = deathAt(waiting[n]);
				// Wait while within the tail after the death. Stored times are rounded, so the death may
				// read a few milliseconds late; only a clear step back in time means a new game.
				if (d !== null && t < d + tail - 1e-9 && t > d - 0.1) break;
				n++;
			}
			const out = waiting.slice(0, n);
			waiting = waiting.slice(n);
			return out;
		},
		drain() { const out = waiting; waiting = []; return out; },
		get size() { return waiting.length; }
	};
}
