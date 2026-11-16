/**
 * One visual code for the whole dashboard, so a condition or an outcome looks the same in every
 * chart.
 *
 * Conditions: thirteen is too many for one colour each, so identity is carried by the condition's
 * code (A, B, 0, 1-10) as a direct label, and its role by colour AND shape:
 *   reference (A, B)  grey, hollow diamond, dashed lines   (the yardsticks)
 *   baseline  (0)     blue, filled square                   (the timer bar)
 *   idea      (1-10)  yellow, filled circle
 * The three role colours were checked with the dataviz validator against the panel surface
 * (all pairs: CVD distance 15.5, normal-vision 18.1, every colour above 3:1). Grey is neutral on
 * purpose: the references are yardsticks, not contenders.
 *
 * Outcomes (labels and colours from src/lib/outcomes.ts): first the four decisions (the rates' denominator), in the order time runs: turned away
 * too early (violet), in time (green), stayed too long (amber), caught (red, so the worst failure
 * sits against the right edge of every bar). Then the power-ups outside the rates in greys: caught
 * the ghost (no decision about the end), other (hatched), not engaged, interrupted (hatched).
 * Adjacent decision pairs pass the validator on the panel surface (CVD distance at least 9.1,
 * normal-vision at least 20.3). The greys are below 3:1 on purpose (they should recede); their
 * counts are in the tooltip and the condition table.
 */
import { CUES } from '#lib/game/cues/index.ts';
import type { Cue, CueChannel } from '#lib/game/types.ts';
import { cueListings } from '#lib/ui/cues.ts';
import { OUTCOME_INFO, OUTCOME_ORDER, outcomeInfo } from '#lib/outcomes.ts';

export type Role = Cue['role'];
export type Shape = 'diamond' | 'square' | 'circle';

export const ROLE_COLOR: Record<Role, string> = {
	reference: 'var(--chart-reference)',
	baseline: 'var(--chart-baseline)',
	idea: 'var(--chart-idea)'
};
export const ROLE_SHAPE: Record<Role, Shape> = { reference: 'diamond', baseline: 'square', idea: 'circle' };
export const ROLE_NOUN: Record<Role, string> = { reference: 'Reference', baseline: 'Timer bar', idea: 'Idea' };

export interface Condition {
	id: string;
	code: string;
	name: string;
	role: Role;
	channel: CueChannel | null;
	/** Display order: A, B, 0, 1-10. */
	order: number;
	color: string;
	shape: Shape;
	/** Dash pattern for lines of this condition (references are dashed). */
	dash: string | undefined;
}

const LISTING = cueListings();

/** All thirteen conditions in display order. */
export const CONDITIONS: Condition[] = LISTING.map((l, i) => ({
	id: l.id,
	code: l.code,
	name: l.name,
	role: l.role,
	channel: CUES.find((c) => c.id === l.id)?.channel ?? null,
	order: i,
	color: ROLE_COLOR[l.role],
	shape: ROLE_SHAPE[l.role],
	dash: l.id === 'none' ? '5 4' : l.id === 'classic-blink' ? '1.5 3.5' : undefined
}));

const BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

/** The condition for an id; unknown ids (old data) get a neutral entry so nothing crashes. */
export function condition(id: string): Condition {
	return BY_ID.get(id) ?? {
		id, code: '?', name: id, role: 'idea', channel: null, order: 99, color: 'var(--ink-faint)', shape: 'circle', dash: undefined
	};
}

/** The three yardsticks every idea is compared with. */
export const YARDSTICKS = ['none', 'classic-blink', 'timer-bar'] as const;

export const CHANNEL_LABEL: Record<CueChannel, string> = {
	hud: 'On the HUD',
	ghosts: 'On the ghosts',
	player: 'On the player',
	maze: 'In the maze',
	screen: 'Whole screen'
};

export type OutcomeId =
	| 'caught' | 'overstayed' | 'timely-retreat' | 'early-retreat' | 'catch' | 'other' | 'not-engaged' | 'interrupted';

export interface OutcomeStyle {
	id: OutcomeId;
	label: string;
	color: string;
	/** Hatched fill (other, cut short): a second channel besides colour. */
	hatch: boolean;
	/** A decision outcome: part of the rates' denominator. */
	inRates: boolean;
	/** One-line definition. */
	def: string;
}

/**
 * Outcome styles for charts. Labels, definitions and colours come from the shared vocabulary
 * (src/lib/outcomes.ts); only the hatching is a chart matter.
 */
export const OUTCOMES: OutcomeStyle[] = (OUTCOME_ORDER as OutcomeId[]).map((id) => ({
	id,
	label: OUTCOME_INFO[id].label,
	color: OUTCOME_INFO[id].color,
	hatch: id === 'other' || id === 'interrupted',
	inRates: OUTCOME_INFO[id].decision,
	def: OUTCOME_INFO[id].def
}));

export const OUTCOME_BY_ID = new Map(OUTCOMES.map((o) => [o.id, o]));
export function outcomeStyle(id: string): OutcomeStyle {
	const known = OUTCOME_BY_ID.get(id as OutcomeId);
	if (known) return known;
	// Older classes (late-catch) and unknown ones recede like "other", under their own label.
	return { ...OUTCOME_BY_ID.get('other')!, id: 'other', label: outcomeInfo(id).label, def: outcomeInfo(id).def };
}

/** Colours for rate charts and rate numbers: the same as the outcome they count (too late: stayed too long). */
export const WELL_COLOR = OUTCOME_INFO['timely-retreat'].color;
export const LATE_COLOR = OUTCOME_INFO.overstayed.color;
export const EARLY_COLOR = OUTCOME_INFO['early-retreat'].color;
export const CAUGHT_COLOR = OUTCOME_INFO.caught.color;
export const RATE_COLOR = { wellTimed: WELL_COLOR, tooLate: LATE_COLOR, tooEarly: EARLY_COLOR, caught: CAUGHT_COLOR } as const;

// Formatting, shared so every number on the page reads the same way.

export const pct = (x: number | null | undefined, digits = 0) =>
	x === null || x === undefined || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(digits)}%`;
export const pctRange = (lo: number | null, hi: number | null) =>
	lo === null || hi === null ? '–' : `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`;
export const secs = (x: number | null | undefined, digits = 1) =>
	x === null || x === undefined ? '–' : `${x.toFixed(digits)} s`;
export const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export function ago(ms: number, now = Date.now()): string {
	const s = Math.max(0, Math.round((now - ms) / 1000));
	if (s < 60) return `${s} s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h} h ago`;
	return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Small deterministic hash in [0, 1) for jitter that does not move between renders. */
export function hash01(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
	return ((h >>> 0) % 10000) / 10000;
}

/** "Nice" tick values for a numeric range. */
export function ticks(lo: number, hi: number, count = 5): number[] {
	const span = hi - lo;
	if (span <= 0) return [lo];
	const raw = span / count;
	const mag = 10 ** Math.floor(Math.log10(raw));
	const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? raw;
	const out: number[] = [];
	for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
	return out;
}
