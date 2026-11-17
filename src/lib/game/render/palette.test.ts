import { describe, expect, it } from 'vitest';
import { BASE_COLORS } from './renderer';
import { MAZE_DEFS } from '../engine/mazes';

/** Hue (degrees), saturation and lightness (0..1) of a #rrggbb colour. */
function hsl(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, l = (max + min) / 2;
	const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
	let h = 0;
	if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	return [(h * 60 + 360) % 360, s, l];
}
const hueGap = (a: string, b: string) => { const d = Math.abs(hsl(a)[0] - hsl(b)[0]); return Math.min(d, 360 - d); };

describe('character colours', () => {
	const ghosts = Object.values(BASE_COLORS.ghost);

	it('are not the classic red, pink, cyan and orange', () => {
		for (const classic of ['#ff0000', '#ffb8ff', '#00ffff', '#ffb852']) {
			const near = ghosts.filter((g) => hueGap(g, classic) < 12);
			expect(near, `${classic} vs ${ghosts}`).toEqual([]);
		}
	});

	it('are vivid and far apart from each other', () => {
		for (const g of ghosts) expect(hsl(g)[1]).toBeGreaterThan(0.7);
		for (let i = 0; i < ghosts.length; i++)
			for (let j = i + 1; j < ghosts.length; j++) expect(hueGap(ghosts[i], ghosts[j])).toBeGreaterThan(40);
	});

	it('stand apart from the hero, the scared look and every maze colour', () => {
		const others = [BASE_COLORS.player, ...MAZE_DEFS.map((d) => d.theme.wall).filter((c) => hsl(c)[1] > 0.4)];
		for (const g of ghosts) for (const o of others) expect(hueGap(g, o), `${g} vs ${o}`).toBeGreaterThanOrEqual(20);
		// The white blink: no ghost is anywhere near white.
		for (const g of ghosts) expect(hsl(g)[2]).toBeLessThan(0.75);
	});
});

/** Plain distance between two #rrggbb colours, 0..441. */
function dist(a: string, b: string): number {
	const p = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
	const [x, y] = [p(a), p(b)];
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

describe('the drained scared look', () => {
	const { scaredFill, scared, scaredInk, flash, flashInk, player } = BASE_COLORS;
	const ghosts = Object.values(BASE_COLORS.ghost);

	it('is pale and colourless, not blue', () => {
		for (const c of [scaredFill, scared]) {
			expect(hsl(c)[1], c).toBeLessThan(0.15);
			expect(hsl(c)[2], c).toBeGreaterThan(0.6);
		}
		// The classic blue scared body is gone for good.
		expect(dist(scaredFill, '#2121ff')).toBeGreaterThan(200);
		expect(dist(scaredFill, '#3d4fe6')).toBeGreaterThan(150);
	});

	it('stands apart from every awake wisp and the hero', () => {
		for (const c of [...ghosts, player]) {
			expect(hsl(c)[1] - hsl(scaredFill)[1], c).toBeGreaterThan(0.55);
			expect(dist(c, scaredFill), c).toBeGreaterThan(100);
		}
	});

	it('stands apart from the white blink: a clearly darker body and dark ink instead of red', () => {
		expect(hsl(flash)[2] - hsl(scaredFill)[2]).toBeGreaterThan(0.18);
		expect(hsl(flashInk)[1]).toBeGreaterThan(0.7);
		expect(hsl(scaredInk)[1]).toBeLessThan(0.25);
		expect(hsl(scaredInk)[2]).toBeLessThan(0.25);
	});

	it('reads on every maze: lighter than each floor by a wide margin, unlike any saturated wall', () => {
		for (const d of MAZE_DEFS) {
			expect(hsl(scaredFill)[2] - hsl(d.theme.bg)[2], d.id).toBeGreaterThan(0.6);
			if (hsl(d.theme.wall)[1] > 0.4) expect(dist(d.theme.wall, scaredFill), d.id).toBeGreaterThan(100);
		}
	});
});
