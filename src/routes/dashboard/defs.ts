/**
 * Plain-words definitions for every number on the dashboard, from docs/STUDY.md and
 * convex/README.md ("Interpretations"). One source for the InfoTips and the "How this is measured"
 * panel, so the two never disagree.
 */
export const DEFS = {
	trial: 'One power-up: from eating the power dot until 3 s after the power ends.',
	counted:
		'A power-up counts toward the rates when the player was chasing a scared ghost in its last 3 s (engaged), the power ran out by itself, and the player stayed for the 3 s after. Every rate on this page divides by counted power-ups.',
	engaged: 'The player was chasing a scared ghost at some point in the last 3 s of the power (the warning window).',
	chasing:
		'The path distance to the nearest scared ghost within 8 tiles has been shrinking over the last 0.3 s, or is at most 1 tile.',
	wellTimed:
		'Late catches plus timely retreats, out of counted power-ups. Higher is better: the player used the power almost to the end and got out in time.',
	caught:
		'Caught by a ghost that had been scared, within 3 s after the power ended, out of counted power-ups. Lower is better: the clearest sign the player did not see the end coming.',
	interval:
		'95% Wilson interval: the range the true rate plausibly lies in, given how few trials there are. Wide bars mean little data. We call a difference clear only when two intervals do not overlap.',
	notEnough: 'Conditions with fewer than 10 counted power-ups are shown faint and hollow and are never ranked.',
	turnAway:
		'Time left on the power when the player stopped closing in for good (the moment they were closest before quitting the chase). Negative when they only turned after the power had ended. 0.2 to 2 s is the well-timed window; 0.5 to 1 s is ideal.',
	wasted: 'Seconds of power left unused after an early retreat (turned away with more than 2 s left while a ghost was still reachable).',
	approach:
		'For counted power-ups, the path distance in tiles to the nearest scared ghost (after the end: to the ghosts that were scared when it ran out), averaged per condition, against time left. Sampled 10 times a second.',
	stillChasing: 'Share of counted power-ups in which the player was still closing in on a scared ghost at that moment.',
	learning:
		'Well-timed and caught rates by the power-up\'s number within its block (all conditions together), and by the block\'s position in the session. A rising line means players improve with practice; the counterbalanced order spreads that evenly over the conditions.',
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
	'Each power-up gets the first outcome that applies: caught, late catch, overstayed, timely retreat, early retreat, not engaged. Other and interrupted were added for cases none of these fit.';

export const DESIGN = [
	'Within-subject: each participant plays one 90 s block per condition, in a counterbalanced order (balanced Latin square), so practice does not favour any condition.',
	'Each power-up lasts a random 4 to 8 s, so only the signal can tell how much is left; power dots grow back and lives are unlimited, giving many power-ups per block.',
	'After each block players rate clarity and distraction (1-7); behaviour around the end of every power-up is measured automatically.'
];
