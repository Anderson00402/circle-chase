import { error } from '@sveltejs/kit';
import { CUES } from '#lib/game/cues/index.ts';

/** An unknown case id gets the styled not-found page (not a silent jump back to the console). */
export function load({ params }: { params: { cue?: string } }) {
	if (!CUES.some((c) => c.id === params.cue)) error(404, `There is no case called "${params.cue}".`);
	return {};
}
