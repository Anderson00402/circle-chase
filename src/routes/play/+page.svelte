<script lang="ts">
	/** Free play: opens the condition played last on this browser (the timer bar the first time). */
	import { CUES, cueById } from '#lib/game/cues/index.ts';
	import PlayView from './PlayView.svelte';

	let last: string | null = null;
	try { last = localStorage.getItem('cc.play.last'); } catch { /* ignore */ }
	const cue = CUES.find((c) => c.id === last) ?? cueById('timer-bar');
</script>

<PlayView {cue} />
