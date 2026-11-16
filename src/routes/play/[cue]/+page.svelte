<script lang="ts">
	/** Free play with one condition: /play/timer-bar, /play/ink-refill?mode=study&difficulty=hard ... */
	import { page } from '$app/state';
	import { CUES, cueById } from '#lib/game/cues/index.ts';
	import PlayView from '../PlayView.svelte';

	// An unknown id falls back to the timer bar rather than an error page.
	const cue = $derived(CUES.find((c) => c.id === page.params.cue) ?? cueById('timer-bar'));
</script>

<PlayView {cue} />
