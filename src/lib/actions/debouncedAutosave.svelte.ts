import { untrack } from 'svelte';

/**
 * Shared debounced-autosave wiring for the editor panels (Records detail pane, Files per-file editor,
 * Globals editor). Call it once during a component's setup; it installs a single `$effect` that, while
 * `isDirty()` is true, schedules `save()` after `delay` ms — resetting the timer on every change so a
 * burst of keystrokes saves once when typing pauses.
 *
 * Why this exists: the three panels previously hand-rolled the same timer + `$effect`, and each save
 * also triggered a full list refetch in the host, which fed fresh data back into the open editor and
 * dropped in-flight keystrokes (and flashed the page). The save itself is wrapped in `untrack` so that
 * reading/writing `$state` inside `save()` never re-arms this effect — the dirty signal is the *only*
 * dependency. Hosts must update the edited row **in place** rather than refetch (see the panels'
 * `onchanged`/`onSaved` callbacks); this helper only owns the timing.
 *
 * @param opts.isDirty - Reactive predicate: true when the form differs from the last saved snapshot.
 *   Read reactively, so it (and only it) decides when a save is scheduled.
 * @param opts.save - The (possibly async) save routine. Should no-op when already clean/saving.
 * @param opts.delay - Debounce window in ms (default 600).
 * @returns `flush()` — cancel the pending timer and save immediately (awaitable; use on
 *   blur/Enter/prev-next/close); and `cancel()` — drop the pending timer without saving (use before a
 *   delete, or in a panel's own fire-and-forget "flush the entity we're leaving" path).
 *
 * Concerns / future improvements:
 * - `save()` is expected to guard its own in-flight/clean state; this helper does not serialize
 *   overlapping saves beyond cancelling the pending timer.
 */
export function debouncedAutosave(opts: {
	isDirty: () => boolean;
	save: () => void | Promise<void>;
	delay?: number;
}): { flush: () => Promise<void>; cancel: () => void } {
	const { isDirty, save, delay = 600 } = opts;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function cancel() {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	}

	$effect(() => {
		if (!isDirty()) return;
		cancel();
		timer = setTimeout(() => {
			timer = null;
			void untrack(() => save());
		}, delay);
		return cancel;
	});

	return {
		async flush() {
			cancel();
			await save();
		},
		cancel
	};
}
