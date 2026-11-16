import { describe, expect, test } from 'vitest';
import { leftAt, previewClip } from './preview-scenes';

describe('preview clip', () => {
	test('shows a full power-up that runs out with scared ghosts still out', () => {
		const c = previewClip();
		expect(c.scenes.length).toBeGreaterThan(200);
		expect(c.scaredAtEnd).toBeGreaterThanOrEqual(2);
		expect(c.scenes[c.endIndex].frame.power.endReason).toBe('expired');
		expect(c.scenes[c.startIndex].frame.power.left).toBeGreaterThan(5.5);
		expect(leftAt(c, c.startIndex)).toBeGreaterThan(5.5);
		expect(leftAt(c, c.endIndex)).toBeLessThanOrEqual(0);
		expect(leftAt(c, c.scenes.length - 1)).toBeLessThan(-2);
		expect(Math.abs(leftAt(c, c.stillIndex) - 1.5)).toBeLessThan(0.2);
	});
	test('is deterministic', () => {
		const a = previewClip();
		expect(a).toBe(previewClip());
	});
});
