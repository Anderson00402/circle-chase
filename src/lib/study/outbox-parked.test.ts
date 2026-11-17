/**
 * The parked-writes button and panel (outbox-parked.svelte), rendered on the server: nothing while
 * no write is parked; with one, a button that names it as refused (never "on the way") and a panel
 * with what it is, whose, the server's error and the three actions.
 */
import { describe, expect, test } from 'vitest';
import { render } from 'svelte/server';
import OutboxParked from './outbox-parked.svelte';
import { outboxStatus, type ParkedWrite } from './outbox.svelte.ts';

const write: ParkedWrite = {
	id: 'w1', fn: 'trial', what: 'Power-up 3', participant: 'P07', session: 'session-key-123456', cue: 'timer-bar',
	error: 'ArgumentValidationError: extra field', tries: 8, queuedAt: 1, firstErrorAt: 2, parkedAt: 3, lastTryAt: 4
};

describe('OutboxParked', () => {
	test('shows nothing without parked writes', () => {
		outboxStatus.parkedWrites = [];
		expect(render(OutboxParked).body.replace(/<!--.*?-->/g, '').trim()).toBe('');
	});

	test('names a refused write, with its details and the actions', () => {
		outboxStatus.parkedWrites = [write];
		const html = render(OutboxParked).body;
		expect(html).toContain('1 write refused');
		expect(html).not.toMatch(/on the way/i);
		for (const bit of ['Power-up 3', 'P07', 'timer-bar', 'ArgumentValidationError: extra field', 'Try again now', 'Download as JSON', 'Discard']) expect(html).toContain(bit);
		outboxStatus.parkedWrites = [];
	});
});
