/**
 * How long a run is: a run ends itself once this many power-ups have been measured (the trial in
 * progress always finishes first, aftermath included). Counted in power-ups rather than minutes
 * because decisions come from power-ups: under study rules about one power-up in three ends in a
 * decision, and a power-up comes about every 15 s. docs/STUDY.md "How long a run is" has the numbers.
 *
 * Pure, so the simulator (src/lib/sim/session.ts) plays its blocks to the same length.
 */

/** The default: 16 power-ups, about 4 minutes and 5 to 6 decisions per run. */
export const RUN_LENGTH = 16;

/** The choices on the run console; 0 is "no limit" (the researcher ends the run). */
export const RUN_LENGTHS: readonly number[] = [8, 12, 16, 24, 0];

/** Seconds a power-up takes under study rules, on average, from one to the next (for the estimate shown). */
export const SECONDS_PER_POWER_UP = 15;

/** Plain words for a run length: "16 power-ups, about 4 min". */
export function runLengthWords(n: number): string {
	if (!n) return 'No limit';
	const min = Math.max(1, Math.round((n * SECONDS_PER_POWER_UP) / 60));
	return `${n} power-ups, about ${min} min`;
}
