import { v } from 'convex/values';
import type { Doc } from './_generated/dataModel';
import { query } from './_generated/server';
import { filterArgs, light, scanTrials } from './lib/filters';
import { isDecision, isLateCatch } from './lib/rules';
import { unpackSeries } from './lib/series';
import { packedSeriesOf } from './trials';

/** Flat columns for the CSV, in order. Nested values are spelled out (after.caught...). */
const COLUMNS: [string, (t: Doc<'trials'>) => unknown][] = [
	['trialId', (t) => t._id], ['createdAt', (t) => new Date(t.createdAt).toISOString()],
	['participantId', (t) => t.participantId], ['sessionId', (t) => t.sessionId], ['blockId', (t) => t.blockId],
	['source', (t) => t.source], ['mode', (t) => t.mode], ['cue', (t) => t.cue], ['blockIndex', (t) => t.blockIndex],
	['trialIndex', (t) => t.trialIndex], ['difficulty', (t) => t.difficulty], ['level', (t) => t.level], ['mazeId', (t) => t.mazeId],
	['powerTotal', (t) => t.total], ['sound', (t) => t.sound], ['reducedMotion', (t) => t.reducedMotion],
	['inputType', (t) => t.inputType], ['fps', (t) => t.fps], ['appVersion', (t) => t.appVersion],
	['endReason', (t) => t.endReason], ['leftAtEnd', (t) => t.leftAtEnd], ['scaredAtStart', (t) => t.scaredAtStart],
	['outcome', (t) => t.outcome], ['rulesVersion', (t) => t.rulesVersion ?? 1], ['engaged', (t) => t.engaged], ['inRates', (t) => t.inRates],
	['decision', (t) => isDecision(t)], ['catchLate', (t) => (t.outcome === 'catch' ? isLateCatch(t) : '')],
	['eats', (t) => t.eats.length], ['eatLefts', (t) => t.eats.map((e) => e.left).join(' ')], ['lateCatch', (t) => t.lateCatch],
	['allEatenLeft', (t) => t.allEatenLeft], ['turnLeft', (t) => t.turnLeft], ['turnDist', (t) => t.turnDist],
	['turnAt', (t) => t.turnAt], ['turnReachable', (t) => t.turnReachable], ['chases', (t) => t.chases],
	['lastChaseEnd', (t) => t.lastChaseEnd],
	['endDist', (t) => t.endDist], ['endClosing', (t) => t.endClosing],
	['afterSeen', (t) => t.after.seen], ['afterDied', (t) => t.after.died], ['caught', (t) => t.after.caught],
	['timeToCaught', (t) => t.after.timeToCaught], ['killer', (t) => t.after.killer],
	['minDangerDist', (t) => t.after.minDangerDist], ['nearMiss', (t) => t.after.nearMiss],
	['reaction', (t) => t.reaction], ['wasted', (t) => t.wasted], ['diedDuring', (t) => t.diedDuring],
	['frames', (t) => t.frames], ['hasClip', (t) => !!t.clipId]
];

function cell(x: unknown): string {
	if (x === null || x === undefined) return '';
	const s = String(x);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Every trial of a filter as CSV (one row per trial, no series) or JSON (full rows with the series
 * unpacked). Also served over HTTP: GET {CONVEX_SITE_URL}/export/trials.csv?source=human&cue=...
 */
export const trials = query({
	args: { ...filterArgs, format: v.union(v.literal('csv'), v.literal('json')) },
	handler: async (ctx, { format, ...f }) => {
		const rows = await scanTrials(ctx, f);
		const stamp = new Date().toISOString().slice(0, 10);
		const name = `circle-chase-trials-${f.source ?? 'human'}-${stamp}`;
		if (format === 'csv') {
			const lines = [COLUMNS.map(([c]) => c).join(',')];
			for (const t of rows) lines.push(COLUMNS.map(([, get]) => cell(get(t))).join(','));
			return { filename: `${name}.csv`, contentType: 'text/csv', rows: rows.length, body: lines.join('\n') + '\n' };
		}
		const out = [];
		for (const t of rows) {
			const packed = await packedSeriesOf(ctx, t);
			out.push({ ...light(t), decision: isDecision(t), series: packed ? unpackSeries(packed) : null });
		}
		return { filename: `${name}.json`, contentType: 'application/json', rows: rows.length, body: JSON.stringify(out) };
	}
});
