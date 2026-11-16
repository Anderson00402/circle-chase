/**
 * Where a participant is in the guided study, kept in localStorage so a refresh or an accidental
 * navigation resumes at the same step. Completed rounds are never played again; a round that was
 * left half way is played again from its start with a new block (the old block is marked
 * `abandoned`, its trials stay stored).
 */
import type { CueId } from '../game/types';
import type { StudyLength } from './order';

export type SoundCheck = 'heard' | 'not-heard' | 'muted';
export type Step = 'practice-intro' | 'practice' | 'intro' | 'play' | 'rate' | 'pick' | 'done';

export interface Round {
	cue: CueId;
	/** Key of the block now being (or last) played for this round. */
	blockKey: string;
	/** Seed of the game, different for every block so the sequence of power lengths cannot be learned. */
	seed: number;
	played: boolean;
	rated: boolean;
	/** Earlier blocks of this round that were left unfinished. */
	abandoned: string[];
}

export interface StudyProgress {
	v: 1;
	sessionKey: string;
	source: 'human' | 'bot';
	length: StudyLength;
	number: number;
	numberFrom: 'server' | 'local';
	row: number;
	nickname: string;
	sound: boolean;
	soundCheck: SoundCheck;
	step: Step;
	/** Round being played or rated (0-based). */
	index: number;
	practice: { blockKey: string; seed: number; done: boolean };
	rounds: Round[];
	picks: { clearest: number | null; leastClear: number | null; comment: string };
	startedAt: number;
}

const KEY = 'cc.study.progress';

export function loadProgress(): StudyProgress | null {
	try {
		const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		return p && p.v === 1 ? p : null;
	} catch {
		return null;
	}
}

export function saveProgress(p: StudyProgress | null) {
	try {
		if (p) localStorage.setItem(KEY, JSON.stringify(p));
		else localStorage.removeItem(KEY);
	} catch { /* private mode: the study still works, it just cannot resume */ }
}

export function uid(): string {
	try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

export const newSeed = () => (Math.random() * 2 ** 31) | 0;
