/**
 * The current participant on this researcher's machine, shared by the run console (/) and the play
 * page (/play/[cue]). Kept in localStorage so it survives reloads until the researcher changes it.
 *
 * - Each participant label ("P07") gets its own anonymous participant id and one session; every run
 *   of a case is a block of that session, numbered in the order it was played.
 * - The participant's run number (from Convex: console participants only, 1, 2, 3... per source) picks a row of the balanced Latin square: the suggested
 *   order of cases. It is a hint; the researcher may play any case.
 */
import type { ConvexClient } from 'convex/browser';
import { api } from '#convex/_generated/api.js';
import { CUES, cueById } from '../game/cues/index';
import type { Cue, CueId } from '../game/types';
import { detectSource, type Mode, type Source } from '../telemetry/client.svelte.ts';
import { caseOrder } from './order';
import { getOutbox } from './outbox.svelte.ts';

export interface RunRecord {
	blockKey: string;
	cue: CueId;
	mode: Mode;
	orderIndex: number;
	startedAt: number;
}

export interface Participant {
	v: 2;
	label: string;
	pid: string;
	source: Source;
	sessionKey: string;
	/** From participants.ensure; null until Convex has answered. */
	number: number | null;
	row: number | null;
	order: CueId[];
	runs: RunRecord[];
	createdAt: number;
}

const KEY = 'cc.run.participant';
const SETTINGS = 'cc.run.settings';

export function uid(): string {
	try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
}

function fresh(label = ''): Participant {
	const source = detectSource();
	return {
		v: 2, label, pid: (source === 'bot' ? 'bot-' : 'run-') + uid(), source, sessionKey: uid(), number: null, row: null,
		order: [], runs: [], createdAt: Date.now()
	};
}

function read(): Participant {
	try {
		const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		if (p && p.v === 2) return p;
	} catch { /* ignore */ }
	return fresh();
}

/** `participantView` is no longer read: participant view is on whenever a run starts. */
export interface Settings { rules: Mode; selected: CueId; participantView: boolean }
function readSettings(): Settings {
	const d: Settings = { rules: 'study', selected: 'timer-bar', participantView: true };
	try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') }; } catch { return d; }
}

/** Reactive state of the current participant and the console settings. */
export const run = $state<{ p: Participant; settings: Settings }>({ p: read(), settings: readSettings() });

export function persist() {
	try {
		localStorage.setItem(KEY, JSON.stringify($state.snapshot(run.p)));
		localStorage.setItem(SETTINGS, JSON.stringify($state.snapshot(run.settings)));
	} catch { /* private mode: still works for this page */ }
}

/** Re-read from storage (another tab or the play page may have changed it). */
export function reload() {
	run.p = read();
	run.settings = readSettings();
}

function deviceInfo() {
	return {
		userAgent: navigator.userAgent.slice(0, 300),
		platform: (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? '',
		language: navigator.language ?? '',
		touch: (navigator.maxTouchPoints ?? 0) > 0,
		screenW: screen.width, screenH: screen.height, dpr: window.devicePixelRatio || 1
	};
}

let ensuring: Promise<void> | null = null;
/**
 * Make sure the participant exists in Convex and has a number (and so a suggested order). Called
 * once a label is entered or a run starts, never just by opening the console, so idle visits do
 * not use up participant numbers (and rows of the counterbalancing table). Safe to call often;
 * quiet when Convex cannot be reached.
 */
export function ensureParticipant(client: ConvexClient): Promise<void> {
	if (run.p.number !== null && ensuring === null) return Promise.resolve();
	if (ensuring) return ensuring;
	const p = run.p;
	ensuring = (async () => {
		try {
			const r = await client.mutation(api.participants.ensure, {
				pid: p.pid, source: p.source, device: deviceInfo(), console: true, ...(p.label ? { nickname: p.label } : {})
			});
			if (run.p.pid !== p.pid) return; // a new participant was started meanwhile
			// Console participants are numbered on their own (1, 2, 3... per source), so the counterbalanced
			// order is not skewed by bots or play pages opened without a run.
			const number = r.runNumber ?? r.number;
			const o = caseOrder(number, CUES.map((c) => c.id));
			run.p.number = number;
			run.p.row = o.row;
			run.p.order = o.cues;
			if (!run.p.label) {
				// No label typed: name the participant after their number, on the row too.
				run.p.label = `P${String(number).padStart(2, '0')}`;
				client.mutation(api.participants.ensure, { pid: p.pid, source: p.source, device: deviceInfo(), console: true, nickname: run.p.label }).catch(() => {});
			}
			persist();
			queueSetup(client);
		} catch { /* offline: try again on the next call */ } finally {
			ensuring = null;
		}
	})();
	return ensuring;
}

/** Store the label and the order on the session (waits until the first run has opened it). */
export function queueSetup(client: ConvexClient) {
	const p = run.p;
	if (p.number === null || p.row === null) return;
	getOutbox(client).send('setup', {
		sessionKey: p.sessionKey, run: { participantLabel: p.label, participantNumber: p.number, orderRow: p.row }
	}, `setup:${p.sessionKey}`);
}

/**
 * Change the label. Before any run it only renames; after runs it starts a new participant (new
 * id, new session), since a different label means a different person.
 */
export function setLabel(client: ConvexClient, label: string) {
	const clean = label.trim().slice(0, 24);
	if (clean === run.p.label) return;
	if (run.p.runs.length === 0) {
		run.p.label = clean;
		persist();
		if (run.p.number !== null) {
			// Update the nickname on the participant row and the session's run info.
			ensuring = null;
			client.mutation(api.participants.ensure, { pid: run.p.pid, source: run.p.source, device: deviceInfo(), console: true, ...(clean ? { nickname: clean } : {}) }).catch(() => {});
			queueSetup(client);
		} else ensureParticipant(client);
	} else newParticipant(client, clean);
}

export function newParticipant(client: ConvexClient, label = '') {
	run.p = fresh(label.trim().slice(0, 24));
	persist();
	if (run.p.label) ensureParticipant(client);
}

/** Ensure only when there is something to ensure for (a label or a run). */
export function ensureIfNamed(client: ConvexClient) {
	if (run.p.label || run.p.runs.length) return ensureParticipant(client);
}

/** Note a run once its first frame has been played (so opened-and-left pages leave no record). */
export function recordRun(r: RunRecord) {
	if (run.p.runs.some((x) => x.blockKey === r.blockKey)) return;
	run.p.runs.push(r);
	persist();
}

/** Next case of the suggested order that has not been played yet (null without a number, or when all are done). */
export function suggestedNext(played: Iterable<string> = run.p.runs.map((r) => r.cue)): Cue | null {
	const done = new Set(played);
	const id = run.p.order.find((c) => !done.has(c) && CUES.some((x) => x.id === c));
	return id ? cueById(id) : null;
}

/** Next index for a run in this session. */
export const nextOrderIndex = () => run.p.runs.reduce((n, r) => Math.max(n, r.orderIndex + 1), 0);

/** Play page link for a case under the current rules. */
export const playHref = (cue: string, rules: Mode = run.settings.rules) => `/play/${cue}${rules === 'arcade' ? '?rules=arcade' : ''}`;

/** The end-of-run summary of a run: its own address, so Back and refresh find it again. */
export const summaryHref = (cue: string, blockKey: string, rules: Mode | string = 'study') =>
	`/play/${cue}?${rules === 'arcade' ? 'rules=arcade&' : ''}done=${encodeURIComponent(blockKey)}`;

/**
 * The run being played in this tab, kept in sessionStorage while it runs. A refresh finds it and
 * carries on in the same run (same block) instead of starting a second one; leaving the page in the
 * app or ending the run clears it.
 */
export interface ActiveRun { blockKey: string; cue: string; rules: Mode; orderIndex: number }
const ACTIVE = 'cc.run.active';
export function activeRun(): ActiveRun | null {
	try { return JSON.parse(sessionStorage.getItem(ACTIVE) ?? 'null'); } catch { return null; }
}
export function setActiveRun(a: ActiveRun | null) {
	try {
		if (a) sessionStorage.setItem(ACTIVE, JSON.stringify(a));
		else sessionStorage.removeItem(ACTIVE);
	} catch { /* storage blocked: a refresh then starts a new run */ }
}

/** What this page measured in a run that just ended, for the summary until Convex has the rows. */
export const endedLocally = new Map<string, import('../telemetry/client.svelte.ts').RecentTrial[]>();
