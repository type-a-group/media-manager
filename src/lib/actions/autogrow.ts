import type { Action } from 'svelte/action';

/**
 * Svelte action that keeps a `<textarea>` sized to its content, so a field that
 * starts as a single visible row grows downward as the user (or a loaded record)
 * fills it with multi-line text — giving every string field a tidy multiline
 * editor without a manual resize handle or a per-field "long" toggle.
 *
 * Use case: applied to the string-value `<textarea>` in the editor panes
 * (`ImageEditorPane`, `JsonEditorPane`, `GlobalsEditorPane`). Pass the field's
 * current value as the action argument (`use:autogrow={value}`) so the height is
 * re-fitted whenever the bound value changes externally — e.g. when the editor
 * switches to a different record and the same textarea node is reused.
 *
 * @param node - the textarea element to manage.
 * @param _value - the field's current value; only used to trigger the action's
 *   `update` hook on change. The new height is read from the DOM, not this value.
 *
 * Concerns / future improvements:
 * - Height is derived from `scrollHeight`, which requires the element to be laid
 *   out; for elements mounted hidden the first fit runs at zero height and is
 *   corrected on the first `input`/`update`. If we ever render these inside a
 *   collapsed container, call the fit again on reveal.
 * - There is no maximum height — extremely long values grow without bound. If
 *   that becomes a problem, add a `max-height` + `overflow-y: auto` cap rather
 *   than changing this action.
 */
export const autogrow: Action<HTMLTextAreaElement, unknown> = (node, _value) => {
	const fit = () => {
		node.style.height = 'auto';
		node.style.height = `${node.scrollHeight}px`;
	};
	fit();
	node.addEventListener('input', fit);
	return {
		update: fit,
		destroy: () => node.removeEventListener('input', fit)
	};
};

/**
 * Keydown handler for autogrow string textareas: a bare **Enter** commits the
 * field (blur + save) while **Shift+Enter** inserts a newline. This mirrors the
 * single-line input that these textareas replace — Enter still "finishes" the
 * field — while keeping deliberate multi-line entry available.
 *
 * @param e - the textarea keydown event.
 * @param save - the owning editor pane's save routine, invoked on a bare Enter.
 *
 * Concerns / future improvements:
 * - `save` is fired fire-and-forget (`void`); the pane is responsible for its own
 *   in-flight/dirty guarding (each pane's `save()` already no-ops when clean).
 */
export function blurSaveOnEnter(e: KeyboardEvent, save: () => void | Promise<void>): void {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		(e.currentTarget as HTMLTextAreaElement).blur();
		void save();
	}
}
