/**
 * The conditions for lists and grids, including those whose cue file does not exist yet, so pages
 * always show all thirteen. Registered cues come from CUES; the rest are listed as "in progress".
 */
import { CUES, CUE_IDS } from '#lib/game/cues/index.ts';
import type { Cue, CueId } from '#lib/game/types.ts';

export interface CueListing {
	id: CueId;
	code: string;
	name: string;
	role: Cue['role'];
	tagline: string;
	/** False while the cue file is still being written. */
	ready: boolean;
	cue?: Cue;
}

function codeFor(id: CueId): { code: string; role: Cue['role'] } {
	if (id === 'none') return { code: 'A', role: 'reference' };
	if (id === 'classic-blink') return { code: 'B', role: 'reference' };
	if (id === 'timer-bar') return { code: '0', role: 'baseline' };
	return { code: String(CUE_IDS.indexOf(id) - 2), role: 'idea' };
}

const pretty = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');

export function cueListings(): CueListing[] {
	return CUE_IDS.map((id) => {
		const cue = CUES.find((c) => c.id === id);
		if (cue) return { id, code: cue.code, name: cue.name, role: cue.role, tagline: cue.tagline, ready: true, cue };
		return { id, ...codeFor(id), name: pretty(id), tagline: 'Being built.', ready: false };
	});
}

export const ROLE_LABEL: Record<Cue['role'], string> = {
	reference: 'Reference',
	baseline: 'Baseline',
	idea: 'Idea'
};
