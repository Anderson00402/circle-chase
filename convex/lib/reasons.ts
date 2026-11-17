/**
 * Why a trial is not among the decisions the rates use, in plain words (null when it counts). One
 * source for the run summary (convex/runs.ts) and the replay player, so "not counted" always comes
 * with the same reason. No Convex server imports: the browser bundles it too.
 */
import { RULES_VERSION, isDecision } from './rules';

export interface ReasonInput {
	outcome: string;
	inRates: boolean;
	engaged: boolean;
	rulesVersion?: number;
	endReason: string;
	after?: { cut?: string | null; died?: boolean } | null;
}

export function notCountedReason(t: ReasonInput, current: number = RULES_VERSION): string | null {
	if (isDecision(t)) return null;
	if ((t.rulesVersion ?? 1) !== current) return 'Recorded under older rules';
	switch (t.endReason) {
		case 'died': return 'Died while the power was on, so it never ran out';
		case 'cleared': return 'The level was cleared while the power was on';
		case 'refreshed': return 'Another power dot was eaten while the power was on';
		case 'quit': return 'The run ended while the power was on';
	}
	if (t.after?.cut === 'quit') return 'The run ended less than 3 s after the power ran out';
	if (t.after?.cut === 'power') return 'A new power-up started less than 3 s after this one ended';
	if (t.after?.cut === 'clear') return 'The level was cleared less than 3 s after the power ran out';
	switch (t.outcome) {
		case 'not-engaged': return 'Not chasing a ghost in the last 3 s';
		case 'catch': return 'Ate the ghost, which shows no decision about the end';
		case 'other': return 'Chasing in the last 3 s, but with no decision to judge (the ghost was too far off, or out of reach)';
		case 'late-catch': return 'Recorded under older rules';
	}
	// A decision class outside the rates: the player was not chasing near the end.
	if (!t.engaged) return t.outcome === 'caught' ? 'Not chasing a ghost in the last 3 s, so being caught shows no decision' : 'Not chasing a ghost in the last 3 s';
	return 'Not eligible for the rates';
}
