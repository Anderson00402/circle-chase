/**
 * Validators shared by the schema and the function arguments. The trial fields mirror
 * `TrialMeasures` in src/lib/telemetry/types.ts; definitions are in docs/STUDY.md.
 */
import { v, type Infer } from 'convex/values';

export const source = v.union(v.literal('human'), v.literal('bot'));
export const mode = v.union(v.literal('study'), v.literal('arcade'));
/** Filters accept 'all' as well. */
export const sourceFilter = v.union(v.literal('human'), v.literal('bot'), v.literal('all'));

export const outcome = v.union(
	v.literal('caught'),
	v.literal('late-catch'),
	v.literal('overstayed'),
	v.literal('timely-retreat'),
	v.literal('early-retreat'),
	v.literal('not-engaged'),
	v.literal('other'),
	v.literal('interrupted')
);
export type OutcomeV = Infer<typeof outcome>;
export const OUTCOME_LIST: OutcomeV[] = [
	'caught', 'late-catch', 'overstayed', 'timely-retreat', 'early-retreat', 'not-engaged', 'other', 'interrupted'
];

export const endReason = v.union(
	v.literal('expired'),
	v.literal('died'),
	v.literal('cleared'),
	v.literal('refreshed'),
	v.literal('quit')
);

const num = v.number();
const maybeNum = v.union(v.number(), v.null());
const maybeBool = v.union(v.boolean(), v.null());

export const device = v.object({
	userAgent: v.string(),
	platform: v.string(),
	language: v.string(),
	touch: v.boolean(),
	screenW: num,
	screenH: num,
	dpr: num
});

export const viewport = v.object({ w: num, h: num, dpr: num });

/** keyboard, touch, mouse, mixed (more than one), none (steered by a script). */
export const inputType = v.string();

export const eat = v.object({ t: num, left: num, ghost: v.string(), points: num });

export const aftermath = v.object({
	seen: num,
	died: v.boolean(),
	caught: v.boolean(),
	timeToCaught: maybeNum,
	killer: v.union(v.string(), v.null()),
	minDangerDist: maybeNum,
	nearMiss: v.boolean(),
	/** Why the aftermath ended early (power, clear, quit); null or absent when it ran its 3 s or ended in a death. */
	cut: v.optional(v.union(v.literal('power'), v.literal('clear'), v.literal('quit'), v.null()))
});

/** What the tracker measures for one power-up. */
export const measures = {
	serial: num,
	startedAt: num,
	endedAt: num,
	total: num,
	level: num,
	mazeId: v.string(),
	endReason,
	leftAtEnd: num,
	scaredAtStart: num,
	outcome,
	engaged: v.boolean(),
	inRates: v.boolean(),
	eats: v.array(eat),
	lateCatch: v.boolean(),
	allEatenLeft: maybeNum,
	turnLeft: maybeNum,
	turnDist: maybeNum,
	turnAt: maybeNum,
	turnReachable: maybeBool,
	chases: num,
	endDist: maybeNum,
	endClosing: maybeBool,
	after: aftermath,
	reaction: maybeNum,
	wasted: maybeNum,
	diedDuring: v.boolean(),
	frames: num,
	fps: num,
	/** 10 Hz series packed with convex/lib/series.ts (`trials:get` unpacks it). */
	series: v.bytes()
};

/** Per-trial context the client knows (who, where and how is filled in from the session and block). */
export const trialContext = {
	trialIndex: num,
	sound: v.boolean(),
	reducedMotion: v.boolean(),
	inputType,
	appVersion: v.string(),
	difficulty: v.string()
};

export const marker = v.object({
	kind: v.union(v.literal('powerStart'), v.literal('eat'), v.literal('turnAway'), v.literal('powerEnd'), v.literal('death')),
	t: num,
	ghost: v.optional(v.string()),
	left: v.optional(num)
});

export const clipNumbers = v.object({
	outcome,
	total: num,
	turnLeft: maybeNum,
	turnDist: maybeNum,
	endDist: maybeNum,
	timeToCaught: maybeNum,
	eats: num,
	engaged: v.boolean()
});

/** A replay clip as encoded by src/lib/telemetry/recorder.ts. */
export const clipFields = {
	v: num,
	cue: v.string(),
	mazeId: v.string(),
	level: num,
	t0: num,
	t1: num,
	hz: num,
	scenes: num,
	markers: v.array(marker),
	numbers: clipNumbers,
	data: v.bytes()
};
