<script lang="ts">
	/** /play without a case: the case is picked on the run console. */
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	onMount(() => { goto('/', { replace: true }); });
</script>
