/**
 * Yield of the instrument: how many power-ups end in a timing decision, and where the others go.
 * Plays many simulated blocks with the real tracker (`simulateBlock`) and sorts every power-up into
 * one place, first that applies. Pure and deterministic for its options; used by `yield.test.ts`
 * (YIELD=1) to compare engine settings and ways of playing.
 *
 * The places, for a power-up that is not a decision, catch or "other":
 * - cut short: died while the power was on, or the block ended.
 * - ignored: the simulated participant did not bother with this power-up (model `ignore`).
 * - no target near the end: in the warning window no scared ghost was out of the pen, split into
 *   "all eaten before the window" and "none out (in the pen or on the way home)".
 * - target out of range: scared ghosts were out in the window but never within 6 tiles.
 * - believed over: a scared ghost was within 6 tiles in the window, but by then the player believed
 *   the power had run out (believed time left minus caution at or below zero).
 * - in range, not chased: a ghost within 6 tiles, the player believed time remained, and still no
 *   chase reached the window (gave it up as too far, or ate dots).
 */
import { DECISIONS, WARN, CHASE } from '#convex/lib/rules.ts';
import type { BotOptions } from '../game/engine/bot';
import type { GameConfig } from '../game/types';
import { simulateBlock, type SimTrial } from './block';
import { drawProfile, FLAT_NOISE, FLAT_DISTRACTION, mix, trialAwareness, type PlantedLevel } from './model';
import { makeRng } from '../game/engine/game';

export const PLACES = [
	'decision', 'catch', 'other', 'cut short', 'ignored', 'all eaten before the window', 'none out near the end',
	'ate one early, rest out of range', 'target out of range', 'believed over', 'in range, not chased'
] as const;
export type Place = (typeof PLACES)[number];

export function placeOf(t: SimTrial): Place {
	const m = t.measures;
	if (m.endReason !== 'expired' || m.after.cut === 'quit') return 'cut short';
	if (m.inRates && (DECISIONS as readonly string[]).includes(m.outcome)) return 'decision';
	if (m.outcome === 'catch') return 'catch';
	if (m.outcome === 'other') return 'other';
	if (m.outcome !== 'not-engaged' && m.outcome !== 'caught') return 'other';
	if (t.awareness?.ignore) return 'ignored';
	const s = m.series;
	let out = false, near = false, believedOver = false;
	for (let i = 0; i < s.t.length; i++) {
		const left = s.left[i];
		if (!(left > 0 && left <= WARN)) continue;
		const d = s.dist[i];
		if (d === null) continue;
		out = true;
		if (d <= CHASE.range) {
			if (!near && t.awareness && t.error !== null) believedOver = left + t.error - t.awareness.caution <= 0;
			near = true;
		}
	}
	if (!out) return m.allEatenLeft !== null && m.allEatenLeft > WARN ? 'all eaten before the window' : 'none out near the end';
	if (!near) return m.eats.length ? 'ate one early, rest out of range' : 'target out of range';
	return believedOver ? 'believed over' : 'in range, not chased';
}

export interface YieldOptions {
	blocks: number;
	seconds?: number;
	seed?: number;
	/** Engine settings on top of STUDY_CONFIG. */
	config?: Partial<GameConfig>;
	/** Bot settings on top of each participant's skill and awareness. */
	bot?: Partial<BotOptions>;
	/** Awareness noise for every block (default: the flat preset's). */
	noise?: number;
}

export interface YieldReport {
	blocks: number;
	minutes: number;
	powerUps: number;
	places: Record<Place, number>;
	outcomes: Record<string, number>;
	decisions: number;
	catches: number;
	deaths: number;
	score: number;
	/** Power-ups whose power ran out with a scared ghost within 6 tiles at some point of the window. */
	trials: SimTrial[];
}

/** Plays `blocks` blocks, each a fresh simulated participant (drawn like the simulator's), flat awareness. */
export function measureYield(o: YieldOptions): YieldReport {
	const seconds = o.seconds ?? 90;
	const level: PlantedLevel = { cue: 'x', noise: o.noise ?? FLAT_NOISE, distraction: FLAT_DISTRACTION };
	const places = Object.fromEntries(PLACES.map((p) => [p, 0])) as Record<Place, number>;
	const outcomes: Record<string, number> = {};
	const trials: SimTrial[] = [];
	let deaths = 0, score = 0;
	for (let b = 0; b < o.blocks; b++) {
		const seed = mix(o.seed ?? 1, 7000 + b);
		const profile = drawProfile(seed, 13);
		const rng = makeRng(mix(seed, 3));
		// A participant some way into the session (learning mostly settled), as most blocks are.
		let k = 20 + Math.floor(rng() * 60), n = 0;
		const r = simulateBlock({
			cue: 'x', seed: mix(seed, 5), seconds, skill: profile.skill, config: o.config, bot: o.bot,
			awareness: () => trialAwareness(profile, level, k++, rng)
		}, { sessionKey: 's', blockKey: 'b' + b, trialKey: () => `b${b}t${n++}` });
		deaths += r.deaths;
		score += r.score;
		for (const t of r.trials) {
			trials.push(t);
			places[placeOf(t)]++;
			outcomes[t.measures.outcome] = (outcomes[t.measures.outcome] ?? 0) + 1;
		}
	}
	return {
		blocks: o.blocks, minutes: (o.blocks * seconds) / 60, powerUps: trials.length, places, outcomes,
		decisions: places.decision, catches: places.catch, deaths, score, trials
	};
}

/** Plain-text table of one or more reports side by side. */
export function yieldTable(rows: { name: string; r: YieldReport }[]): string {
	const pct = (k: number, n: number) => (n ? `${((k / n) * 100).toFixed(0)}%` : '-');
	const lines: string[][] = [['', ...rows.map((x) => x.name)]];
	const add = (label: string, f: (r: YieldReport) => string) => lines.push([label, ...rows.map((x) => f(x.r))]);
	add('power-ups', (r) => String(r.powerUps));
	add('power-ups per minute', (r) => (r.powerUps / r.minutes).toFixed(2));
	for (const p of PLACES) add('  ' + p, (r) => `${r.places[p]} (${pct(r.places[p], r.powerUps)})`);
	add('decisions per power-up', (r) => pct(r.decisions, r.powerUps));
	add('decisions per minute', (r) => (r.decisions / r.minutes).toFixed(2));
	add('catches per power-up', (r) => pct(r.catches, r.powerUps));
	add('  in time', (r) => pct(r.outcomes['timely-retreat'] ?? 0, r.decisions));
	add('  too early', (r) => pct(r.outcomes['early-retreat'] ?? 0, r.decisions));
	add('  stayed too long', (r) => pct(r.outcomes['overstayed'] ?? 0, r.decisions));
	add('  caught', (r) => pct(r.trials.filter((t) => t.measures.inRates && t.measures.outcome === 'caught').length, r.decisions));
	add('scared ghosts out at the start', (r) => (r.trials.reduce((a, t) => a + t.measures.scaredAtStart, 0) / Math.max(1, r.powerUps)).toFixed(2));
	add('nearest at the start, median tiles', (r) => {
		const d = r.trials.map((t) => t.measures.series.dist[0]).filter((x): x is number => x !== null && x !== undefined).sort((a, b) => a - b);
		return d.length ? String(d[d.length >> 1]) : '-';
	});
	add('ghosts eaten per power-up', (r) => (r.trials.reduce((a, t) => a + t.measures.eats.length, 0) / Math.max(1, r.powerUps)).toFixed(2));
	add('deaths per minute', (r) => (r.deaths / r.minutes).toFixed(2));
	add('score per minute', (r) => (r.score / r.minutes).toFixed(0));
	const w = lines[0].map((_, i) => Math.max(...lines.map((l) => l[i].length)));
	return lines.map((l) => l.map((x, i) => (i === 0 ? x.padEnd(w[i]) : x.padStart(w[i]))).join('  ')).join('\n');
}
