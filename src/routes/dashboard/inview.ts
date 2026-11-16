/**
 * Action: calls `onseen` once, the first time the element comes near the viewport. Used to start
 * the heavier per-view queries (turn-away points, approach curves) only when their panel is shown.
 */
export function inview(node: HTMLElement, onseen: () => void) {
	if (typeof IntersectionObserver === 'undefined') {
		onseen();
		return {};
	}
	const io = new IntersectionObserver((entries) => {
		if (entries.some((e) => e.isIntersecting)) {
			onseen();
			io.disconnect();
		}
	}, { rootMargin: '400px 0px' });
	io.observe(node);
	return { destroy: () => io.disconnect() };
}
