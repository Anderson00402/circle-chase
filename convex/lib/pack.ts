/**
 * Tiny binary packing shared by the browser (clips, series) and Convex functions (decoding a
 * trial's series). Integers only: callers quantize first. Columns are delta encoded and written
 * as zigzag varints, so a value that does not change costs one byte and slow changes cost one or
 * two. No dependencies, no compression library.
 */

export class Writer {
	private buf = new Uint8Array(1024);
	private n = 0;

	private room(k: number) {
		if (this.n + k <= this.buf.length) return;
		let size = this.buf.length * 2;
		while (size < this.n + k) size *= 2;
		const next = new Uint8Array(size);
		next.set(this.buf.subarray(0, this.n));
		this.buf = next;
	}

	/** Signed integer as a zigzag varint. Safe up to +-2^52. */
	int(v: number) {
		v = Math.round(v);
		let z = v >= 0 ? v * 2 : -v * 2 - 1;
		this.room(8);
		while (z >= 0x80) {
			this.buf[this.n++] = (z % 0x80) | 0x80;
			z = Math.floor(z / 0x80);
		}
		this.buf[this.n++] = z;
	}

	/** A column of integers, delta encoded. */
	column(values: ArrayLike<number>) {
		let prev = 0;
		for (let i = 0; i < values.length; i++) {
			this.int(values[i] - prev);
			prev = values[i];
		}
	}

	bytes(b: Uint8Array) {
		this.int(b.length);
		this.room(b.length);
		this.buf.set(b, this.n);
		this.n += b.length;
	}

	text(s: string) {
		this.bytes(new TextEncoder().encode(s));
	}

	/** The packed bytes as a standalone ArrayBuffer (what Convex `v.bytes()` stores). */
	finish(): ArrayBuffer {
		return this.buf.slice(0, this.n).buffer;
	}
}

export class Reader {
	private b: Uint8Array;
	private i = 0;
	constructor(data: ArrayBuffer | Uint8Array) {
		this.b = data instanceof Uint8Array ? data : new Uint8Array(data);
	}

	int(): number {
		let z = 0, mul = 1, byte: number;
		do {
			if (this.i >= this.b.length) throw new Error('packed data ends early');
			byte = this.b[this.i++];
			z += (byte & 0x7f) * mul;
			mul *= 0x80;
		} while (byte & 0x80);
		return z % 2 === 0 ? z / 2 : -(z + 1) / 2;
	}

	column(n: number): number[] {
		const out = new Array<number>(n);
		let prev = 0;
		for (let k = 0; k < n; k++) out[k] = prev += this.int();
		return out;
	}

	bytes(): Uint8Array {
		const n = this.int();
		const out = this.b.slice(this.i, this.i + n);
		this.i += n;
		return out;
	}

	text(): string {
		return new TextDecoder().decode(this.bytes());
	}
}
