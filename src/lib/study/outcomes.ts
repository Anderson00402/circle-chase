/** Plain words and colours for trial outcomes on the console and the run summary (rules: convex/lib/rules.ts). */
import type { LegacyOutcome, Outcome } from '../telemetry/types';

type Any = Outcome | LegacyOutcome;

/** Display order: decisions about the end first, then the rest. */
export const ORDER: Any[] = ['timely-retreat', 'overstayed', 'caught', 'early-retreat', 'catch', 'late-catch', 'other', 'not-engaged', 'interrupted'];

/** Short plain-words name ("2 turned away in time"). */
export const WORDS: Record<Any, string> = {
	'timely-retreat': 'turned away in time',
	overstayed: 'stayed too long, got away',
	caught: 'caught after the end',
	'early-retreat': 'turned away too early',
	catch: 'ate the ghost',
	'late-catch': 'late catch (old rules)',
	other: 'no clear ending',
	'not-engaged': 'not chasing near the end',
	interrupted: 'cut short'
};

/** good: judged the end well. warn: misjudged it but survived. bad: caught. catch: ate the ghost (no decision). dim: nothing to judge. */
export const TONE: Record<Any, 'good' | 'warn' | 'bad' | 'catch' | 'dim'> = {
	'timely-retreat': 'good', overstayed: 'warn', caught: 'bad', 'early-retreat': 'warn', catch: 'catch', 'late-catch': 'catch',
	other: 'dim', 'not-engaged': 'dim', interrupted: 'dim'
};

export const toneOf = (o: string) => TONE[o as Any] ?? 'dim';
export const wordsOf = (o: string) => WORDS[o as Any] ?? o;

/** "2 turned away in time, 1 caught after the end" (largest first), or "" when empty. */
export function mixWords(outcomes: Record<string, number>, max = 3): string {
	const parts = ORDER.filter((o) => (outcomes[o] ?? 0) > 0)
		.sort((a, b) => (outcomes[b] ?? 0) - (outcomes[a] ?? 0))
		.map((o) => `${outcomes[o]} ${WORDS[o]}`);
	return parts.length > max ? `${parts.slice(0, max).join(', ')}, ...` : parts.join(', ');
}
