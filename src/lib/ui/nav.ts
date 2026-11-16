/** Top-level navigation, shared by the top bar. Change links here only. */

/** Where "play something" links go: the run console, where a case is picked. */
export const FREE_PLAY_HREF = '/';

export interface NavItem {
	href: string;
	label: string;
	/** Route prefix that marks this item as the current page. */
	match: string;
	/** Other route prefixes that also mark it current (the play page belongs to Run). */
	also?: string[];
}

export const NAV: NavItem[] = [
	{ href: '/', label: 'Run', match: '/', also: ['/play'] },
	{ href: '/dashboard', label: 'Dashboard', match: '/dashboard' },
	{ href: '/replays', label: 'Replays', match: '/replays' }
];

/** Developer tools: shown small and apart from the main links. */
export const DEV_NAV: NavItem[] = [
	{ href: '/dev/simulate', label: 'Simulate', match: '/dev/simulate' },
	{ href: '/dev/strip', label: 'Film strip', match: '/dev/strip' }
];

const under = (prefix: string, pathname: string) => pathname === prefix || pathname.startsWith(prefix + '/');

export function isCurrent(item: NavItem, pathname: string): boolean {
	if (item.also?.some((p) => under(p, pathname))) return true;
	return item.match === '/' ? pathname === '/' : under(item.match, pathname);
}
