import { describe, expect, test } from 'vitest';
import { mergeProgress, readLocal, writeLocal } from './resume';

/** A minimal Storage in memory. */
function memory(): Storage {
	const m = new Map<string, string>();
	return {
		get length() { return m.size; },
		key: (i: number) => [...m.keys()][i] ?? null,
		getItem: (k: string) => m.get(k) ?? null,
		setItem: (k: string, v: string) => { m.set(k, String(v)); },
		removeItem: (k: string) => { m.delete(k); },
		clear: () => m.clear()
	};
}

describe('resuming a run after a refresh', () => {
	test('a new block starts from zero', () => {
		expect(readLocal('new', memory())).toEqual({ next: 0, measured: 0, decisions: 0 });
		expect(mergeProgress(readLocal('new', memory()), null)).toEqual({ next: 0, measured: 0, decisions: 0 });
	});

	test('the local record carries on the trial index and the run-length count', () => {
		const store = memory();
		// Ten power-ups measured before the refresh, three of them decisions.
		writeLocal('b', { next: 10, measured: 10, decisions: 3 }, store);
		const local = readLocal('b', store);
		expect(local).toEqual({ next: 10, measured: 10, decisions: 3 });
		// The server has only 8 so far (the last two are still in the closed page's queue): local wins.
		expect(mergeProgress(local, { trials: 8, nextIndex: 8, decisions: 2 })).toEqual({ next: 10, measured: 10, decisions: 3 });
	});

	test('the server covers a lost local record', () => {
		expect(mergeProgress(readLocal('b', memory()), { trials: 10, nextIndex: 10, decisions: 4 })).toEqual({ next: 10, measured: 10, decisions: 4 });
		// Indices with a gap: the next one is past the largest stored.
		expect(mergeProgress({ next: 0, measured: 0, decisions: 0 }, { trials: 5, nextIndex: 7, decisions: 1 }).next).toBe(7);
	});

	test('a run of 16 refreshed after 10 has 6 to go', () => {
		const p = mergeProgress({ next: 10, measured: 10, decisions: 3 }, { trials: 10, nextIndex: 10, decisions: 3 });
		expect(16 - p.measured).toBe(6);
	});

	test('broken records read as zeros; old records are cleaned up', () => {
		const store = memory();
		store.setItem('cc.tel.block.x', '{not json');
		expect(readLocal('x', store)).toEqual({ next: 0, measured: 0, decisions: 0 });
		store.setItem('cc.tel.block.y', JSON.stringify({ next: -3, measured: 'a', decisions: 2.7 }));
		expect(readLocal('y', store)).toEqual({ next: 0, measured: 0, decisions: 2 });
		writeLocal('old', { next: 1, measured: 1, decisions: 0 }, store, 0);
		writeLocal('now', { next: 1, measured: 1, decisions: 0 }, store, 3 * 24 * 3600_000);
		expect(store.getItem('cc.tel.block.old')).toBeNull();
		expect(store.getItem('cc.tel.block.now')).not.toBeNull();
	});
});
