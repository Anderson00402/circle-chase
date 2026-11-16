<script lang="ts">
	/**
	 * Home page illustration: the moment the study is about. The player is chasing two scared
	 * chasers through a corner of the maze, and the question is how much power is left.
	 * Static on purpose: no motion to respect, and it reads in a glance.
	 */
	const GHOST = 'M-37-10A37 37 0 0 1 37-10C37 27 34 37 22 47C12 42-33 23-37-10Z';
</script>

<svg viewBox="0 0 440 330" role="img" aria-labelledby="hero-art-title">
	<title id="hero-art-title">
		A round player chases two scared chasers through a maze while a timer asks how much power is
		left.
	</title>
	<defs>
		<radialGradient id="hero-glow" cx="50%" cy="45%" r="60%">
			<stop offset="0" stop-color="#2f6bff" stop-opacity="0.16" />
			<stop offset="1" stop-color="#2f6bff" stop-opacity="0" />
		</radialGradient>
		<filter id="hero-soft" x="-50%" y="-50%" width="200%" height="200%">
			<feGaussianBlur stdDeviation="4" />
		</filter>
	</defs>

	<rect x="0.5" y="0.5" width="439" height="329" rx="18" fill="#05070f" stroke="var(--rule)" />
	<rect x="0.5" y="0.5" width="439" height="329" rx="18" fill="url(#hero-glow)" />

	<!-- maze walls: glow pass then crisp pass -->
	<g fill="none" stroke="#2f6bff" stroke-linecap="round" stroke-linejoin="round">
		<g stroke-width="8" opacity="0.25" filter="url(#hero-soft)">
			<path d="M30 70h120a12 12 0 0 1 12 12v40M210 30v52a12 12 0 0 0 12 12h80M360 70v90a12 12 0 0 1-12 12h-40M30 250h110a12 12 0 0 0 12-12v-30M200 300v-40a12 12 0 0 1 12-12h90M410 220v80" />
		</g>
		<g stroke-width="3">
			<path d="M30 70h120a12 12 0 0 1 12 12v40M210 30v52a12 12 0 0 0 12 12h80M360 70v90a12 12 0 0 1-12 12h-40M30 250h110a12 12 0 0 0 12-12v-30M200 300v-40a12 12 0 0 1 12-12h90M410 220v80" />
		</g>
	</g>

	<!-- dots along the corridor the player is following -->
	<g fill="#c9d6ff">
		{#each [130, 152, 174, 196] as x (x)}<circle cx={x} cy="168" r="3" />{/each}
		{#each [70, 92] as x (x)}<circle cx={x} cy="168" r="3" opacity="0.35" />{/each}
	</g>
	<circle cx="40" cy="168" r="7" fill="#fff" opacity="0.25" />

	<!-- player, with a short trail of where it has been -->
	<g>
		<circle cx="92" cy="168" r="18" fill="var(--player)" opacity="0.08" />
		<circle cx="104" cy="168" r="20" fill="var(--player)" opacity="0.14" />
		<circle cx="116" cy="168" r="22" fill="var(--player)" />
		<circle cx="124" cy="160" r="3.4" fill="#05070f" />
	</g>

	<!-- two scared chasers running ahead -->
	<g transform="translate(250 168) scale(0.62)">
		<path d={GHOST} fill="var(--scared-fill)" fill-opacity="0.35" stroke="var(--scared)" stroke-width="5" stroke-dasharray="14 9" />
		<ellipse cx="-13" cy="-12" rx="6" ry="9" fill="var(--scared)" />
		<ellipse cx="13" cy="-12" rx="6" ry="9" fill="var(--scared)" />
	</g>
	<g transform="translate(326 214) scale(-0.56 0.56)">
		<path d={GHOST} fill="var(--scared-fill)" fill-opacity="0.35" stroke="var(--scared)" stroke-width="5" stroke-dasharray="14 9" />
		<ellipse cx="-13" cy="-12" rx="6" ry="9" fill="var(--scared)" />
		<ellipse cx="13" cy="-12" rx="6" ry="9" fill="var(--scared)" />
	</g>
	<!-- a chaser that is already dangerous again, far away -->
	<g transform="translate(384 112) scale(0.5)" opacity="0.9">
		<path d={GHOST} fill="var(--guard)" />
		<ellipse cx="-13" cy="-12" rx="6" ry="9" fill="#05070f" />
		<ellipse cx="13" cy="-12" rx="6" ry="9" fill="#05070f" />
	</g>

	<!-- the question -->
	<g transform="translate(150 106)">
		<rect x="0" y="0" width="186" height="38" rx="10" fill="var(--surface-2)" stroke="var(--rule-strong)" />
		<path d="M28 38l8 9 8-9" fill="var(--surface-2)" stroke="var(--rule-strong)" />
		<rect x="27" y="36" width="18" height="3" fill="var(--surface-2)" />
		<text x="14" y="25" fill="var(--ink-dim)" font-family="var(--font-mono)" font-size="14">power left</text>
		<text x="112" y="26" fill="var(--accent)" font-family="var(--font-display)" font-size="18" font-weight="700">?.? s</text>
	</g>
</svg>

<style>
	svg {
		width: 100%;
		height: auto;
	}
</style>
