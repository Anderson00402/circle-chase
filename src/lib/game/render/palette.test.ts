import { describe, expect, it } from 'vitest';
import { BASE_COLORS, BOARD_COLORS } from './renderer';
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

/** Plain distance between two #rrggbb colours, 0..441. */
function dist(a: string, b: string): number {
	const p = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
	const [x, y] = [p(a), p(b)];
	return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

describe('the original palette', () => {
	it('is pinned to the first version of the game', () => {
		expect(BASE_COLORS.player).toBe('#ffd84a');
		expect(BASE_COLORS.ghost).toEqual({ hunter: '#ff6f91', ambusher: '#ff8a3d', guard: '#3fe0b0', drifter: '#b9a2ff' });
		expect(BASE_COLORS.scared).toBe('#8fd3ff');
		expect(BASE_COLORS.scaredInk).toBe('#8fd3ff');
		expect(BASE_COLORS.scaredFill).toBe('rgba(143, 211, 255, 0.12)');
		expect(BASE_COLORS.flash).toBe('#ffffff');
		expect(BASE_COLORS.accent).toBe('#ff8a4c');
		expect(BASE_COLORS.line).toBe('#dbe7ff');
		expect(BOARD_COLORS).toEqual({ bg: '#000000', wall: '#1c6cfc', wallGlow: '#1c6cfc', dot: '#b9cdf6', power: '#ffffff' });
	});

	it('is the same on every maze', () => {
		for (const d of MAZE_DEFS) expect(d.theme, d.id).toEqual(BOARD_COLORS);
	});
});

describe('character colours', () => {
	const ghosts = Object.values(BASE_COLORS.ghost);

	it('are vivid and apart from each other', () => {
		for (const g of ghosts) expect(hsl(g)[1]).toBeGreaterThan(0.7);
		for (let i = 0; i < ghosts.length; i++)
			for (let j = i + 1; j < ghosts.length; j++) expect(hueGap(ghosts[i], ghosts[j]), `${ghosts[i]} vs ${ghosts[j]}`).toBeGreaterThan(30);
	});

	// Hue first; the plain distance floor is lower than in the newer palette because the original
	// pairs are closer in brightness (lavender and the scared blue are 65 apart), and scared ghosts
	// differ from awake ones by form too (a dashed outline, not a solid body).
	it('stand apart from the hero, the scared ink and the walls', () => {
		for (const g of ghosts) for (const o of [BASE_COLORS.player, BASE_COLORS.scaredInk, BOARD_COLORS.wall]) {
			expect(hueGap(g, o), `${g} vs ${o}`).toBeGreaterThanOrEqual(20);
			expect(dist(g, o), `${g} vs ${o}`).toBeGreaterThan(60);
		}
	});

	it('stand apart from the white blink', () => {
		for (const g of ghosts) expect(dist(g, BASE_COLORS.flash), g).toBeGreaterThan(80);
	});
});

describe('the scared look', () => {
	it('is a faint see-through fill of its own ink', () => {
		const m = /^rgba\((\d+), (\d+), (\d+), ([\d.]+)\)$/.exec(BASE_COLORS.scaredFill)!;
		expect(+m[4]).toBeLessThan(0.2);
		const ink = parseInt(BASE_COLORS.scaredInk.slice(1), 16);
		expect([+m[1], +m[2], +m[3]]).toEqual([ink >> 16, (ink >> 8) & 255, ink & 255]);
	});

	it('has an ink apart from the walls, the hero and the white blink', () => {
		const ink = BASE_COLORS.scaredInk;
		expect(dist(ink, BOARD_COLORS.wall)).toBeGreaterThan(100);
		expect(dist(ink, BASE_COLORS.player)).toBeGreaterThan(100);
		expect(dist(ink, BASE_COLORS.flash)).toBeGreaterThan(80);
		// Light enough to read on the black floor.
		expect(hsl(ink)[2]).toBeGreaterThan(0.6);
	});
});
