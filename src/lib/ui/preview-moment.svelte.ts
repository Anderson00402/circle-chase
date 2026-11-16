/**
 * "Compare at a moment": one shared setting that freezes every cue preview on the page at the same
 * time left (seconds; negative after the end), or null to let them play.
 */
export const previewMoment = $state<{ left: number | null }>({ left: null });
