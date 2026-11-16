/**
 * Plain-words captions for a replay: what each outcome means, and one sentence telling what the
 * player did around the end of this power-up. Definitions follow docs/STUDY.md.
 */
import type { Outcome } from '../telemetry/types';
import { OUTCOME_LABEL } from '../telemetry/types';

export { OUTCOME_LABEL };

export const GHOST_NAME: Record<string, string> = {
	hunter: 'Hunter',
	ambusher: 'Ambusher',
	guard: 'Guard',
	drifter: 'Drifter'
};
export const ghostName = (id: string | null | undefined) => (id ? (GHOST_NAME[id] ?? id) : null);

/** What each outcome class means, in one short sentence. */
export const OUTCOME_MEANING: Record<Outcome, string> = {
	caught: 'Caught by a ghost within 3 s after the power ran out: the cue did not warn in time.',
	'late-catch': 'Ate a ghost in the last 1.5 s: used the power right to the limit.',
	overstayed: 'Still closing in when the power ran out, within 5 tiles, and survived.',
	'timely-retreat': 'Turned away with 0.2 to 2 s left: the ideal timing.',
	'early-retreat': 'Turned away with more than 2 s left while a ghost was still in reach.',
	'not-engaged': 'Was not chasing in the last 3 s of the power.',
	other: 'Was chasing near the end, but none of the five patterns fits.',
	interrupted: 'The power did not run out by itself, so there is no end to judge.'
};

export type Tone = 'good' | 'bad' | 'warn' | 'neutral';
export const OUTCOME_TONE: Record<Outcome, Tone> = {
	caught: 'bad',
	'late-catch': 'good',
	overstayed: 'warn',
	'timely-retreat': 'good',
	'early-retreat': 'warn',
	'not-engaged': 'neutral',
	other: 'neutral',
	interrupted: 'neutral'
};

/** Outcomes in the order the list shows them. */
export const OUTCOME_ORDER: Outcome[] = ['caught', 'overstayed', 'late-catch', 'timely-retreat', 'early-retreat', 'other', 'not-engaged', 'interrupted'];

const s1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const s2 = (x: number) => x.toFixed(2);

/** "1.4 s left" or "0.6 s after the end". */
export function leftWords(left: number, digits = 1): string {
	const f = digits === 2 ? s2 : s1;
	if (Math.abs(left) < 0.005) return 'at the end';
	return left > 0 ? `${f(left)} s left` : `${f(-left)} s after the end`;
}

/** Signed seconds left for compact readouts: "1.42", "-0.30". */
export const signed = (left: number, digits = 2) => (left < 0 ? '−' : '') + Math.abs(left).toFixed(digits);

/** The trial fields the story needs (a `trials.get` row has all of them). */
export interface StoryTrial {
	outcome: Outcome | string;
	total: number;
	endReason: string;
	turnLeft: number | null;
	turnDist: number | null;
	endDist: number | null;
	eats: { t: number; left: number; ghost: string }[];
	allEatenLeft: number | null;
	wasted: number | null;
	reaction: number | null;
	after: { died: boolean; caught: boolean; timeToCaught: number | null; killer: string | null; nearMiss: boolean; minDangerDist: number | null; cut?: string | null };
}

/**
 * One sentence about what happened. `turnGhost` / `endGhost` name the ghost the player was up
 * against at the turn and at the end (worked out from the clip); without them the sentence falls
 * back to the killer or the last ghost eaten.
 */
export function describe(t: StoryTrial, opts: { turnGhost?: string | null; endGhost?: string | null } = {}): string {
	const a = t.after;
	const killer = ghostName(a.killer);
	const lastEat = t.eats.length ? t.eats[t.eats.length - 1] : null;
	const the = (name: string | null | undefined) => (name ? `the ${name}` : 'a ghost');
	const turnG = the(ghostName(opts.turnGhost) ?? killer);
	const endG = the(ghostName(opts.endGhost) ?? ghostName(opts.turnGhost) ?? killer);
	const tiles = (d: number | null) => (d === null ? '' : `, ${s1(d)} tiles away`);
	const caughtTail = a.timeToCaught !== null ? `${s1(a.timeToCaught)} s after the power ended` : 'after the power ended';

	switch (t.outcome) {
		case 'caught': {
			const by = killer ? ` by the ${killer}` : '';
			if (t.turnLeft !== null && t.turnLeft < 0) {
				const later = a.timeToCaught !== null ? ` ${s1(Math.max(0, a.timeToCaught + t.turnLeft))} s later` : '';
				return `Kept chasing ${turnG} until ${s1(-t.turnLeft)} s after the power ended${tiles(t.turnDist)}, and was caught${by}${later}.`;
			}
			if (t.turnLeft !== null && t.turnLeft < 0.2) {
				return `Was still closing in on ${turnG} when the power ran out${tiles(t.endDist)}, and was caught${by} ${caughtTail}.`;
			}
			if (t.turnLeft !== null) {
				return `Turned away from ${turnG} with ${s1(t.turnLeft)} s left${tiles(t.turnDist)}, but was caught${by} ${caughtTail}.`;
			}
			return `Was ${t.endDist !== null ? s1(t.endDist) + ' tiles' : 'close'} from ${endG} when the power ran out, and was caught${by} ${caughtTail}.`;
		}
		case 'late-catch': {
			const late = [...t.eats].reverse().find((e) => e.left <= 1.5) ?? lastEat;
			const ate = late ? `Ate the ${ghostName(late.ghost)} with ${s1(late.left)} s left` : 'Ate a ghost in the last 1.5 s';
			const tail = a.died ? `, then was caught ${caughtTail}` : a.nearMiss ? ', then got away with a near miss' : ', then got away';
			return `${ate}, using the power to the limit${tail}.`;
		}
		case 'overstayed': {
			const near = a.nearMiss && a.minDangerDist !== null ? ` with a near miss (${s1(a.minDangerDist)} tiles)` : '';
			const react = t.reaction === null ? '' : t.reaction < 0.05 ? ', moved away right as it ran out' : `, moved away ${s1(t.reaction)} s after it ran out`;
			return `Was still closing in on ${endG} when the power ran out${tiles(t.endDist)}${react}, and got away${near}.`;
		}
		case 'timely-retreat':
			return `Turned away from ${turnG} with ${s1(t.turnLeft ?? 0)} s left${tiles(t.turnDist)}, and was clear when the ghosts turned dangerous.`;
		case 'early-retreat': {
			const waste = t.wasted !== null ? `, leaving ${s1(t.wasted)} s of power unused` : '';
			return `Gave up chasing ${turnG} with ${s1(t.turnLeft ?? 0)} s left${tiles(t.turnDist)} while a ghost was still in reach${waste}.`;
		}
		case 'not-engaged':
			return `Was not chasing in the last 3 s of the ${s1(t.total)} s power, so there is no ending to judge.`;
		case 'other':
			return t.allEatenLeft !== null
				? `Ate the last scared ghost with ${s1(t.allEatenLeft)} s left, so there was nothing left to chase or to flee from.`
				: 'Was chasing near the end, but none of the five patterns fits.';
		case 'interrupted': {
			const why: Record<string, string> = {
				died: 'The player was caught while the power was still on',
				cleared: 'The maze was cleared before the power ran out',
				refreshed: 'A second power dot restarted the power',
				quit: 'The player left before the power ran out'
			};
			const w = why[t.endReason] ?? (a.cut === 'quit' ? 'The player left during the seconds after the end' : 'The power did not run out by itself');
			return `${w}, so there is no ending to judge.`;
		}
		default:
			return '';
	}
}

/** Relative time for lists: "just now", "5 min ago", "3 h ago", or a date. */
export function ago(ms: number, now = Date.now()): string {
	const s = Math.max(0, (now - ms) / 1000);
	if (s < 45) return 'just now';
	if (s < 3600) return `${Math.round(s / 60)} min ago`;
	if (s < 86400) return `${Math.round(s / 3600)} h ago`;
	return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
