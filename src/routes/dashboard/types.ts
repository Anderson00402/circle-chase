import type { FunctionReturnType } from 'convex/server';
import type { Id } from '#convex/_generated/dataModel.js';
import type { api } from '#convex/_generated/api.js';

export type Main = FunctionReturnType<typeof api.dashboard.main>;
export type CueRow = Main['cues'][number];
export type Comparison = Main['pairs']['wellTimed'][number];
export type Points = FunctionReturnType<typeof api.dashboard.points>;
export type Approach = FunctionReturnType<typeof api.dashboard.approach>;
export type Ratings = FunctionReturnType<typeof api.dashboard.ratings>;
export type RunInfo = FunctionReturnType<typeof api.dashboard.facets>['runs'][number];

/** Humans, or simulated players (one simulator run at a time). Never mixed. */
export type SourceSel = 'human' | 'bot';
export type ModeSel = 'study' | 'arcade' | 'both';

/** The filter every dashboard query receives. */
export interface DashFilter {
	source: SourceSel;
	/** Simulated view: the simulator run ('other': simulated play outside any run). */
	run?: string;
	mode?: 'study' | 'arcade';
	participantId?: Id<'participants'>;
	from?: number;
	cue?: string;
}

/** Row order of the per-condition charts. */
export type RowOrder = 'rank' | 'code';
