<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import FieldInput from '$lib/components/FieldInput.svelte';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';

	/**
	 * Shared "Set field…" dialog for a bulk-selected set of items (records in a `json` type, or blob
	 * members of a class catalog). Pick one schema field, enter a value with the same {@link FieldInput}
	 * every editor uses — so `record`/`file` pickers, multiselect, list, url and date all work here too —
	 * and apply it to every selected item. Semantics are **replace** (the chosen value overwrites each
	 * item's field); an **empty value is a valid apply** (clears the field across the selection).
	 *
	 * Presentational only: the host owns the bulk API call + post-op refresh via {@link apply}. On
	 * success the dialog closes; a thrown error keeps it open and surfaces a toast.
	 *
	 * @param open - Two-way bound dialog visibility (host opens it from its bulk bar button).
	 * @param schema - The entity's schema; drives the field list and each value widget.
	 * @param selectedCount - How many items the apply will touch (shown in the copy).
	 * @param apply - Host closure performing the bulk update for `(key, value)` and refreshing its grid.
	 * @param settableKeys - Optional override of the offered field keys (ordered). Defaults to the
	 *   schema's user fields plus `name`, name-first.
	 *
	 * Concerns / future improvements: there is no per-field "skip clearing" guard — applying an empty
	 * value intentionally wipes the field. A future "add to existing" mode for multi-value fields would
	 * live here as a toggle feeding a different patch shape (today we only replace).
	 */
	let {
		open = $bindable(false),
		schema,
		selectedCount,
		apply,
		settableKeys
	}: {
		open?: boolean;
		schema: SchemaDefinition | null;
		selectedCount: number;
		apply: (key: string, value: unknown) => Promise<void>;
		settableKeys?: string[];
	} = $props();

	let fieldKey = $state('');
	let value = $state<unknown>('');
	let saving = $state(false);

	/** Settable field keys for a schema — user fields plus `name`, ordered name-first. */
	function orderedKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'name');
		return keys.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
	}

	const keys = $derived(settableKeys ?? (schema ? orderedKeys(schema) : []));

	/** The seed value for a freshly chosen field — shape must match what {@link FieldInput} expects. */
	function defaultFor(key: string): unknown {
		const def = schema?.[key];
		const type = def?.type ?? 'string';
		const multi = (def as { multiselect?: boolean } | undefined)?.multiselect === true;
		if (type === 'boolean') return false;
		if (type === 'number') return 0;
		if (type === 'list') return [];
		if (type === 'url') return { display_name: '', url: '' };
		if ((type === 'dropdown' || type === 'file' || type === 'record') && multi) return [];
		return '';
	}

	// Seed the field picker + value whenever the dialog opens (so a reopen starts clean).
	$effect(() => {
		if (!open) return;
		const first = keys[0] ?? '';
		fieldKey = first;
		value = defaultFor(first);
	});

	/** Switching the field resets the value widget to that type's default. */
	function selectField(k: string) {
		fieldKey = k;
		value = defaultFor(k);
	}

	async function submit() {
		if (!fieldKey || selectedCount === 0 || saving) return;
		saving = true;
		try {
			await apply(fieldKey, value);
			open = false;
		} catch (e) {
			console.error(e);
			toast.error('Failed to update items');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Title>Set field for selected</Dialog.Title>
		<Dialog.Description>
			Choose a field and value. This replaces that field on all {selectedCount} selected item{selectedCount ===
			1
				? ''
				: 's'}.
		</Dialog.Description>
		{#if schema}
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2">
					<Label for="bulk-set-field-key">Field</Label>
					<Select.Root type="single" value={fieldKey} onValueChange={(v) => selectField(v ?? '')}>
						<Select.Trigger id="bulk-set-field-key" class="w-full">
							{fieldKey ? fieldLabel(fieldKey) : 'Select field'}
						</Select.Trigger>
						<Select.Content>
							{#each keys as key (key)}
								<Select.Item value={key}>{fieldLabel(key)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if fieldKey && schema[fieldKey]}
					<div class="flex flex-col gap-2">
						<Label for="bulk-set-field-value">Value</Label>
						<FieldInput id="bulk-set-field-value" def={schema[fieldKey]} bind:value />
					</div>
				{/if}
			</div>
		{/if}
		<div class="flex justify-end gap-2">
			<Dialog.Close type="button">Cancel</Dialog.Close>
			<Button type="button" disabled={!fieldKey || saving} onclick={submit}>Apply</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
