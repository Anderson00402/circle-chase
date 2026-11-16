/**
 * Plain-words definitions for every number on the dashboard, from docs/STUDY.md and
 * convex/README.md ("Interpretations"). One source for the InfoTips and the "How this is measured"
 * panel, so the two never disagree.
 */
export const DEFS = {
	trial: 'One power-up: from eating the power dot until 3 s after the power ends.',
	counted:
		'A power-up counts toward the rates when it shows a decision about the end: the player was chasing a scared ghost in its last 3 s (engaged), the power ran out by itself, the player stayed for the 3 s after, and the last chase ended with turning away in time, too early, staying too long or being caught. Every rate on this page divides by these counted power-ups. Catches are counted apart.',
	engaged: 'The player was chasing a scared ghost at some point in the last 3 s of the power (the warning window).',
	chasing:
		'The path distance to the nearest scared ghost within 8 tiles has been shrinking over the last 0.3 s, or is at most 1 tile.',
	wellTimed:
		'Turned away in time: the player turned away from the last chase with 0.2 to 2 s left, out of counted power-ups. Higher is better: the player used the power almost to the end and got out in time. This is the headline.',
	tooLate:
		'Stayed too long or was caught, out of counted power-ups. Lower is better. Stayed too long: still chasing when the power ended (turned with less than 0.2 s left, after the end, or never).',
	caught:
		'Caught, out of counted power-ups: within 5 tiles of a ghost that had just turned dangerous when the power ended, and caught by one within 3 s. The worst part of "too late". Lower is better.',
	tooEarly:
		'Turned away with more than 2 s left while a ghost was still reachable, out of counted power-ups. Lower is better: the player wasted power because they could not tell how much was left.',
	catches:
		'Caught the ghost: the last chase ended by eating the ghost and no chase followed. Eating a ghost shows the player was chasing, not whether they knew the time left (a lucky late catch looks the same), so catches are in no rate. Shown as a share of engaged power-ups; a late catch is one with 1.5 s or less left.',
	interval:
		'95% interval, clustered by participant: we resample people (not single power-ups) 2,000 times, because one person\'s power-ups are alike. Conditions with fewer than 3 people use a 95% Wilson interval instead. Wide bars mean little data. We call a difference clear only when two intervals do not overlap.',
	notEnough: 'Conditions with fewer than 10 counted power-ups are shown faint and hollow and are never ranked.',
	turnAway:
		'Time left on the power when the player stopped closing in for good (the moment they were closest before quitting the last chase), over counted power-ups. Negative when they only turned after the power had ended. 0.2 to 2 s is the well-timed window; 0.5 to 1 s is ideal.',
	wasted: 'Seconds of power left unused after an early retreat (turned away with more than 2 s left while a ghost was still reachable).',
	approach:
		'For counted power-ups, the path distance in tiles to the nearest scared ghost (after the end: to the ghosts that were scared when it ran out), averaged per condition, against time left. Sampled 10 times a second.',
	stillChasing: 'Share of counted power-ups in which the player was still closing in on a scared ghost at that moment.',
	learning:
		'Well-timed and too-late rates by the power-up\'s number within its block (all conditions together), and by the block\'s position in the session, with Wilson intervals. A rising well-timed line means players improve with practice; the counterbalanced order spreads that evenly over the conditions.',
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
	'Each engaged power-up is judged by how its last chase ended. Caught comes first (caught within 3 s and within 5 tiles of a ghost that just turned dangerous when the power ended). Then: ate the ghost (caught the ghost, no decision), still chasing at the end (stayed too long), turned 0.2 to 2 s before the end (in time), turned earlier with a ghost in reach (too early). Other, not engaged and interrupted cover the rest.';

export const DESIGN = [
	'Within-subject: each participant plays one 90 s block per condition, in a counterbalanced order (balanced Latin square), so practice does not favour any condition.',
	'Each power-up lasts a random 4 to 8 s, so only the signal can tell how much is left; power dots grow back and lives are unlimited, giving many power-ups per block.',
	'After each block players rate clarity and distraction (1-7); behaviour around the end of every power-up is measured automatically.'
];
