<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Trash2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { apiBulkUpdatePropertiesForType, apiBulkDeleteForType } from '$lib/api/client.js';

	/**
	 * Bulk actions for a multi-selected set of `json` records — "Set field…" (apply one value across
	 * all selected) and "Delete". Extracted from the old `JsonRecordGrid` so the records hub keeps this
	 * behaviour after migrating to the shared {@link DataGrid}. Renders the inline header controls plus
	 * the two dialogs; the host places it in the grid's `bulkBar` snippet.
	 *
	 * @param typeId - The `json` media type id.
	 * @param schema - The type's schema (drives the field/value widgets).
	 * @param selectedIds - The currently multi-selected record ids.
	 * @param onchanged - Called after a successful bulk update/delete (host clears selection + refreshes).
	 */
	let {
		typeId,
		schema,
		selectedIds,
		onchanged
	}: {
		typeId: string;
		schema: SchemaDefinition | null;
		selectedIds: string[];
		onchanged: () => void;
	} = $props();

	let setFieldDialogOpen = $state(false);
	let deleteConfirmOpen = $state(false);
	let setFieldKey = $state('');
	let setFieldValue = $state<
		string | number | boolean | string[] | { display_name: string; url: string }
	>('');

	function getOrderedEditableKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'name');
		return keys.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
	}

	function openSetFieldDialog() {
		if (!schema) return;
		const keys = getOrderedEditableKeys(schema);
		setFieldKey = keys[0] ?? '';
		setFieldDialogOpen = true;
	}

	// Reset the value widget to a sensible default whenever the chosen field changes.
	$effect(() => {
		if (!setFieldDialogOpen || !schema) return;
		const def = schema[setFieldKey];
		setFieldValue =
			def?.type === 'boolean'
				? false
				: def?.type === 'number'
					? 0
					: def?.type === 'list'
						? ''
						: def?.type === 'dropdown' && (def as { multiselect?: boolean }).multiselect
							? []
							: def?.type === 'url'
								? { display_name: '', url: '' }
								: '';
	});

	function getCoercedValue():
		| string
		| number
		| boolean
		| string[]
		| { display_name: string; url: string }
		| null {
		if (!schema || !setFieldKey) return null;
		const def = schema[setFieldKey];
		const type = def?.type ?? 'string';
		const raw = setFieldValue;
		if (type === 'number') {
			const n = typeof raw === 'number' ? raw : Number(raw);
			return Number.isFinite(n) ? n : null;
		}
		if (type === 'boolean') return Boolean(raw);
		if (type === 'dropdown' && (def as { multiselect?: boolean }).multiselect) {
			return Array.isArray(raw) ? (raw as string[]) : [];
		}
		if (type === 'list')
			return Array.isArray(raw)
				? raw
				: typeof raw === 'string'
					? raw
							.split(',')
							.map((s) => s.trim())
							.filter(Boolean)
					: [];
		if (type === 'url') {
			if (raw != null && typeof raw === 'object' && 'url' in raw)
				return raw as { display_name: string; url: string };
			return { display_name: '', url: typeof raw === 'string' ? raw : '' };
		}
		return raw === null || raw === undefined ? '' : String(raw);
	}

	async function handleSetFieldSubmit() {
		if (selectedIds.length === 0 || !setFieldKey) return;
		const value = getCoercedValue();
		if (value === null && schema?.[setFieldKey]?.type !== 'number') return;
		try {
			await apiBulkUpdatePropertiesForType(typeId, selectedIds, { [setFieldKey]: value });
			toast.success(`Updated ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'}`);
			setFieldDialogOpen = false;
			onchanged();
		} catch (e) {
			console.error(e);
			toast.error('Failed to update records');
		}
	}

	async function handleDeleteRecords() {
		if (selectedIds.length === 0) return;
		try {
			await apiBulkDeleteForType(typeId, selectedIds);
			toast.success(`Deleted ${selectedIds.length} record${selectedIds.length === 1 ? '' : 's'}`);
			deleteConfirmOpen = false;
			onchanged();
		} catch (e) {
			console.error(e);
			toast.error('Delete failed');
		}
	}
</script>

<span class="text-sm text-muted-foreground">{selectedIds.length} selected</span>
<Button variant="outline" size="sm" onclick={openSetFieldDialog}>Set field…</Button>
<Button variant="destructive" size="sm" onclick={() => (deleteConfirmOpen = true)}>
	<Trash2 class="mr-1 size-4" /> Delete
</Button>

<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete records</AlertDialog.Title>
		<AlertDialog.Description>
			Delete {selectedIds.length} record{selectedIds.length === 1 ? '' : 's'}? This cannot be
			undone.
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button variant="destructive" type="button" onclick={handleDeleteRecords}>Delete</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={setFieldDialogOpen}>
	<Dialog.Content>
		<Dialog.Title>Set field for selected records</Dialog.Title>
		<Dialog.Description>
			Choose a field and value. This will update all {selectedIds.length} selected record{selectedIds.length ===
			1
				? ''
				: 's'}.
		</Dialog.Description>
		{#if schema}
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2">
					<Label for="set-field-key">Field</Label>
					<Select.Root type="single" bind:value={setFieldKey}>
						<Select.Trigger id="set-field-key" class="w-full">
							{setFieldKey ? fieldLabel(setFieldKey) : 'Select field'}
						</Select.Trigger>
						<Select.Content>
							{#each getOrderedEditableKeys(schema) as key}
								<Select.Item value={key}>{fieldLabel(key)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				{#if setFieldKey}
					{@const def = schema[setFieldKey]}
					{@const type = def?.type ?? 'string'}
					<div class="flex flex-col gap-2">
						<Label for="set-field-value">Value</Label>
						{#if type === 'boolean'}
							<div class="flex items-center gap-2">
								<Checkbox
									id="set-field-value"
									checked={typeof setFieldValue === 'boolean' ? setFieldValue : false}
									onCheckedChange={(c) => (setFieldValue = c === true)}
								/>
								<Label for="set-field-value" class="font-normal">
									{type === 'boolean' && setFieldValue ? 'Yes' : 'No'}
								</Label>
							</div>
						{:else if type === 'dropdown' && def?.options?.length}
							{#if (def as { multiselect?: boolean }).multiselect}
								<Select.Root
									type="multiple"
									value={(Array.isArray(setFieldValue) ? setFieldValue : []) as string[]}
									onValueChange={(v) => (setFieldValue = v ?? [])}
								>
									<Select.Trigger id="set-field-value" class="w-full">
										{(Array.isArray(setFieldValue) ? setFieldValue : []).length === 0
											? '(none)'
											: (Array.isArray(setFieldValue) ? setFieldValue : []).join(', ')}
									</Select.Trigger>
									<Select.Content>
										{#each def.options ?? [] as opt}
											<Select.Item value={opt}>{opt}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{:else}
								<Select.Root
									type="single"
									value={typeof setFieldValue === 'string' ? setFieldValue : ''}
									onValueChange={(v) => (setFieldValue = v ?? '')}
								>
									<Select.Trigger id="set-field-value" class="w-full">
										{(typeof setFieldValue === 'string' && setFieldValue) || '(none)'}
									</Select.Trigger>
									<Select.Content>
										{#each def.options ?? [] as opt}
											<Select.Item value={opt}>{opt}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{/if}
						{:else if type === 'number'}
							<Input
								id="set-field-value"
								type="number"
								value={typeof setFieldValue === 'number'
									? setFieldValue
									: setFieldValue === ''
										? ''
										: Number(setFieldValue)}
								oninput={(e) =>
									(setFieldValue = (e.currentTarget as HTMLInputElement).valueAsNumber ?? 0)}
							/>
						{:else if type === 'list'}
							<Input
								id="set-field-value"
								type="text"
								placeholder="Comma-separated values"
								value={Array.isArray(setFieldValue)
									? setFieldValue.join(', ')
									: String(setFieldValue ?? '')}
								oninput={(e) => (setFieldValue = (e.currentTarget as HTMLInputElement).value)}
							/>
						{:else if type === 'url'}
							{@const urlObj =
								setFieldValue != null && typeof setFieldValue === 'object' && 'url' in setFieldValue
									? (setFieldValue as { display_name: string; url: string })
									: { display_name: '', url: '' }}
							<div class="flex flex-col gap-2">
								<Input
									type="text"
									placeholder="Display name"
									value={urlObj.display_name ?? ''}
									oninput={(e) =>
										(setFieldValue = {
											...urlObj,
											display_name: (e.currentTarget as HTMLInputElement).value
										})}
								/>
								<Input
									type="url"
									placeholder="https://..."
									value={urlObj.url ?? ''}
									oninput={(e) =>
										(setFieldValue = {
											...urlObj,
											url: (e.currentTarget as HTMLInputElement).value
										})}
								/>
							</div>
						{:else}
							<Input
								id="set-field-value"
								type="text"
								value={String(setFieldValue ?? '')}
								oninput={(e) => (setFieldValue = (e.currentTarget as HTMLInputElement).value)}
							/>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
		<div class="flex justify-end gap-2">
			<Dialog.Close type="button">Cancel</Dialog.Close>
			<Button type="button" onclick={handleSetFieldSubmit}>Apply</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
