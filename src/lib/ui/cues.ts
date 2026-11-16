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

/**
 * Where each case's signal appears on screen, in plain words, for the console's sublabel. More
 * exact than the cue's channel (the timer bar is a "hud" cue but sits over the top wall).
 */
const WHERE: Partial<Record<CueId, string>> = {
	none: 'nothing shown',
	'classic-blink': 'on the ghosts',
	'timer-bar': 'over the top wall',
	'ink-refill': 'on the ghosts',
	'clock-halos': 'on the ghosts',
	'burning-fuse': 'along the outer wall',
	'wall-tide': 'in the walls',
	heartbeat: 'at the board edges, with sound',
	'waking-ghosts': 'on the ghosts',
	'pen-hourglass': 'in the pen',
	'deflating-player': 'around the player',
	'final-count': 'next to the player',
	'dot-sweep': 'across the whole board'
};
const BY_CHANNEL: Record<Cue['channel'], string> = {
	hud: 'beside the board', ghosts: 'on the ghosts', player: 'on the player', maze: 'in the maze', screen: 'whole screen'
};
export const whereLabel = (c: Pick<Cue, 'id' | 'channel'>): string => WHERE[c.id] ?? BY_CHANNEL[c.channel];
