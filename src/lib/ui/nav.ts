/** Top-level navigation, shared by the top bar and the home page. Change links here only. */

/** Where "Free play" goes. The play page lets the player switch cue from there. */
export const FREE_PLAY_HREF = '/play/timer-bar';

export interface NavItem {
	href: string;
	label: string;
	/** Route prefix that marks this item as the current page. */
	match: string;
}

export const NAV: NavItem[] = [
	{ href: '/', label: 'Home', match: '/' },
	{ href: '/study', label: 'Study', match: '/study' },
	{ href: FREE_PLAY_HREF, label: 'Free play', match: '/play' },
	{ href: '/cues', label: 'Cues', match: '/cues' },
	{ href: '/dashboard', label: 'Dashboard', match: '/dashboard' },
	{ href: '/replays', label: 'Replays', match: '/replays' }
];

export function isCurrent(item: NavItem, pathname: string): boolean {
	return item.match === '/' ? pathname === '/' : pathname === item.match || pathname.startsWith(item.match + '/');
}
