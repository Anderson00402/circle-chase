import { clamp, mix, rgba, TAU } from './util';
import { BONUS_ITEMS, bonusItem } from '../engine/levels';

/**
 * Bonus items, all original: a gem, a mushroom, an acorn, a paper lantern, a pinwheel, a teacup,
 * a kite and a little rocket. Drawn with plain paths so they stay crisp at any size, from HUD icons
 * to the board. Names, points and order live in one list, `BONUS_ITEMS` in `engine/levels.ts`;
 * `kind` there is the drawing here.
 */
export const BONUS_NAMES: readonly string[] = [...BONUS_ITEMS].sort((a, b) => a.kind - b.kind).map((b) => b.name);
export const bonusName = (kind: number) => bonusItem(((kind % 8) + 8) % 8).name;

/** Draws bonus item `kind` centred at (cx, cy), fitting a box `size` CSS pixels wide. */
export function drawBonus(c: CanvasRenderingContext2D, kind: number, cx: number, cy: number, size: number, time = 0) {
	const k = ((kind % 8) + 8) % 8, u = size / 2;
	c.save();
	c.translate(cx, cy);
	c.scale(u, u);
	c.lineJoin = 'round';
	c.lineCap = 'round';
	const outline = (w = 0.09, color = 'rgba(8,10,24,0.85)') => {
		c.lineWidth = Math.max(w, 1.1 / u);
		c.strokeStyle = color;
		c.stroke();
	};
	switch (k) {
		case 0: { // gem: faceted crystal
			c.beginPath();
			c.moveTo(-0.75, -0.25); c.lineTo(-0.4, -0.7); c.lineTo(0.4, -0.7); c.lineTo(0.75, -0.25); c.lineTo(0, 0.85); c.closePath();
			c.fillStyle = '#3ee0ff';
			c.fill();
			outline();
			c.fillStyle = '#b8f6ff';
			c.beginPath();
			c.moveTo(-0.4, -0.7); c.lineTo(-0.1, -0.25); c.lineTo(-0.75, -0.25); c.closePath();
			c.moveTo(0.4, -0.7); c.lineTo(0.75, -0.25); c.lineTo(0.15, -0.25); c.closePath();
			c.fill();
			c.fillStyle = '#1aa3d6';
			c.beginPath();
			c.moveTo(0.15, -0.25); c.lineTo(0.75, -0.25); c.lineTo(0, 0.85); c.closePath();
			c.fill();
			break;
		}
		case 1: { // mushroom: red cap with white spots
			c.beginPath();
			c.roundRect(-0.28, -0.05, 0.56, 0.85, 0.18);
			c.fillStyle = '#f6ead2';
			c.fill();
			outline();
			c.beginPath();
			c.moveTo(-0.85, 0.05);
			c.bezierCurveTo(-0.85, -0.95, 0.85, -0.95, 0.85, 0.05);
			c.closePath();
			c.fillStyle = '#ff4f5e';
			c.fill();
			outline();
			c.fillStyle = '#fff6ea';
			for (const [x, y, r] of [[-0.42, -0.25, 0.15], [0.1, -0.5, 0.17], [0.48, -0.15, 0.12]]) { c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); }
			break;
		}
		case 2: { // acorn
			c.beginPath();
			c.ellipse(0, 0.2, 0.55, 0.65, 0, 0, TAU);
			c.fillStyle = '#d98a3c';
			c.fill();
			outline();
			c.beginPath();
			c.moveTo(-0.72, -0.1);
			c.bezierCurveTo(-0.72, -0.75, 0.72, -0.75, 0.72, -0.1);
			c.quadraticCurveTo(0, 0.05, -0.72, -0.1);
			c.fillStyle = '#7a4a26';
			c.fill();
			outline();
			c.beginPath();
			c.moveTo(0, -0.55); c.quadraticCurveTo(0.1, -0.85, 0.3, -0.9);
			c.lineWidth = 0.14;
			c.strokeStyle = '#7a4a26';
			c.stroke();
			c.fillStyle = 'rgba(255,240,210,0.5)';
			c.beginPath(); c.ellipse(-0.22, 0.2, 0.12, 0.25, 0.3, 0, TAU); c.fill();
			break;
		}
		case 3: { // paper lantern with a warm glow
			const glow = c.createRadialGradient(0, 0.05, 0, 0, 0.05, 1);
			glow.addColorStop(0, 'rgba(255,190,90,0.55)');
			glow.addColorStop(1, 'rgba(255,190,90,0)');
			c.fillStyle = glow;
			c.fillRect(-1, -1, 2, 2);
			c.fillStyle = '#3b2a3a';
			c.fillRect(-0.3, -0.85, 0.6, 0.18);
			c.fillRect(-0.3, 0.68, 0.6, 0.16);
			c.beginPath();
			c.ellipse(0, 0, 0.62, 0.72, 0, 0, TAU);
			c.fillStyle = '#ff7a3d';
			c.fill();
			outline();
			c.strokeStyle = 'rgba(120,30,20,0.6)';
			c.lineWidth = 0.07;
			c.beginPath();
			for (const y of [-0.35, 0, 0.35]) { const w = Math.sqrt(1 - (y / 0.72) ** 2) * 0.62; c.moveTo(-w, y); c.lineTo(w, y); }
			c.stroke();
			c.fillStyle = 'rgba(255,230,160,0.7)';
			c.beginPath(); c.ellipse(0, 0, 0.22, 0.45, 0, 0, TAU); c.fill();
			break;
		}
		case 4: { // pinwheel on a stick, slowly turning
			c.strokeStyle = '#e8e2d0';
			c.lineWidth = 0.12;
			c.beginPath(); c.moveTo(0, 0); c.lineTo(0.15, 0.95); c.stroke();
			c.rotate(time * 1.5);
			const cols = ['#ff4f9a', '#ffd23f', '#3fd0ff', '#7cf05a'];
			for (let i = 0; i < 4; i++) {
				c.save();
				c.rotate((i * TAU) / 4);
				c.beginPath();
				c.moveTo(0, 0); c.lineTo(0.72, -0.05); c.lineTo(0.5, 0.45); c.closePath();
				c.fillStyle = cols[i];
				c.fill();
				outline(0.06);
				c.restore();
			}
			c.fillStyle = '#ffffff';
			c.beginPath(); c.arc(0, 0, 0.12, 0, TAU); c.fill();
			break;
		}
		case 5: { // teacup with steam
			c.beginPath();
			c.moveTo(-0.7, -0.15); c.lineTo(0.5, -0.15); c.quadraticCurveTo(0.5, 0.65, -0.1, 0.65); c.quadraticCurveTo(-0.7, 0.65, -0.7, -0.15);
			c.fillStyle = '#f2f0ff';
			c.fill();
			outline();
			c.beginPath(); c.arc(0.55, 0.15, 0.22, -1.2, 1.4); c.lineWidth = 0.12; c.strokeStyle = '#f2f0ff'; c.stroke();
			c.fillStyle = '#7b6cff';
			c.fillRect(-0.62, 0.12, 1.06, 0.12);
			c.beginPath(); c.ellipse(-0.1, 0.78, 0.75, 0.12, 0, 0, TAU); c.fillStyle = '#c9c4f5'; c.fill();
			c.strokeStyle = 'rgba(255,255,255,0.7)';
			c.lineWidth = 0.08;
			for (const x of [-0.35, 0.05]) {
				c.beginPath();
				c.moveTo(x, -0.3);
				c.bezierCurveTo(x - 0.15, -0.5, x + 0.15, -0.65, x, -0.9);
				c.stroke();
			}
			break;
		}
		case 6: { // diamond kite with a tail
			c.strokeStyle = '#ffffff';
			c.lineWidth = 0.07;
			c.beginPath();
			c.moveTo(0, 0.55);
			c.bezierCurveTo(0.3, 0.7, -0.2, 0.85, 0.15, 0.98);
			c.stroke();
			c.beginPath();
			c.moveTo(0, -0.9); c.lineTo(0.6, -0.15); c.lineTo(0, 0.55); c.lineTo(-0.6, -0.15); c.closePath();
			c.fillStyle = '#ffb02e';
			c.fill();
			outline();
			c.beginPath();
			c.moveTo(0, -0.9); c.lineTo(0.6, -0.15); c.lineTo(0, -0.15); c.closePath();
			c.moveTo(0, 0.55); c.lineTo(-0.6, -0.15); c.lineTo(0, -0.15); c.closePath();
			c.fillStyle = '#ff5a6e';
			c.fill();
			for (const [x, y] of [[0.22, 0.75], [-0.05, 0.88]]) {
				c.fillStyle = '#ff5a6e';
				c.beginPath(); c.moveTo(x, y - 0.08); c.lineTo(x + 0.1, y); c.lineTo(x, y + 0.08); c.lineTo(x - 0.1, y); c.fill();
			}
			break;
		}
		default: { // rocket
			const flame = 0.75 + 0.25 * Math.sin(time * 30);
			c.fillStyle = '#ffb02e';
			c.beginPath(); c.moveTo(-0.18, 0.55); c.lineTo(0, 0.55 + 0.4 * flame); c.lineTo(0.18, 0.55); c.fill();
			c.fillStyle = '#ff4f5e';
			c.beginPath(); c.moveTo(-0.28, 0.2); c.lineTo(-0.55, 0.65); c.lineTo(-0.2, 0.55); c.closePath();
			c.moveTo(0.28, 0.2); c.lineTo(0.55, 0.65); c.lineTo(0.2, 0.55); c.closePath();
			c.fill();
			c.beginPath();
			c.moveTo(0, -0.9);
			c.bezierCurveTo(0.42, -0.5, 0.35, 0.2, 0.25, 0.6);
			c.lineTo(-0.25, 0.6);
			c.bezierCurveTo(-0.35, 0.2, -0.42, -0.5, 0, -0.9);
			c.fillStyle = '#eef1ff';
			c.fill();
			outline();
			c.beginPath(); c.arc(0, -0.2, 0.16, 0, TAU); c.fillStyle = '#3fb7ff'; c.fill(); outline(0.06);
		}
	}
	c.restore();
}

/** A power dot: bright core, soft halo and a thin orbiting ring. `pulse` 0..1. */
export function drawPowerDot(c: CanvasRenderingContext2D, cx: number, cy: number, T: number, color: string, glow: string, pulse: number) {
	const r = T * (0.24 + 0.04 * pulse);
	const halo = c.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.4);
	halo.addColorStop(0, rgba(glow, 0.45));
	halo.addColorStop(1, rgba(glow, 0));
	c.fillStyle = halo;
	c.fillRect(cx - r * 2.4, cy - r * 2.4, r * 4.8, r * 4.8);
	const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.35, 0, cx, cy, r);
	g.addColorStop(0, '#ffffff');
	g.addColorStop(0.6, color);
	g.addColorStop(1, mix(color, glow, 0.6));
	c.fillStyle = g;
	c.beginPath();
	c.arc(cx, cy, r, 0, TAU);
	c.fill();
	if (T >= 14) {
		c.strokeStyle = rgba(glow, 0.35 + 0.3 * clamp(pulse));
		c.lineWidth = Math.max(0.8, T * 0.03);
		c.beginPath();
		c.arc(cx, cy, r * 1.55, 0, TAU);
		c.stroke();
	}
}
