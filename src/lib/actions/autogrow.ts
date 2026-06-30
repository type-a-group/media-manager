import type { Action } from 'svelte/action';

/**
 * Svelte action that keeps a `<textarea>` sized to its content, so a field that
 * starts as a single visible row grows downward as the user (or a loaded record)
 * fills it with multi-line text — giving every string field a tidy multiline
 * editor without a manual resize handle or a per-field "long" toggle.
 *
 * Use case: applied to the string-value `<textarea>` in the shared `FieldInput`
 * (used by `FileEditorPanel`, `RecordDetailPane`, `GlobalsEditorPane`). Pass the field's
 * current value as the action argument (`use:autogrow={value}`) so Svelte runs the
 * action's `update` hook — re-fitting the height — whenever the bound value changes
 * externally, e.g. when the editor switches to a different record and the same textarea
 * node is reused. The argument is observed by Svelte to schedule `update`; its value is
 * never read here (the new height comes from the DOM's `scrollHeight`), so the action
 * itself takes no parameter.
 *
 * @param node - the textarea element to manage.
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
export const autogrow: Action<HTMLTextAreaElement, unknown> = (node) => {
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
 * The save itself rides on the resulting `blur` (the textarea's `onblur` fires the
 * host's autosave `commit()`), so this handler no longer takes a save callback —
 * committing on blur is the single code path (Item: autosave rework).
 *
 * @param e - the textarea keydown event.
 */
export function blurSaveOnEnter(e: KeyboardEvent): void {
	if (e.key === 'Enter' && !e.shiftKey) {
		e.preventDefault();
		(e.currentTarget as HTMLTextAreaElement).blur();
	}
}
