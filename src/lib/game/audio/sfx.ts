import type { Frame, Sfx, ToneOptions } from '../types';

/** All sound is synthesized here. Nothing plays until `wake()` is called from a click or key press. */
export interface SoundBoard extends Sfx {
	/** Call from a user gesture; browsers only allow sound to start from one. */
	wake(): void;
	setEnabled(on: boolean): void;
	readonly enabled: boolean;
	/** Plays the stock sounds for a frame's events (dots, power, eat, death...). */
	play(frame: Frame): void;
}

export function createSfx(): SoundBoard {
	let ac: AudioContext | null = null, enabled = true, streak = 0, lastDot = 0;

	function wake() {
		if (!ac) { try { ac = new AudioContext(); } catch { ac = null; } }
		if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
	}

	function tone(freq: number, dur: number, { type = 'triangle', vol = 0.06, to = 0, delay = 0 }: ToneOptions = {}) {
		if (!ac || !enabled) return;
		const t0 = ac.currentTime + delay, osc = ac.createOscillator(), gain = ac.createGain();
		osc.type = type;
		osc.frequency.setValueAtTime(freq, t0);
		if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
		gain.gain.setValueAtTime(0.0001, t0);
		gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
		osc.connect(gain).connect(ac.destination);
		osc.start(t0);
		osc.stop(t0 + dur + 0.03);
	}

	function noise(dur: number, { vol = 0.05, freq = 800, q = 1, delay = 0 } = {}) {
		if (!ac || !enabled) return;
		const t0 = ac.currentTime + delay, len = Math.max(1, Math.floor(ac.sampleRate * dur));
		const buf = ac.createBuffer(1, len, ac.sampleRate), data = buf.getChannelData(0);
		for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
		const src = ac.createBufferSource(), filter = ac.createBiquadFilter(), gain = ac.createGain();
		src.buffer = buf;
		filter.type = 'bandpass';
		filter.frequency.value = freq;
		filter.Q.value = q;
		gain.gain.setValueAtTime(vol, t0);
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
		src.connect(filter).connect(gain).connect(ac.destination);
		src.start(t0);
	}

	const arp = (notes: number[], gap: number, vol = 0.05) => notes.forEach((f, i) => tone(f, 0.15, { delay: i * gap, vol }));

	function play(frame: Frame) {
		for (const e of frame.events) {
			switch (e.type) {
				case 'dot': {
					const now = performance.now();
					streak = now - lastDot < 400 ? Math.min(streak + 1, 24) : 0;
					lastDot = now;
					tone(660 * 2 ** (streak / 24), 0.05, { vol: 0.035 });
					break;
				}
				case 'power': tone(220, 0.35, { type: 'sawtooth', vol: 0.04, to: 880 }); break;
				case 'eat': {
					const f = 440 * (e.points / 200) ** 0.25;
					tone(f, 0.08, { type: 'square', vol: 0.04 });
					tone(f * 1.5, 0.12, { type: 'square', vol: 0.04, delay: 0.08 });
					break;
				}
				case 'die': tone(520, 0.9, { type: 'sawtooth', vol: 0.05, to: 60 }); break;
				case 'clear': arp([392, 523.25, 659.25, 783.99, 1046.5], 0.09); break;
				case 'extra': arp([784, 988, 1175, 1568], 0.07); break;
				case 'bonus': arp([880, 1318.5], 0.07); break;
			}
		}
	}

	return {
		wake, tone, noise, play,
		setEnabled(on) { enabled = on; },
		get enabled() { return enabled; }
	};
}
