/**
 * Is the database reachable? One shared, reactive answer for the whole app, read from the Convex
 * client's own connection state. The top bar shows it; lists and players that have been loading for
 * a while use `slow()` to say so instead of "Loading..." forever.
 *
 * Convex never errors a query when the socket drops: it just waits. So "offline" is inferred: no
 * open socket (or a write that has hung) for more than a few seconds.
 */
import type { ConvexClient } from 'convex/browser';

/** connecting: first contact. connected. reconnecting: lost it a moment ago. offline: lost for more than `GRACE`. */
export type Conn = 'connecting' | 'connected' | 'reconnecting' | 'offline';

/** Seconds of trouble before saying the database cannot be reached. */
export const GRACE = 5;

const state = $state<{ status: Conn; since: number }>({ status: 'connecting', since: Date.now() });

/** The shared connection state (reactive). */
export const connection = {
	get status() { return state.status; },
	/** When the current status began (ms). */
	get since() { return state.since; },
	get offline() { return state.status === 'offline'; }
};

export const CONN_LABEL: Record<Conn, string> = {
	connecting: 'Connecting',
	connected: 'Connected',
	reconnecting: 'Reconnecting',
	offline: "Can't reach the database"
};

let watching: (() => void) | null = null;

/** Start following the client's connection (call once, from the root layout). Returns a stop function. */
export function watchConnection(client: ConvexClient): () => void {
	if (watching) return watching;
	const started = Date.now();
	let troubleSince: number | null = null;
	function set(s: Conn) {
		if (state.status !== s) { state.status = s; state.since = Date.now(); }
	}
	function check() {
		let cs;
		try { cs = client.connectionState(); } catch { return; }
		const now = Date.now();
		// A request in flight for a long time means the socket is open but nothing comes back.
		const hung = cs.timeOfOldestInflightRequest !== null && now - cs.timeOfOldestInflightRequest.getTime() > GRACE * 1000;
		const ok = cs.isWebSocketConnected && !hung;
		if (ok) { troubleSince = null; set('connected'); return; }
		troubleSince ??= now;
		if (!cs.hasEverConnected) set(now - started > GRACE * 1000 ? 'offline' : 'connecting');
		else set(now - troubleSince > GRACE * 1000 ? 'offline' : 'reconnecting');
	}
	const unsub = client.subscribeToConnectionState(() => check());
	const timer = setInterval(check, 1000);
	check();
	watching = () => { unsub(); clearInterval(timer); watching = null; };
	return watching;
}

/**
 * True once `loading()` has stayed true for `ms`, or at once while the database is unreachable.
 * Call during component setup: `const late = slow(() => q.isLoading)`, then read `late.current`.
 */
export function slow(loading: () => boolean, ms = GRACE * 1000): { readonly current: boolean } {
	let late = $state(false);
	$effect(() => {
		if (!loading()) { late = false; return; }
		const t = setTimeout(() => (late = true), ms);
		return () => clearTimeout(t);
	});
	return { get current() { return loading() && (late || state.status === 'offline'); } };
}
