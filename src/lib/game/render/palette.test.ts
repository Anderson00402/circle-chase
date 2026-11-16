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
		const others = [BASE_COLORS.player, BASE_COLORS.scaredFill, ...MAZE_DEFS.map((d) => d.theme.wall).filter((c) => hsl(c)[1] > 0.4)];
		for (const g of ghosts) for (const o of others) expect(hueGap(g, o), `${g} vs ${o}`).toBeGreaterThanOrEqual(20);
		// The white blink: no ghost is anywhere near white.
		for (const g of ghosts) expect(hsl(g)[2]).toBeLessThan(0.75);
	});
});
