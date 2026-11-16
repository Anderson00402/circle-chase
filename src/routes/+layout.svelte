<script lang="ts">
	import '@fontsource-variable/unbounded/wght.css';
	import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';
	import '@fontsource-variable/jetbrains-mono/wght.css';
	import '../app.css';
	import { setupConvex, useConvexClient } from 'convex-svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import Mark from '#lib/ui/Mark.svelte';
	import ConnectionDot from '#lib/ui/ConnectionDot.svelte';
	import { watchConnection } from '#lib/ui/connection.svelte.ts';
	import { outboxStatus, startOutbox } from '#lib/study/outbox.svelte.ts';
	import { DEV_NAV, NAV, isCurrent } from '#lib/ui/nav.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
	setupConvex(import.meta.env.PUBLIC_CONVEX_URL);
	const client = useConvexClient();

	// The shared connection state (top bar dot, "can't reach the database" on slow lists) and the
	// run console's write outbox, started once for the whole app so writes left by an earlier page
	// are sent even if the next page never writes.
	startOutbox(client);
	onMount(() => watchConnection(client));

	/**
	 * Full-height pages (the game, replays) get a shell exactly one screen tall: no footer, no page
	 * scroll, and <main> is a flex column the page can fill. Other pages scroll normally.
	 */
	const fill = $derived(page.route.id?.startsWith('/play') ?? false);

	let menuOpen = $state(false);
	let menuButton = $state<HTMLButtonElement>();
	afterNavigate(() => (menuOpen = false));

	function onkey(e: KeyboardEvent) {
		if (e.key === 'Escape' && menuOpen) {
			menuOpen = false;
			menuButton?.focus();
		}
	}
</script>

<svelte:head>
	<title>Circle Chase</title>
	<meta
		name="description"
		content="A maze-chase game used to test which countdown signal best tells players a power-up is about to end."
	/>
</svelte:head>

<svelte:window onkeydown={onkey} />

<div class="shell" class:fill>
	<a class="skip" href="#main">Skip to content</a>
	<header class="bar">
		<a class="brand" href="/" aria-label="Circle Chase, home">
			<Mark size={26} />
			<span class="word">Circle<span>Chase</span></span>
		</a>

		<button
			bind:this={menuButton}
			class="menu-btn"
			type="button"
			aria-expanded={menuOpen}
			aria-controls="site-nav"
			onclick={() => (menuOpen = !menuOpen)}
		>
			<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
				{#if menuOpen}
					<path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
				{:else}
					<path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
				{/if}
			</svg>
			<span>Menu</span>
		</button>

		<span class="conn-slot"><ConnectionDot saving={outboxStatus} /></span>

		<nav id="site-nav" class:open={menuOpen} aria-label="Main">
			<ul>
				{#each NAV as item (item.href)}
					{@const current = isCurrent(item, page.url.pathname)}
					<li>
						<a href={item.href} aria-current={current ? 'page' : undefined}>{item.label}</a>
					</li>
				{/each}
			</ul>
			<ul class="dev" aria-label="Developer tools">
				{#each DEV_NAV as item (item.href)}
					<li><a href={item.href} aria-current={isCurrent(item, page.url.pathname) ? 'page' : undefined}>{item.label}</a></li>
				{/each}
			</ul>
		</nav>
	</header>

	<main id="main" tabindex="-1">
		{@render children()}
	</main>

	{#if !fill}
		<footer class="foot">
			<p>
				Circle Chase is a research prototype. It records anonymous gameplay data only, stored locally
				on this machine.
			</p>
		</footer>
	{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}
	/* Exactly one screen: the page inside <main> fills what is left under the bar. */
	.shell.fill {
		height: 100dvh;
		overflow: hidden;
	}
	main {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	main:focus {
		outline: none;
	}

	.skip {
		position: absolute;
		left: 8px;
		top: -48px;
		z-index: 100;
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 700;
	}
	.skip:focus {
		top: 8px;
	}

	/* Top bar */
	.bar {
		position: sticky;
		top: 0;
		z-index: 40;
		display: flex;
		align-items: center;
		gap: var(--space-3) var(--space-5);
		height: var(--bar-h);
		flex-shrink: 0;
		padding: 0 var(--space-4);
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid var(--rule);
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		height: 36px;
		padding-right: 4px;
		color: var(--ink);
		text-decoration: none;
	}
	.word {
		font-family: var(--font-display);
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.word span {
		margin-left: 0.28em;
		color: var(--accent);
	}

	nav ul {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	nav a {
		position: relative;
		display: flex;
		align-items: center;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius-sm);
		color: var(--ink-dim);
		font-size: var(--text-sm);
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	nav a:hover {
		background: var(--surface-2);
		color: var(--ink);
	}
	nav a[aria-current='page'] {
		color: var(--ink);
	}
	nav a[aria-current='page']::after {
		content: '';
		position: absolute;
		left: 12px;
		right: 12px;
		bottom: -8px;
		height: 2px;
		border-radius: 2px;
		background: var(--accent);
	}

	/* Developer tools: small, at the far right, apart from the main links. */
	nav {
		display: flex;
		align-items: center;
		flex: 1;
	}
	nav ul.dev {
		margin-left: auto;
	}
	nav .dev a {
		height: 28px;
		padding: 0 8px;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-weight: 500;
	}

	.conn-slot {
		order: 3;
		display: inline-flex;
	}
	.menu-btn {
		display: none;
		align-items: center;
		gap: 6px;
		height: 36px;
		margin-left: auto;
		padding: 0 10px;
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 600;
		cursor: pointer;
	}

	@media (max-width: 760px) {
		.menu-btn {
			display: inline-flex;
			margin-left: 0;
			order: 2;
		}
		.conn-slot {
			order: 1;
			margin-left: auto;
		}
		nav {
			display: none;
			position: absolute;
			top: calc(var(--bar-h) - 1px);
			left: 0;
			right: 0;
			padding: var(--space-2) var(--space-3) var(--space-3);
			background: var(--bg);
			border-bottom: 1px solid var(--rule);
			box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
		}
		nav.open {
			display: block;
		}
		nav ul.dev {
			margin: var(--space-2) 0 0;
			padding-top: var(--space-2);
			border-top: 1px solid var(--rule);
		}
		nav ul {
			flex-direction: column;
			align-items: stretch;
		}
		nav a {
			height: 44px;
			font-size: var(--text-md);
		}
		nav a[aria-current='page'] {
			background: var(--surface-2);
		}
		nav a[aria-current='page']::after {
			left: 0;
			right: auto;
			top: 10px;
			bottom: 10px;
			width: 3px;
			height: auto;
		}
	}

	/* Footer */
	.foot {
		padding: var(--space-4) var(--gutter);
		border-top: 1px solid var(--rule);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		text-align: center;
	}
</style>
