import type { Cue } from '../types';

/** Idea 0, the baseline every other cue is compared against: a draining bar over the top wall. */
export const timerBar: Cue = {
	id: 'timer-bar',
	index: 0,
	name: 'Timer bar',
	tagline: 'A bar over the top wall drains as the power runs out.',
	description:
		'A bar across the top wall starts full and drains to the left with the power, with the seconds left written on it. It blinks white with the ghosts in the last 2 seconds.',
	channel: 'hud',
	baseFlash: true,

	over(k) {
		const { ctx, T, maze: m, power, colors } = k;
		if (!power.active || k.frame.phase !== 'playing') return;
		const bx = T, bw = (m.W - 2) * T, by = T * 0.27, bh = T * 0.46;
		ctx.fillStyle = colors.bg;
		ctx.fillRect(bx, by, bw, bh);
		ctx.fillStyle = k.baseFlash() ? '#ffffff' : colors.scared;
		ctx.fillRect(bx, by, bw * power.frac, bh);
		ctx.strokeStyle = colors.ink;
		ctx.lineWidth = 1;
		ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = `600 ${Math.max(10, Math.round(T * 0.4))}px "Atkinson Hyperlegible Mono", ui-monospace, Menlo, monospace`;
		ctx.lineWidth = 3;
		ctx.strokeStyle = colors.bg;
		const label = `${power.left.toFixed(1)}s`;
		ctx.strokeText(label, bx + bw / 2, by + bh / 2 + 1);
		ctx.fillStyle = colors.ink;
		ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
	}
};
