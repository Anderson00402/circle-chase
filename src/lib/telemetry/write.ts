/**
 * How a measured trial becomes the arguments of `trials.save`. Shared by the browser client
 * (`client.svelte.ts`) and the simulator (`src/lib/sim/`), so simulated rows have exactly the shape
 * of real ones. Pure: no DOM, no Convex client.
 */
import { packSeries } from '#convex/lib/series.ts';
import pkg from '../../../package.json';
import type { Recorder } from './recorder';
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
