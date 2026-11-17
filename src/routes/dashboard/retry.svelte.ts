/**
 * Retry for a failed Convex query: drops the subscription for a moment and subscribes again, which
 * asks the server afresh (a failed result is not re-run while it is subscribed). Use `paused` in
 * the query's arguments: `useQuery(fn, () => (r.paused ? 'skip' : args))`.
 */
export function retrier() {
	let paused = $state(false);
	return {
		get paused() {
			return paused;
		},
		retry() {
			paused = true;
			setTimeout(() => (paused = false), 50);
		}
	};
}
