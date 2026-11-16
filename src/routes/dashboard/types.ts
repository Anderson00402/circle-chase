import type { FunctionReturnType } from 'convex/server';
import type { Id } from '#convex/_generated/dataModel.js';
import type { api } from '#convex/_generated/api.js';

export type Main = FunctionReturnType<typeof api.dashboard.main>;
export type CueRow = Main['cues'][number];
export type Points = FunctionReturnType<typeof api.dashboard.points>;
export type Approach = FunctionReturnType<typeof api.dashboard.approach>;

export type SourceSel = 'human' | 'bot' | 'all';
export type ModeSel = 'study' | 'arcade' | 'both';

/** The filter every dashboard query receives. */
export interface DashFilter {
	source: SourceSel;
	mode?: 'study' | 'arcade';
	participantId?: Id<'participants'>;
	from?: number;
	cue?: string;
}

/** Row order of the per-condition charts. */
export type RowOrder = 'rank' | 'code';
