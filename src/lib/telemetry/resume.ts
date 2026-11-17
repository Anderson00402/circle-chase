/**
 * Carrying a run on after a refresh. The run console resumes the block that was being played in
 * the tab, and a new page has to continue its counters: the trial index (no two trials numbered
 * the same in one block), the power-ups measured (the run length counts on) and the decision
 * trials. Two sources, and the larger wins:
 *
 * - this browser's own record (`cc.tel.block.<blockKey>`), written as each trial closes. It knows
 *   about trials still waiting in the closed page's queue, which the outbox only delivers once
 *   that page has been quiet for a while;
 * - the server (`blocks.progress`): what is stored. It covers a lost or cleared local record.
 *
 * Deaths, score and pauses are not carried here: each page sends its own as a segment of the
 * block and the server adds them up (`blocks.end`).
 */

export interface BlockProgress {
	/** The next trial index to use. */
	next: number;
	/** Power-ups measured in the block (trials closed). */
	measured: number;
	/** Decision trials among them. */
	decisions: number;
}

export interface ServerProgress { trials: number; nextIndex: number; decisions: number }

const PREFIX = 'cc.tel.block.';
/** Records older than this are removed (a run is never resumed after that long). */
const KEEP_MS = 2 * 24 * 3600_000;

const ZERO: BlockProgress = { next: 0, measured: 0, decisions: 0 };

function storage(): Storage | null {
	try { return window.localStorage; } catch { return null; }
}

/** This browser's record of a block, or zeros. */
export function readLocal(blockKey: string, store: Storage | null = storage()): BlockProgress {
	try {
		const r = JSON.parse(store?.getItem(PREFIX + blockKey) ?? 'null');
		if (!r || typeof r !== 'object') return { ...ZERO };
		const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
		return { next: n(r.next), measured: n(r.measured), decisions: n(r.decisions) };
	} catch {
		return { ...ZERO };
	}
}

/** Write this browser's record of a block (and drop records of old blocks). */
export function writeLocal(blockKey: string, p: BlockProgress, store: Storage | null = storage(), now = Date.now()) {
	if (!store) return;
	try {
		store.setItem(PREFIX + blockKey, JSON.stringify({ ...p, at: now }));
		for (let i = store.length - 1; i >= 0; i--) {
			const k = store.key(i);
			if (!k?.startsWith(PREFIX) || k === PREFIX + blockKey) continue;
			const at = (() => { try { return JSON.parse(store.getItem(k) ?? '{}').at ?? 0; } catch { return 0; } })();
			if (now - at > KEEP_MS) store.removeItem(k);
		}
	} catch { /* storage full or blocked: the server's count still applies */ }
}

/** The counters to continue from: for each, the larger of the local record and the server's. */
export function mergeProgress(local: BlockProgress, server: ServerProgress | null): BlockProgress {
	if (!server) return { ...local };
	return {
		next: Math.max(local.next, server.nextIndex, server.trials),
		measured: Math.max(local.measured, server.trials),
		decisions: Math.max(local.decisions, server.decisions)
	};
}
