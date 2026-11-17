import { clamp, TAU } from './util';
import { BONUS_ITEMS, bonusItem } from '../engine/levels';

/**
 * Bonus items, all original: a gem, a mushroom, an acorn, a paper lantern, a pinwheel, a teacup,
 * a kite and a little rocket. Drawn as plain line art so they stay crisp at any size, from HUD
 * icons to the board. Names, points and order live in one list, `BONUS_ITEMS` in `engine/levels.ts`;
 * `kind` there is the drawing here.
 */
export const BONUS_NAMES: readonly string[] = [...BONUS_ITEMS].sort((a, b) => a.kind - b.kind).map((b) => b.name);
export const bonusName = (kind: number) => bonusItem(((kind % 8) + 8) % 8).name;

/** Line colour of the bonus marks: the original's pale drafting line, with the accent for one detail. */
export const BONUS_LINE = '#dbe7ff';
export const BONUS_ACCENT = '#ff8a4c';

/**
 * Draws bonus item `kind` centred at (cx, cy), fitting a box `size` CSS pixels wide. Spare line art
 * in the drafting style of the board: pale outlines, one accent detail, no fills, one distinct
 * silhouette per kind.
 */
export function drawBonus(c: CanvasRenderingContext2D, kind: number, cx: number, cy: number, size: number, time = 0) {
	const k = ((kind % 8) + 8) % 8, u = size / 2;
	c.save();
	c.translate(cx, cy);
	c.scale(u, u);
	c.lineJoin = 'round';
	c.lineCap = 'round';
	const lw = Math.max(0.1, 1.2 / u);
	const line = (color = BONUS_LINE, w = lw) => { c.lineWidth = w; c.strokeStyle = color; c.stroke(); };
	const dot = (x: number, y: number, r: number, color = BONUS_ACCENT) => { c.fillStyle = color; c.beginPath(); c.arc(x, y, Math.max(r, 0.9 / u), 0, TAU); c.fill(); };
	c.beginPath();
	switch (k) {
		case 0: { // gem: a cut stone with its facets
			c.moveTo(-0.75, -0.25); c.lineTo(-0.4, -0.7); c.lineTo(0.4, -0.7); c.lineTo(0.75, -0.25); c.lineTo(0, 0.85); c.closePath();
			c.moveTo(-0.75, -0.25); c.lineTo(0.75, -0.25);
			line();
			c.beginPath();
			c.moveTo(-0.3, -0.25); c.lineTo(0, 0.85); c.lineTo(0.3, -0.25);
			line(BONUS_ACCENT, lw * 0.8);
			break;
		}
		case 1: { // mushroom: dome cap on a stem, spots as rings
			c.moveTo(-0.85, 0.05); c.bezierCurveTo(-0.85, -0.95, 0.85, -0.95, 0.85, 0.05); c.closePath();
			c.moveTo(-0.28, 0.05); c.lineTo(-0.28, 0.75); c.quadraticCurveTo(0, 0.85, 0.28, 0.75); c.lineTo(0.28, 0.05);
			line();
			c.beginPath();
			for (const [x, y, r] of [[-0.4, -0.25, 0.13], [0.12, -0.48, 0.14], [0.48, -0.15, 0.1]]) { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); }
			line(BONUS_ACCENT, lw * 0.8);
			break;
		}
		case 2: { // acorn: a nut under a cap, with a stalk
			c.ellipse(0, 0.25, 0.5, 0.58, 0, 0, Math.PI);
			c.moveTo(-0.5, 0.25); c.lineTo(-0.5, 0.0); c.moveTo(0.5, 0.25); c.lineTo(0.5, 0.0);
			c.moveTo(-0.7, 0.0); c.bezierCurveTo(-0.7, -0.7, 0.7, -0.7, 0.7, 0.0); c.closePath();
			line();
			c.beginPath();
			c.moveTo(0, -0.52); c.quadraticCurveTo(0.08, -0.82, 0.3, -0.9);
			c.moveTo(-0.45, -0.22); c.lineTo(0.45, -0.22);
			line(BONUS_ACCENT, lw * 0.8);
			break;
		}
		case 3: { // paper lantern: an oval with ribs, a cap above and below, a flame inside
			c.ellipse(0, 0, 0.6, 0.68, 0, 0, TAU);
			c.moveTo(-0.28, -0.86); c.lineTo(0.28, -0.86); c.moveTo(0, -0.86); c.lineTo(0, -0.68);
			c.moveTo(-0.28, 0.86); c.lineTo(0.28, 0.86); c.moveTo(0, 0.86); c.lineTo(0, 0.68);
			for (const y of [-0.34, 0.34]) { const w = Math.sqrt(1 - (y / 0.68) ** 2) * 0.6; c.moveTo(-w, y); c.lineTo(w, y); }
			line();
			c.beginPath();
			c.moveTo(0, -0.22); c.quadraticCurveTo(0.16, 0.02, 0, 0.18); c.quadraticCurveTo(-0.16, 0.02, 0, -0.22);
			line(BONUS_ACCENT, lw * 0.8);
			break;
		}
		case 4: { // pinwheel on a stick, slowly turning
			c.moveTo(0, 0); c.lineTo(0.15, 0.95);
			line();
			c.save();
			c.rotate(time * 1.5);
			c.beginPath();
			for (let i = 0; i < 4; i++) {
				const a = (i * TAU) / 4, ca = Math.cos(a), sa = Math.sin(a);
				const p = (x: number, y: number): [number, number] => [x * ca - y * sa, x * sa + y * ca];
				c.moveTo(0, 0); c.lineTo(...p(0.72, -0.05)); c.lineTo(...p(0.5, 0.45)); c.closePath();
			}
			line();
			c.restore();
			dot(0, 0, 0.11);
			break;
		}
		case 5: { // teacup with a handle, a saucer and steam
			c.moveTo(-0.7, -0.15); c.lineTo(0.5, -0.15); c.quadraticCurveTo(0.5, 0.65, -0.1, 0.65); c.quadraticCurveTo(-0.7, 0.65, -0.7, -0.15);
			c.moveTo(0.5 + 0.22 * Math.cos(-1.2) + 0.05, 0.15 + 0.22 * Math.sin(-1.2)); c.arc(0.55, 0.15, 0.22, -1.2, 1.4);
			c.moveTo(-0.8, 0.8); c.lineTo(0.6, 0.8);
			line();
			c.beginPath();
			for (const x of [-0.35, 0.05]) { c.moveTo(x, -0.3); c.bezierCurveTo(x - 0.15, -0.5, x + 0.15, -0.65, x, -0.9); }
			line(BONUS_ACCENT, lw * 0.8);
			break;
		}
		case 6: { // diamond kite with its cross spars and a tail
			c.moveTo(0, -0.9); c.lineTo(0.6, -0.15); c.lineTo(0, 0.55); c.lineTo(-0.6, -0.15); c.closePath();
			c.moveTo(0, -0.9); c.lineTo(0, 0.55); c.moveTo(-0.6, -0.15); c.lineTo(0.6, -0.15);
			line();
			c.beginPath();
			c.moveTo(0, 0.55); c.bezierCurveTo(0.3, 0.7, -0.2, 0.85, 0.15, 0.98);
			line(BONUS_ACCENT, lw * 0.8);
			break;
		}
		default: { // rocket: body, porthole, fins and a flickering flame
			c.moveTo(0, -0.9); c.bezierCurveTo(0.42, -0.5, 0.35, 0.2, 0.25, 0.6); c.lineTo(-0.25, 0.6); c.bezierCurveTo(-0.35, 0.2, -0.42, -0.5, 0, -0.9);
			c.moveTo(-0.28, 0.2); c.lineTo(-0.55, 0.65); c.lineTo(-0.25, 0.6);
			c.moveTo(0.28, 0.2); c.lineTo(0.55, 0.65); c.lineTo(0.25, 0.6);
			c.moveTo(0.15, -0.2); c.arc(0, -0.2, 0.15, 0, TAU);
			line();
			const flame = 0.75 + 0.25 * Math.sin(time * 30);
			c.beginPath();
			c.moveTo(-0.14, 0.62); c.lineTo(0, 0.62 + 0.36 * flame); c.lineTo(0.14, 0.62);
			line(BONUS_ACCENT, lw * 0.8);
		}
	}
	c.restore();
}

/**
 * A power dot, the original's white "crosshair": a ring, four ticks reaching out to the tile's
 * edge and a centre dot. `pulse` 0..1 breathes the ring gently (0.5 is its resting size).
 */
export function drawPowerDot(c: CanvasRenderingContext2D, cx: number, cy: number, T: number, color: string, pulse: number) {
	const r = T * 0.27 * (1 + 0.12 * (2 * clamp(pulse) - 1));
	c.save();
	c.strokeStyle = color;
	c.fillStyle = color;
	c.lineWidth = Math.max(1.5, T * 0.07);
	c.beginPath();
	c.arc(cx, cy, r, 0, TAU);
	c.stroke();
	c.beginPath();
	c.moveTo(cx - T * 0.42, cy); c.lineTo(cx - r * 0.45, cy);
	c.moveTo(cx + r * 0.45, cy); c.lineTo(cx + T * 0.42, cy);
	c.moveTo(cx, cy - T * 0.42); c.lineTo(cx, cy - r * 0.45);
	c.moveTo(cx, cy + r * 0.45); c.lineTo(cx, cy + T * 0.42);
	c.lineWidth = Math.max(1, T * 0.04);
	c.stroke();
	c.beginPath();
	c.arc(cx, cy, T * 0.09, 0, TAU);
	c.fill();
	c.restore();
}
