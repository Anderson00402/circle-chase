/**
 * Circle Chase study data. See convex/README.md for the functions and docs/STUDY.md for what
 * every measure means.
 *
 * Writes are idempotent: the browser makes a `key` for every session, block, trial and rating, so
 * a retried write never makes a duplicate. Documents stay small: a trial is about 1 KB; its 10 Hz
 * series (about 1 KB packed) and its clip (10-15 KB) live in their own tables.
 */
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { clipFields, device, inputType, measures, mode, packedSeries, source, trialContext, viewport } from './validators';
import { runInfo, studyInfo } from './runs';
import { simInfo } from './sim';
import { counterFields } from './counters';
import { trialDigestTable } from './lib/digest';

export default defineSchema({
	/** One per browser (anonymous id kept in localStorage) or per bot. */
	participants: defineTable({
		pid: v.string(),
		/** 1, 2, 3... in order of first visit; picks the study's counterbalanced cue order. */
		number: v.number(),
		/**
		 * Run-console participants only: 1, 2, 3... per source, in the order the console first ensured
		 * them. Picks the suggested (counterbalanced) case order; free play and bots on play pages never get one.
		 */
		runNumber: v.optional(v.number()),
		nickname: v.optional(v.string()),
		source,
		firstSeen: v.number(),
		lastSeen: v.number(),
		device
	})
		.index('by_pid', ['pid'])
		.index('by_number', ['number'])
		.index('by_source_runNumber', ['source', 'runNumber'])
		.index('by_source', ['source', 'firstSeen']),

	/** One visit: a study run (several blocks) or free play. */
	sessions: defineTable({
		key: v.string(),
		participantId: v.id('participants'),
		pid: v.string(),
		mode,
		source,
		cueOrder: v.array(v.string()),
		appVersion: v.string(),
		difficulty: v.string(),
		startedAt: v.number(),
		endedAt: v.optional(v.number()),
		lastActiveAt: v.number(),
		sound: v.boolean(),
		reducedMotion: v.boolean(),
		inputType,
		viewport,
		/** Legacy (replaced guided study flow, development rows only). See convex/runs.ts. */
		study: v.optional(studyInfo),
		/** Run console sessions: participant label and the counterbalancing row of the suggested order (convex/runs.ts). */
		run: v.optional(runInfo),
		blocks: v.number(),
		trials: v.number(),
		/** Simulated sessions only: preset, planted levels and the bot's traits (convex/sim.ts). */
		sim: v.optional(simInfo)
	})
		.index('by_key', ['key'])
		.index('by_participant', ['participantId', 'startedAt'])
		.index('by_started', ['startedAt'])
		.index('by_source_started', ['source', 'startedAt']),

	/** One cue played within a session. */
	blocks: defineTable({
		key: v.string(),
		sessionId: v.id('sessions'),
		participantId: v.id('participants'),
		cue: v.string(),
		orderIndex: v.number(),
		mode,
		source,
		startedAt: v.number(),
		endedAt: v.optional(v.number()),
		trialCount: v.number(),
		engagedCount: v.number(),
		deaths: v.number(),
		score: v.number(),
		/** Study warm-up round (orderIndex -1): kept, but left out of summaries, counters, lists and exports by default. */
		practice: v.optional(v.boolean()),
		/** Study mode: how often the game was paused during the block, and for how long in total (s). */
		pauses: v.optional(v.number()),
		pausedSeconds: v.optional(v.number()),
		/** Study mode: the block was left unfinished (refresh, closed tab) and the round was played again. */
		abandoned: v.optional(v.boolean())
	})
		.index('by_key', ['key'])
		.index('by_session', ['sessionId', 'orderIndex'])
		.index('by_cue', ['cue', 'startedAt']),

	/** One power-up, measured (STUDY.md "What is recorded for every trial"). */
	trials: defineTable({
		key: v.string(),
		participantId: v.id('participants'),
		sessionId: v.id('sessions'),
		blockId: v.id('blocks'),
		cue: v.string(),
		mode,
		source,
		blockIndex: v.number(),
		createdAt: v.number(),
		clipId: v.optional(v.id('clips')),
		/** Copied from the block: a study warm-up trial (see blocks.practice). */
		practice: v.optional(v.boolean()),
		/** Simulated trials: the simulator run (`sessions.sim.run`), so a query can read one run alone (index `by_run`). */
		simRun: v.optional(v.string()),
		/**
		 * Legacy: the packed series lived here until it moved to `trialSeries`. Only rows not yet moved by
		 * `migrations.slimTrials` carry it; nothing writes or reads it.
		 */
		series: v.optional(packedSeries),
		...trialContext,
		...measures
	})
		.index('by_key', ['key'])
		.index('by_run', ['simRun', 'createdAt'])
		.index('by_created', ['createdAt'])
		.index('by_source_created', ['source', 'createdAt'])
		.index('by_cue_created', ['cue', 'createdAt'])
		.index('by_source_cue', ['source', 'cue', 'createdAt'])
		.index('by_session', ['sessionId', 'createdAt'])
		.index('by_block', ['blockId', 'createdAt'])
		.index('by_participant', ['participantId', 'createdAt']),

	/**
	 * The 10 Hz series of one trial (packed with convex/lib/series.ts, about 1 KB). Separate from
	 * `trials` so scans of trial rows stay light; read one with `trials.series({ trialId })`.
	 */
	trialSeries: defineTable({
		trialId: v.id('trials'),
		sessionId: v.id('sessions'),
		cue: v.string(),
		source,
		mode,
		createdAt: v.number(),
		simRun: v.optional(v.string()),
		series: packedSeries
	})
		.index('by_trial', ['trialId'])
		.index('by_source_cue', ['source', 'cue', 'createdAt'])
		.index('by_run', ['simRun', 'cue', 'createdAt']),

	/** One per session: a compact row per trial for the dashboard (convex/lib/digest.ts, owned by the dashboard). */
	trialDigests: trialDigestTable,

	/** Replay clip of one trial: stored for engaged and caught trials. */
	clips: defineTable({
		trialId: v.id('trials'),
		sessionId: v.id('sessions'),
		participantId: v.id('participants'),
		mode,
		source,
		outcome: v.string(),
		createdAt: v.number(),
		size: v.number(),
		practice: v.optional(v.boolean()),
		...clipFields
	})
		.index('by_trial', ['trialId'])
		.index('by_created', ['createdAt'])
		.index('by_source_created', ['source', 'createdAt'])
		.index('by_cue', ['cue', 'createdAt'])
		.index('by_outcome', ['outcome', 'createdAt'])
		.index('by_session', ['sessionId']),

	/** Questionnaire answers: after each block (clarity, distraction 1-7) and at the end of a session. */
	ratings: defineTable({
		key: v.string(),
		kind: v.union(v.literal('block'), v.literal('session')),
		sessionId: v.id('sessions'),
		participantId: v.id('participants'),
		blockId: v.optional(v.id('blocks')),
		cue: v.optional(v.string()),
		/** "I could tell when the power was about to run out", 1-7. */
		clarity: v.optional(v.number()),
		/** "The signal got in the way of playing", 1-7. */
		distraction: v.optional(v.number()),
		clearest: v.optional(v.string()),
		leastClear: v.optional(v.string()),
		comment: v.optional(v.string()),
		/** After a block: "What told you the power was ending?" in the player's words (optional). */
		note: v.optional(v.string()),
		mode,
		source,
		createdAt: v.number()
	})
		.index('by_key', ['key'])
		.index('by_session', ['sessionId'])
		.index('by_cue', ['cue', 'createdAt'])
		.index('by_block', ['blockId']),

	/** Who is playing what right now. Refreshed by a heartbeat; stale rows are removed by a cron. */
	presence: defineTable({
		sessionKey: v.string(),
		pid: v.string(),
		nickname: v.optional(v.string()),
		cue: v.string(),
		mode,
		source,
		state: v.union(v.literal('playing'), v.literal('idle')),
		score: v.number(),
		level: v.number(),
		/** Power left right now, 0 when none. */
		powerLeft: v.number(),
		startedAt: v.number(),
		updatedAt: v.number()
	})
		.index('by_session', ['sessionKey'])
		.index('by_updated', ['updatedAt']),

	/** Running totals per source for the live header, kept by the write mutations (convex/counters.ts). */
	counters: defineTable(counterFields).index('by_source', ['source'])
});
