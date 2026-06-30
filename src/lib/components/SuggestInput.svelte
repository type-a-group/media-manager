<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button } from '$lib/components/ui/button/index.js';

	/**
	 * Single-line **editable combobox** (autocomplete / typeahead): a text input whose value is always
	 * free-text, paired with a dropdown of host-supplied suggestions (the distinct values already
	 * entered for this field — Excel's "Pick From Drop-down List"). Suggestions are a convenience, never
	 * a constraint: you can always type a brand-new value, which then joins the pool on the next focus.
	 *
	 * Presentational and entity-agnostic — it knows nothing about classes/records. The host injects a
	 * {@link loadSuggestions} loader bound to the right field, and reacts to commits via {@link oncommit}.
	 * Composed from the shadcn `Input` + `Popover` primitives; the popover is anchored to the input and
	 * never steals focus (`trapFocus={false}` + suppressed auto-focus + `pointerdown`-preventDefault on
	 * options), so typing and keyboard navigation stay in the field.
	 *
	 * @param value - The current text. Use `bind:value` for a buffer you own (the list add-item box), or
	 *   pass one-way + {@link onValueChange} when the backing value isn't a plain string (a field value
	 *   typed `unknown`).
	 * @param onValueChange - Fired on every text change (typing or choosing a suggestion) with the new
	 *   string, for hosts that feed `value` one-way.
	 * @param loadSuggestions - Async source of candidate values; re-invoked on each focus so freshly
	 *   entered values appear. Failures degrade to an empty list (plain input).
	 * @param exclude - Values to hide from suggestions (case-insensitive) — e.g. tags already added.
	 * @param oncommit - Called after `value` is set, when a suggestion is chosen or Enter is pressed.
	 *   For a string field wire this to the editor's save-on-Enter; for a list field, to "add item".
	 * @param keepOpenAfterCommit - When true (list/tags), keep focus + reopen suggestions after a commit
	 *   so several items can be added in a row. When false (string), commit closes the popover.
	 *
	 * Concerns / future improvements:
	 * - Filtering is a simple case-insensitive substring match capped at {@link MAX_SHOWN}; no fuzzy
	 *   ranking. Fine for the modest per-field value counts we expect.
	 * - Suggestions reload fully on every focus (one cheap server scan). If lists grow large, debounce
	 *   or cache with a short TTL.
	 */
	let {
		value = $bindable(''),
		onValueChange,
		loadSuggestions,
		exclude = [],
		oncommit,
		keepOpenAfterCommit = false,
		placeholder,
		id,
		class: className,
		disabled = false
	}: {
		value?: string;
		onValueChange?: (value: string) => void;
		loadSuggestions: () => Promise<string[]>;
		exclude?: string[];
		oncommit?: () => void;
		keepOpenAfterCommit?: boolean;
		placeholder?: string;
		id?: string;
		class?: string;
		disabled?: boolean;
	} = $props();

	/** Cap on rendered suggestions — keeps the popover bounded for high-cardinality fields. */
	const MAX_SHOWN = 50;

	let open = $state(false);
	let all = $state<string[]>([]);
	let highlight = $state(-1);
	let inputEl = $state<HTMLInputElement | null>(null);
	/** Unique selector so the portalled popover anchors to this instance's input. */
	const anchorId = `suggest-${Math.random().toString(36).slice(2, 9)}`;

	const excludeSet = $derived(new Set(exclude.map((e) => e.trim().toLowerCase())));
	const filtered = $derived.by(() => {
		const q = value.trim().toLowerCase();
		const out: string[] = [];
		for (const s of all) {
			const sl = s.toLowerCase();
			if (excludeSet.has(sl)) continue;
			if (sl === q) continue; // the exact current value isn't a useful suggestion
			if (q && !sl.includes(q)) continue;
			out.push(s);
			if (out.length >= MAX_SHOWN) break;
		}
		return out;
	});

	async function refreshSuggestions() {
		try {
			all = await loadSuggestions();
		} catch {
			all = [];
		}
	}

	async function onfocus() {
		await refreshSuggestions();
		highlight = -1;
		if (filtered.length) open = true;
	}

	function oninput() {
		onValueChange?.(value);
		highlight = -1;
		open = filtered.length > 0;
	}

	function choose(s: string) {
		value = s;
		onValueChange?.(s);
		highlight = -1;
		oncommit?.();
		if (keepOpenAfterCommit) {
			// list/tags: clearing happens in oncommit; offer the remaining suggestions again.
			void refreshSuggestions().then(() => {
				open = true;
				inputEl?.focus();
			});
		} else {
			open = false;
		}
	}

	function commitTyped() {
		highlight = -1;
		oncommit?.();
		if (keepOpenAfterCommit) {
			void refreshSuggestions().then(() => {
				open = filtered.length > 0;
			});
		} else {
			open = false;
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (!open && filtered.length) open = true;
			highlight = Math.min(highlight + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlight = Math.max(highlight - 1, -1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (open && highlight >= 0 && highlight < filtered.length) choose(filtered[highlight]);
			else commitTyped();
		} else if (e.key === 'Escape') {
			if (open) {
				e.stopPropagation();
				open = false;
				highlight = -1;
			}
		}
	}
</script>

<Input
	bind:ref={inputEl}
	bind:value
	{id}
	{placeholder}
	{disabled}
	autocomplete="off"
	class={className}
	data-suggest-anchor={anchorId}
	{onfocus}
	{oninput}
	{onkeydown}
	onblur={() => {
		open = false;
		highlight = -1;
		// Commit the typed value on blur for string fields (parity with the plain textarea). The
		// list/tags add-item box (keepOpenAfterCommit) must NOT auto-add a half-typed item on blur.
		if (!keepOpenAfterCommit) oncommit?.();
	}}
/>

<Popover.Root bind:open>
	<Popover.Content
		align="start"
		sideOffset={4}
		trapFocus={false}
		customAnchor={`[data-suggest-anchor="${anchorId}"]`}
		onOpenAutoFocus={(e) => e.preventDefault()}
		onCloseAutoFocus={(e) => e.preventDefault()}
		class="max-h-64 w-[var(--bits-floating-anchor-width)] min-w-48 overflow-y-auto p-1"
	>
		{#each filtered as s, i (s)}
			<Button
				variant="ghost"
				size="sm"
				class="h-8 w-full justify-start font-normal {highlight === i
					? 'bg-accent text-accent-foreground'
					: ''}"
				onpointerdown={(e) => {
					// Keep focus in the input so the value commits without a blur race.
					e.preventDefault();
					choose(s);
				}}
				onmouseenter={() => (highlight = i)}
			>
				{s}
			</Button>
		{/each}
	</Popover.Content>
</Popover.Root>
