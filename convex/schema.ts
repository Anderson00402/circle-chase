/**
 * Circle Chase study data. See convex/README.md for the functions and docs/STUDY.md for what
 * every measure means.
 *
 * Writes are idempotent: the browser makes a `key` for every session, block, trial and rating, so
 * a retried write never makes a duplicate. Documents stay small: a trial is about 2 KB (its 10 Hz
 * series is packed into bytes), a clip about 10-15 KB and lives in its own table.
 */
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { clipFields, device, inputType, measures, mode, source, trialContext, viewport } from './validators';

export default defineSchema({
	/** One per browser (anonymous id kept in localStorage) or per bot. */
	participants: defineTable({
		pid: v.string(),
		/** 1, 2, 3... in order of first visit; picks the study's counterbalanced cue order. */
		number: v.number(),
		nickname: v.optional(v.string()),
		source,
		firstSeen: v.number(),
		lastSeen: v.number(),
		device
	})
		.index('by_pid', ['pid'])
		.index('by_number', ['number'])
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
		blocks: v.number(),
		trials: v.number()
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
		score: v.number()
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
		...trialContext,
		...measures
	})
		.index('by_key', ['key'])
		.index('by_created', ['createdAt'])
		.index('by_source_created', ['source', 'createdAt'])
		.index('by_cue_created', ['cue', 'createdAt'])
		.index('by_source_cue', ['source', 'cue', 'createdAt'])
		.index('by_session', ['sessionId', 'createdAt'])
		.index('by_block', ['blockId', 'createdAt'])
		.index('by_participant', ['participantId', 'createdAt']),

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
		.index('by_updated', ['updatedAt'])
});
