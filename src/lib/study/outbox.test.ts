/**
 * The write outbox with a fake Convex client: nothing is dropped however often a write fails,
 * writes of one lane keep their order while other lanes go on, rows that are not there yet wait
 * without counting as failing, ArrayBuffers survive storage, and queues left by a closed tab are
 * adopted.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ConvexClient } from 'convex/browser';
import { getFunctionName } from 'convex/server';

class MemoryStorage {
	map = new Map<string, string>();
	get length() { return this.map.size; }
	key(i: number) { return [...this.map.keys()][i] ?? null; }
	getItem(k: string) { return this.map.get(k) ?? null; }
	setItem(k: string, v: string) { this.map.set(k, v); }
	removeItem(k: string) { this.map.delete(k); }
}

let store: MemoryStorage;
beforeEach(() => {
	vi.useFakeTimers();
	store = new MemoryStorage();
	const g = globalThis as Record<string, unknown>;
	g.window = { localStorage: store, addEventListener() {}, removeEventListener() {} };
	g.document = { addEventListener() {}, visibilityState: 'visible' };
});
afterEach(() => vi.useRealTimers());

/** A fake client: `answer(name, args)` returns a value or throws. Records the calls in order. */
function fakeClient(answer: (name: string, args: Record<string, unknown>) => unknown) {
	const calls: string[] = [];
	const client = {
		mutation: async (fn: unknown, args: Record<string, unknown>) => {
			const name = getFunctionName(fn as never);
			calls.push(`${name}:${args.key ?? args.blockKey ?? args.sessionKey}`);
			return answer(name, args);
		}
	} as unknown as ConvexClient;
	return { client, calls };
}

const run = async (ms: number) => { await vi.advanceTimersByTimeAsync(ms); };

describe('outbox', () => {
	test('keeps retrying a failing write (never drops it) and shows it as failing', async () => {
		const { createOutbox, outboxStatus } = await import('./outbox.svelte.ts');
		let fail = true;
		const { client, calls } = fakeClient(() => { if (fail) throw new Error('server error'); return 'ok'; });
		const box = createOutbox(client);
		box.send('blockEnd', { key: 'b1', deaths: 0, score: 0 });
		await run(10 * 60_000);
		// Back-off up to PARK_AFTER rejections, then every 5 minutes: it is never given up.
		expect(calls.length).toBeGreaterThan(8);
		expect(box.count()).toBe(1);
		expect(outboxStatus.state).toBe('failing');
		expect(outboxStatus.failingCount).toBe(1);
		expect(outboxStatus.lastError).toContain('server error');
		// The server kept rejecting it: parked, still stored and still tried, every 5 minutes.
		expect(outboxStatus.parked).toBe(1);
		expect(outboxStatus.parkedErrors[0]).toEqual({ fn: 'blockEnd', error: 'server error' });
		fail = false;
		await run(5 * 60_000 + 1000);
		expect(box.count()).toBe(0);
		expect(outboxStatus.parked).toBe(0);
		expect(outboxStatus.state).toBe('saved');
	});

	test('a lane goes in order; a stuck lane does not hold the others', async () => {
		const { createOutbox } = await import('./outbox.svelte.ts');
		const { client, calls } = fakeClient((name, args) => {
			if (name === 'sessions:start' && args.key === 'A') throw new Error('down');
			return 'ok';
		});
		const box = createOutbox(client);
		box.send('sessionStart', { key: 'A' }, { lane: 'A' });
		box.send('trial', { key: 'A1', sessionKey: 'A' }, { lane: 'A' });
		box.send('sessionStart', { key: 'B' }, { lane: 'B' });
		box.send('trial', { key: 'B1', sessionKey: 'B' }, { lane: 'B' });
		await run(5000);
		expect(calls).toContain('trials:save:B1');
		expect(calls).not.toContain('trials:save:A1');
		expect(box.count()).toBe(2);
	});

	test('a write the server keeps rejecting is parked, and the later writes of its lane go on', async () => {
		const { createOutbox, outboxStatus, PARK_AFTER } = await import('./outbox.svelte.ts');
		let reject = true;
		const { client, calls } = fakeClient((name, args) => {
			if (name === 'trials:save' && args.key === 'bad' && reject) throw new Error('ArgumentValidationError: extra field');
			return 'ok';
		});
		const box = createOutbox(client);
		box.send('trial', { key: 'bad', sessionKey: 'S' }, { lane: 'S' });
		box.send('trial', { key: 'next', sessionKey: 'S' }, { lane: 'S' });
		box.send('blockEnd', { key: 'b', sessionKey: 'S', deaths: 0, score: 0 }, { lane: 'S' });
		// While it is retried with back-off it holds its lane: order is kept.
		await run(10_000);
		expect(calls).not.toContain('trials:save:next');
		// After PARK_AFTER rejections (about a minute and a half) it is set aside.
		await run(3 * 60_000);
		expect(calls.filter((c) => c === 'trials:save:bad').length).toBe(PARK_AFTER);
		expect(calls).toContain('trials:save:next');
		expect(calls).toContain('blocks:end:b');
		expect(box.count()).toBe(1);
		expect(outboxStatus.parked).toBe(1);
		expect(outboxStatus.state).toBe('failing');
		expect(outboxStatus.failingCount).toBe(1);
		expect(outboxStatus.lastError).toContain('ArgumentValidationError');
		// Kept and tried again every 5 minutes; once the server takes it, it is gone.
		reject = false;
		await run(5 * 60_000);
		expect(box.count()).toBe(0);
		expect(outboxStatus.state).toBe('saved');
	});

	test('a note whose row is not there yet waits, without counting as failing or pending', async () => {
		const { createOutbox, outboxStatus } = await import('./outbox.svelte.ts');
		let there = false;
		const { client } = fakeClient(() => (there ? 'id' : null));
		const box = createOutbox(client);
		let done = false;
		box.send('setup', { sessionKey: 'S', run: {} }, { id: 'setup:S', onDone: () => (done = true) });
		await run(60_000);
		expect(box.count()).toBe(1);
		expect(outboxStatus.state).toBe('saved');
		expect(outboxStatus.waiting).toBe(1);
		there = true;
		await run(20_000);
		expect(done).toBe(true);
		expect(box.count()).toBe(0);
	});

	test('adopts the queue of a closed tab (with its bytes) and the older formats', async () => {
		const { createOutbox, encodeJobs } = await import('./outbox.svelte.ts');
		const bytes = new Uint8Array([1, 2, 250]).buffer;
		store.setItem('cc.outbox.gone', encodeJobs({ at: Date.now() - 60_000, jobs: [{ id: 'x', fn: 'trial', args: { key: 'T1', sessionKey: 'S', series: bytes }, lane: 'S', tries: 7 }] }));
		store.setItem('cc.outbox.alive', encodeJobs({ at: Date.now(), jobs: [{ id: 'y', fn: 'trial', args: { key: 'T2' }, tries: 0 }] }));
		store.setItem('cc.queue.old', encodeJobs([{ fn: 'blockEnd', args: { key: 'B9', deaths: 0, score: 0 }, tries: 2 }]));
		store.setItem('cc.run.outbox', JSON.stringify([{ id: 'pauses:B9', fn: 'markBlock', args: { blockKey: 'B9', pauses: 1 }, tries: 0 }]));
		const seen: Record<string, unknown>[] = [];
		const { client, calls } = fakeClient((_n, args) => { seen.push(args); return 'ok'; });
		createOutbox(client);
		await run(1000);
		expect(calls).toEqual(expect.arrayContaining(['trials:save:T1', 'blocks:end:B9', 'runs:markBlock:B9']));
		expect(calls).not.toContain('trials:save:T2'); // its tab is still alive
		const t1 = seen.find((a) => a.key === 'T1')!;
		expect(new Uint8Array(t1.series as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 250]));
		expect(store.getItem('cc.queue.old')).toBeNull();
		expect(store.getItem('cc.run.outbox')).toBeNull();
		// Once the other tab goes quiet, its queue is adopted too.
		await run(20_000);
		expect(calls).toContain('trials:save:T2');
	});

	test('back-off doubles from half a second and stops growing at 30 s', async () => {
		const { backoff } = await import('./outbox.svelte.ts');
		expect(backoff(1)).toBeGreaterThan(400);
		expect(backoff(1)).toBeLessThan(600);
		expect(backoff(4)).toBeGreaterThan(3000);
		expect(backoff(50)).toBeLessThanOrEqual(34_500);
	});
});

describe('inputLabel', () => {
	test('says when input came from automation', async () => {
		const { inputLabel } = await import('../telemetry/client.svelte.ts');
		expect(inputLabel(new Set(), false)).toBe('none');
		expect(inputLabel(new Set(['keyboard']), false)).toBe('keyboard');
		expect(inputLabel(new Set(['keyboard', 'touch']), false)).toBe('mixed');
		expect(inputLabel(new Set(), true)).toBe('automated');
		expect(inputLabel(new Set(['keyboard']), true)).toBe('automated-keyboard');
	});
});
