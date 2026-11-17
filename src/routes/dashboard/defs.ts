/**
 * Plain-words definitions for every number on the dashboard, from docs/STUDY.md (rules version 3)
 * and convex/README.md ("Interpretations"). One source for the InfoTips and the "How this is
 * measured" panel, so the two never disagree. The definitions every page shares (what a chase is,
 * engaged, counted, turn-away time) come from src/lib/definitions.ts, whose numbers come from the
 * rules file; the thresholds used here come from the rules file too.
 */
import { DEFINITIONS } from '#lib/definitions.ts';
import { CAUGHT_DIST, OVERSTAY_DIST, PURSUIT_GAIN, REACH_SPEED, TIMELY, TIMELY_CHECK, WARN } from '#convex/lib/rules.ts';

const [MIN_LEFT, LINE] = TIMELY;

export const DEFS = {
	trial: `One power-up: from eating the power dot until ${WARN} s after the power ends.`,
	counted: `${DEFINITIONS.counted} Every rate on this page divides by these counted power-ups. Catches are counted apart.`,
	engaged: DEFINITIONS.engaged,
	chasing: DEFINITIONS.chasing,
	fleeing:
		`Under study rules a scared ghost within 7 tiles of the player runs from it, at three quarters of the player's power-up speed, so a chase gains about ${PURSUIT_GAIN} tiles a second and is often still under way when the power runs out: that is when the player has to decide. Arcade rules keep scared ghosts wandering at random.`,
	wellTimed:
		`Turned away in time: the player turned away from the last chase with ${MIN_LEFT} to ${LINE} s left, from a ghost they could still have reached, out of counted power-ups. Higher is better: the player used the power almost to the end and got out in time. This is the headline.`,
	tooLate:
		`Stayed too long or was caught, out of counted power-ups. Lower is better. Stayed too long: still chasing when the power ended (turned with less than ${MIN_LEFT} s left, after the end, or never), with the chased ghost within ${OVERSTAY_DIST} tiles.`,
	caught:
		`Caught, out of counted power-ups: within ${CAUGHT_DIST} tiles of a ghost that had just turned dangerous when the power ended, and caught by one within ${WARN} s. The worst part of "too late". Lower is better.`,
	tooEarly:
		`Turned away with more than ${LINE} s left from a ghost the player could still have reached, out of counted power-ups, including giving a ghost up very early (before the last ${WARN} s). Lower is better: the player wasted power because they could not tell how much was left.`,
	gaveUpEarly:
		`Gave up very early: not chasing in the last ${WARN} s, but the last chase ended with a turn-away, with more than ${WARN} s left, from a ghost the player could still have reached, and nothing was chased after it. It counts as turned away too early (left out, a cue that scares players off early would lose its worst power-ups from the rates) and is shown apart as a part of too early.`,
	catches:
		`Caught the ghost: the last chase ended by eating the ghost in the last ${WARN} s. Eating a ghost shows the player was chasing, not whether they knew the time left (a lucky late catch looks the same), so catches are in no rate. Shown as a share of eligible power-ups (the power ran out by itself, the player stayed for the ${WARN} s after, and they were chasing in the last ${WARN} s or gave a ghost up very early); a late catch is one with 1.5 s or less left.`,
	interval:
		'95% interval, clustered by participant: we resample people (not single power-ups) 2,000 times, because one person\'s power-ups are alike. Conditions with fewer than 3 people use a 95% Wilson interval instead. Wide bars mean little data. Two separate intervals are not how differences are judged here: see "clear" below.',
	clear:
		'A difference between two conditions is called clear only when it holds inside each person and survives the adjustment for making many comparisons at once. For each pair, every person who played both gives one number: their rate under one minus their rate under the other. A t-test over those people gives the p-value (only with 5 or more people who played both; fewer give no test, and the page says "too few people" rather than "no difference"). Holm\'s method then adjusts the p-values of a whole family together (all 78 pairs of the 13 conditions, or the 12 comparisons against one yardstick), so the chance of even one false "clear" in the family stays at 5%. With 78 pairs, about four would look different by luck alone at the usual 5% level; the adjustment removes them.',
	groups:
		'The top group is the condition with the highest rate of turning away in time and every condition not clearly behind it. The leaders are the top of that group that are each clearly ahead of every condition outside it and not clearly apart from each other. Both come from the 78-pair family above, so they never claim more than those comparisons show.',
	paired:
		'For each person who played both conditions: their rate under the condition minus their rate under the yardstick. The point is the average over those people; the bar is its 95% interval (a t interval over people, so one person\'s many power-ups count once). "Clear" means the difference survives Holm\'s adjustment for every comparison in the chart.',
	turnPaired:
		'For each person who played both: their median turn-away time under the condition minus under the timer bar, in seconds. Positive: they turned away with more time left (earlier). It does not depend on where the "too early" line sits.',
	ratingsPaired:
		'For each person who rated both: their rating of the condition minus their rating of the timer bar (1 to 7 scale), averaged over those people, with a 95% interval and Holm\'s adjustment over the conditions compared.',
	precision:
		'People needed: the number of people for an 80% chance of finding a true 15-point difference from the timer bar, at the 5% level shared over the 12 comparisons against it (and for one planned comparison in brackets). It uses the spread of the person-by-person differences seen so far, so it already reflects how many counted power-ups each person gives; more counted power-ups per person (longer runs) would lower it. The same arithmetic, at the gap seen between the two highest conditions and adjusted for every pair, says what ordering them would take.',
	breakdown:
		'For each person who played both levels (early and late blocks, short and long power-ups): their rate at the second level minus at the first, averaged over those people, with a 95% interval over people. The first row pools every condition; the rows below are per condition, adjusted together with Holm\'s method. Where fewer than 5 people played both levels, people at one level are compared with people at the other instead (Welch\'s t-test on one rate per person), which is weaker: the people differ as well as the level. That is always so for block position per condition (a person plays each condition in one run, and the counterbalanced order decides whether it falls early or late), and usually for sound and input, which stay the same for a person.',
	notEnough: 'Conditions with fewer than 10 counted power-ups, or with counted power-ups from fewer than 5 people, are shown faint and hollow and are never ranked.',
	turnAway:
		`${DEFINITIONS.turnAway} Shown for counted power-ups. ${MIN_LEFT} to ${LINE} s is the well-timed window; about 1 s is ideal. Read it beside the rates: it does not depend on where the ${LINE} s line is.`,
	wasted: `Seconds of power left unused after an early retreat (turned away with more than ${LINE} s left from a ghost still reachable).`,
	line:
		`Where "turned away too early" starts. The rules put it at ${LINE} s left, where every cue switches to its final warning, so "in time" reads "left during the final warning". Right at that line the classes are harsher on players who anticipate than on those who react, so the page can count too early from ${TIMELY_CHECK} s instead, as a check. Every class, rate and comparison is then worked out again from the stored measures with the moved line, using the same rules; stored outcomes never change. A result that holds under both lines does not hang on where the line sits.`,
	timeToSpare:
		`For each turn-away (in time or too early): the power left at the turn minus the time the pursuit still needed to reach the ghost, which is the distance at the turn divided by how fast the gap closes (study rules: about ${PURSUIT_GAIN} tiles a second, because scared ghosts flee; arcade rules: the player's ${REACH_SPEED} tiles a second, the ghost taken to hold still). Above 0: the player still had time for that ghost and gave it up. Below 0: the chase could not have reached it before the power ran out, so breaking off was a fair judgement of the chase, whatever the clock said.`,
	limits:
		`What this cannot do: it cannot read intent (a player who ignores the ghosts still runs at one now and then; that noise is the same for every condition). And some "too early" is a judgement of the chase, not of the clock: a fleeing ghost is gained on at about ${PURSUIT_GAIN} tiles a second, so a player who sees a chase will not close in time and turns away with 2.5 s left is too early by the clock although they judged the chase well. That affects every condition alike, so it does not create a ranking, but it puts a floor under "too early" that a perfect signal cannot remove. The time-to-spare view and the ${TIMELY_CHECK} s line are there to check it.`,
	approach:
		'For counted power-ups whose power lasted at least 4 s, so every point rests on the same power-ups: the median path distance in tiles to the nearest scared ghost (after the end: to the ghosts that were scared when it ran out), against time left. Sampled 10 times a second.',
	stillChasing:
		'Share of counted power-ups (power of at least 4 s) in which the player was still in a chase at that moment (from its first step to its turn-away), with a 95% Wilson band. A good signal makes the curve drop inside the well-timed window, before the power ends.',
	neverTurned:
		'Counted power-ups where the last chase was still running when the power ended and the player never turned away (stayed too long or caught). They have no turn-away time, so they get their own column.',
	learning:
		'Turned away in time and too-late rates by the power-up\'s number within its run (all conditions together), and by the run\'s position in the session, with Wilson intervals. A rising in-time line means players improve with practice; the counterbalanced order spreads that evenly over the conditions. Per condition, see "Does it depend on how it was played?".',
	clarity: 'After each block: "I could tell when the power was about to run out", 1 (not at all) to 7 (completely). Mean with a 95% interval.',
	distraction: 'After each block: "The signal got in the way of playing", 1 to 7. Lower is better.',
	channel:
		'Conditions grouped by where the signal is shown: on the HUD, on the ghosts, on the player, in the maze, or over the whole screen. Rates pool all counted power-ups of the group. No signal (A) shows nothing and is left out.',
	simulated:
		'Simulated players are bots. A bot cannot see a cue, so their results say nothing about which signal is better; they only show that the measuring pipeline works.',
	participants: 'People (one per browser) with at least one power-up in the current filter.',
	fps: 'Average frames per second while the power-up was played. Below 50 the game may have stuttered.'
} as const;

export const OUTCOME_ORDER_NOTE =
	`Each power-up that counts is judged by how its last chase ended. Caught comes first (caught within ${WARN} s and within ${CAUGHT_DIST} tiles of a ghost that just turned dangerous when the power ended). Then: ate the ghost in the last ${WARN} s (caught the ghost, no decision), still chasing at the end with the ghost within ${OVERSTAY_DIST} tiles (stayed too long), turned ${MIN_LEFT} to ${LINE} s before the end from a ghost in reach (in time), turned earlier from a ghost in reach, including giving it up before the last ${WARN} s (too early). Other, not engaged and interrupted cover the rest.`;

export const DESIGN = [
	'Within-subject: each participant plays one run of each condition, in a counterbalanced order (balanced Latin square), so practice does not favour any condition. Conditions are compared inside each person.',
	'Each power-up lasts a random 4 to 8 s, so only the signal can tell how much is left; power dots grow back and lives are unlimited, giving many power-ups per run. Scared ghosts near the player flee from it, so many chases are still under way when the power runs out.',
	'After each run players may rate clarity and distraction (1-7); behaviour around the end of every power-up is measured automatically.'
];
