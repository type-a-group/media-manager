<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Database, Plus, Pencil, Trash2, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import { fieldLabel, isProtectedSchemaKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition, FieldType, ListItemType } from '$lib/core/types.js';

	import {
		apiGetSchemaForType,
		apiAddSchemaFieldForType,
		apiUpdateSchemaFieldForType,
		apiDeleteSchemaFieldForType,
		apiImportSchemaForType,
		apiListMediaTypes,
		apiRepairRecordsForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { triggerImageListRefresh, triggerSchemaRefresh } from '$lib/stores/refreshTrigger.js';

	const FIELD_TYPES: FieldType[] = [
		'string',
		'number',
		'boolean',
		'dropdown',
		'list',
		'url',
		'file'
	];
	const LIST_ITEM_TYPES: ListItemType[] = ['string', 'number', 'url'];

	let isOpen = $state(false);
	let schema = $state<SchemaDefinition | null>(null);
	let loading = $state(false);

	// Add field form
	let addFieldName = $state('');
	let addFieldType = $state<FieldType>('string');
	let addDefaultValue = $state('');
	let addDefaultUrlDisplayName = $state('');
	let addDefaultUrlUrl = $state('');
	let addOptions = $state<string[]>([]);
	let addOptionInput = $state('');
	let addItemType = $state<ListItemType>('string');
	let addMultiselect = $state(false);

	// Edit state
	let editingKey = $state<string | null>(null);
	let editFieldName = $state('');
	let editFieldType = $state<FieldType>('string');
	let editDefaultValue = $state('');
	let editDefaultUrlDisplayName = $state('');
	let editDefaultUrlUrl = $state('');
	let editOptions = $state<string[]>([]);
	let editOptionInput = $state('');
	let editItemType = $state<ListItemType>('string');
	let editMultiselect = $state(false);

	// Delete confirmation
	let deleteConfirmOpen = $state(false);
	let deleteTargetKey = $state<string | null>(null);

	// Rename confirmation
	let renameConfirmOpen = $state(false);
	let renameFromKey = $state('');
	let renameToKey = $state('');

	// Turn off multiselect confirmation
	let multiselectOffConfirmOpen = $state(false);

	let importFileRef = $state<HTMLInputElement | null>(null);
	let cloneDialogOpen = $state(false);
	let cloneFromTypeId = $state('');
	let availableTypes = $state<{ id: string; displayName: string }[]>([]);

	let repairDialogOpen = $state(false);
	let repairIssues = $state<{ id: string; field: string; issue: string; fix?: unknown }[]>([]);
	let repairing = $state(false);

	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);

	/**
	 * Fetches the current schema from the API.
	 * Called when dialog opens and after schema-modifying operations.
	 */
	async function fetchSchema() {
		if (!typeId) return;
		loading = true;
		try {
			schema = await apiGetSchemaForType(typeId);
		} catch (e) {
			console.error(e);
			toast.error('Failed to load schema');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (isOpen && typeId) fetchSchema();
	});

	/**
	 * Returns schema keys excluding system-only fields, in display order.
	 */
	function getEditableSchemaKeys(s: SchemaDefinition): string[] {
		return Object.keys(s)
			.filter((k) => !['file_name', 'last_modified', 'default'].includes(k))
			.sort((a, b) =>
				a === 'image_name' || a === 'name'
					? -1
					: b === 'image_name' || b === 'name'
						? 1
						: a.localeCompare(b)
			);
	}

	/**
	 * Adds a new field to the schema.
	 */
	async function handleAddField() {
		const name = addFieldName.trim().toLowerCase().replace(/\s+/g, '_');
		if (!name) {
			toast.error('Field name is required');
			return;
		}
		if (!/^[a-z_][a-z0-9_]*$/.test(name)) {
			toast.error('Field name must be snake_case (e.g. my_field)');
			return;
		}
		if (schema && name in schema) {
			toast.error('Field already exists');
			return;
		}

		let defaultValue:
			| string
			| number
			| boolean
			| string[]
			| { display_name: string; url: string }
			| undefined;
		if (addFieldType === 'number') {
			const n = Number(addDefaultValue);
			defaultValue = Number.isFinite(n) ? n : undefined;
		} else if (addFieldType === 'boolean') {
			defaultValue = addDefaultValue.toLowerCase() === 'true';
		} else if (addFieldType === 'list') {
			defaultValue = addDefaultValue
				? addDefaultValue
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: [];
		} else if (addFieldType === 'url') {
			defaultValue = {
				display_name: addDefaultUrlDisplayName.trim(),
				url: addDefaultUrlUrl.trim()
			};
		} else if (addFieldType === 'dropdown' && addMultiselect) {
			defaultValue = addDefaultValue
				? addDefaultValue
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: [];
		} else {
			defaultValue = addDefaultValue || undefined;
		}

		try {
			await apiAddSchemaFieldForType(typeId!, {
				fieldName: name,
				fieldType: addFieldType,
				defaultValue,
				options: addFieldType === 'dropdown' ? addOptions : undefined,
				itemTypes: addFieldType === 'list' ? [addItemType] : undefined,
				multiselect: addFieldType === 'dropdown' ? addMultiselect : undefined
			});
			toast.success('Field added');
			addFieldName = '';
			addDefaultValue = '';
			addDefaultUrlDisplayName = '';
			addDefaultUrlUrl = '';
			addOptions = [];
			addItemType = 'string';
			addMultiselect = false;
			triggerImageListRefresh();
			triggerSchemaRefresh();
			await fetchSchema();
		} catch (e) {
			console.error(e);
			toast.error('Failed to add field');
		}
	}

	function addOption() {
		const v = addOptionInput.trim();
		if (v && !addOptions.includes(v)) {
			addOptions = [...addOptions, v];
			addOptionInput = '';
		}
	}

	function removeAddOption(idx: number) {
		addOptions = addOptions.filter((_, i) => i !== idx);
	}

	/**
	 * Starts editing a field.
	 */
	function startEdit(key: string) {
		const def = schema?.[key];
		if (!def) return;
		editingKey = key;
		editFieldName = key;
		editFieldType = def.type;
		if (def.type === 'url') {
			const raw = def.defaultValue;
			if (raw != null && typeof raw === 'object' && 'url' in raw) {
				editDefaultUrlDisplayName = String((raw as { display_name?: string }).display_name ?? '');
				editDefaultUrlUrl = String((raw as { url: string }).url ?? '');
			} else {
				editDefaultUrlDisplayName = '';
				editDefaultUrlUrl = typeof raw === 'string' ? raw : '';
			}
			editDefaultValue = '';
		} else if (def.type === 'list') {
			editDefaultValue = Array.isArray(def.defaultValue)
				? def.defaultValue.join(', ')
				: String(def.defaultValue ?? '');
			editItemType = (def as { itemTypes?: ListItemType[] }).itemTypes?.[0] ?? 'string';
		} else if (def.type === 'dropdown') {
			editMultiselect = (def as { multiselect?: boolean }).multiselect ?? false;
			editDefaultValue = Array.isArray(def.defaultValue)
				? (def.defaultValue as string[]).join(', ')
				: String(def.defaultValue ?? '');
			editDefaultUrlDisplayName = '';
			editDefaultUrlUrl = '';
		} else {
			editDefaultValue = Array.isArray(def.defaultValue)
				? def.defaultValue.join(', ')
				: String(def.defaultValue ?? '');
			editDefaultUrlDisplayName = '';
			editDefaultUrlUrl = '';
		}
		editOptions = def.options ?? [];
		editOptionInput = '';
		if (def.type !== 'dropdown') editMultiselect = false;
	}

	function cancelEdit() {
		editingKey = null;
	}

	function addEditOption() {
		const v = editOptionInput.trim();
		if (v && !editOptions.includes(v)) {
			editOptions = [...editOptions, v];
			editOptionInput = '';
		}
	}

	function removeEditOption(idx: number) {
		editOptions = editOptions.filter((_, i) => i !== idx);
	}

	/**
	 * Saves the edited field. If name changed, shows rename confirmation.
	 */
	async function saveEdit() {
		if (!editingKey || !schema) return;

		const newName = editFieldName.trim().toLowerCase().replace(/\s+/g, '_');
		if (!newName || !/^[a-z_][a-z0-9_]*$/.test(newName)) {
			toast.error('Field name must be snake_case');
			return;
		}

		if (newName !== editingKey && isProtectedSchemaKey(editingKey)) {
			toast.error('This field cannot be renamed');
			return;
		}

		if (newName !== editingKey && schema[newName]) {
			toast.error('A field with that name already exists');
			return;
		}

		if (newName !== editingKey) {
			renameFromKey = editingKey;
			renameToKey = newName;
			renameConfirmOpen = true;
			return;
		}

		const def = schema[editingKey];
		if (
			def?.type === 'dropdown' &&
			(def as { multiselect?: boolean }).multiselect === true &&
			!editMultiselect
		) {
			multiselectOffConfirmOpen = true;
			return;
		}

		await doSaveEdit(editingKey, editingKey);
	}

	/**
	 * Performs the actual save after rename confirmation (if any).
	 */
	async function doSaveEdit(oldKey: string, newKey: string) {
		let defaultValue:
			| string
			| number
			| boolean
			| string[]
			| { display_name: string; url: string }
			| undefined;
		if (editFieldType === 'number') {
			const n = Number(editDefaultValue);
			defaultValue = Number.isFinite(n) ? n : undefined;
		} else if (editFieldType === 'boolean') {
			defaultValue = editDefaultValue.toLowerCase() === 'true';
		} else if (editFieldType === 'list') {
			defaultValue = editDefaultValue
				? editDefaultValue
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: [];
		} else if (editFieldType === 'url') {
			defaultValue = {
				display_name: editDefaultUrlDisplayName.trim(),
				url: editDefaultUrlUrl.trim()
			};
		} else if (editFieldType === 'dropdown' && editMultiselect) {
			defaultValue = editDefaultValue
				? editDefaultValue
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: [];
		} else {
			defaultValue = editDefaultValue || undefined;
		}

		try {
			await apiUpdateSchemaFieldForType(typeId!, {
				fieldName: oldKey,
				newFieldName: newKey !== oldKey ? newKey : undefined,
				fieldType: editFieldType,
				defaultValue,
				options: editFieldType === 'dropdown' ? editOptions : undefined,
				itemTypes: editFieldType === 'list' ? [editItemType] : undefined,
				multiselect: editFieldType === 'dropdown' ? editMultiselect : undefined
			});
			toast.success('Field updated');
			editingKey = null;
			renameConfirmOpen = false;
			multiselectOffConfirmOpen = false;
			triggerImageListRefresh();
			triggerSchemaRefresh();
			await fetchSchema();
		} catch (e) {
			console.error(e);
			toast.error('Failed to update field');
		}
	}

	async function confirmRename() {
		if (renameFromKey && renameToKey) {
			await doSaveEdit(renameFromKey, renameToKey);
		}
	}

	function openDeleteConfirm(key: string) {
		deleteTargetKey = key;
		deleteConfirmOpen = true;
	}

	/**
	 * Deletes a field from the schema.
	 * @param removeFromImages - If true, also removes the field from all image records.
	 */
	async function handleDelete(removeFromImages: boolean) {
		if (!deleteTargetKey) return;
		try {
			await apiDeleteSchemaFieldForType(typeId!, { fieldName: deleteTargetKey, removeFromImages });
			toast.success(
				removeFromImages ? 'Field removed from schema and all images' : 'Field removed from schema'
			);
			deleteTargetKey = null;
			deleteConfirmOpen = false;
			triggerImageListRefresh();
			triggerSchemaRefresh();
			await fetchSchema();
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete field');
		}
	}

	async function handleExportSchema() {
		if (!schema) return;
		const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `schema_${typeId}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	async function handleImportSchema(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			const json = JSON.parse(text);
			await apiImportSchemaForType(typeId!, json);
			toast.success('Schema imported successfully');
			triggerImageListRefresh();
			triggerSchemaRefresh();
			await fetchSchema();
		} catch (err) {
			console.error(err);
			toast.error('Failed to import schema. Make sure the file is a valid JSON schema.');
		} finally {
			target.value = '';
		}
	}

	async function openCloneDialog() {
		try {
			const types = await apiListMediaTypes();
			availableTypes = types.filter((t) => t.id !== typeId && t.id !== 'globals');
			cloneFromTypeId = availableTypes[0]?.id ?? '';
			cloneDialogOpen = true;
		} catch (err) {
			console.error(err);
			toast.error('Failed to load media types');
		}
	}

	async function handleCloneSchema() {
		if (!cloneFromTypeId) return;
		try {
			const otherSchema = await apiGetSchemaForType(cloneFromTypeId);
			await apiImportSchemaForType(typeId!, otherSchema);
			toast.success('Schema cloned successfully');
			cloneDialogOpen = false;
			triggerImageListRefresh();
			triggerSchemaRefresh();
			await fetchSchema();
		} catch (err) {
			console.error(err);
			toast.error('Failed to clone schema');
		}
	}

	async function handleValidateData() {
		if (!typeId || typeId === 'globals') return;
		repairing = true;
		try {
			const res = await apiRepairRecordsForType(typeId, true);
			repairIssues = res.issues;
			repairDialogOpen = true;
		} catch (e) {
			console.error(e);
			toast.error('Failed to validate records');
		} finally {
			repairing = false;
		}
	}

	async function handleFixData() {
		if (!typeId || typeId === 'globals') return;
		repairing = true;
		try {
			const res = await apiRepairRecordsForType(typeId, false);
			toast.success(`Repaired ${res.fixed} records`);
			repairDialogOpen = false;
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Failed to repair records');
		} finally {
			repairing = false;
		}
	}
</script>

<Dialog.Root bind:open={isOpen}>
	<Dialog.Trigger>
		<Button variant="outline" size="icon" title="Schema">
			<Database />
		</Button>
	</Dialog.Trigger>
	<Dialog.Content class="max-w-2xl max-h-[90vh] flex flex-col">
		<div class="flex items-center justify-between">
			<Dialog.Title>Schema</Dialog.Title>
			<div class="flex items-center gap-2 pr-6">
				{#if typeId !== 'globals'}
					<Button variant="outline" size="sm" onclick={handleValidateData} disabled={repairing}>
						Validate & Repair
					</Button>
				{/if}
				<Button variant="outline" size="sm" onclick={handleExportSchema}>Export</Button>
				<Button variant="outline" size="sm" onclick={() => importFileRef?.click()}>Import</Button>
				<input
					type="file"
					accept=".json"
					bind:this={importFileRef}
					onchange={handleImportSchema}
					class="hidden"
				/>
				<Button variant="outline" size="sm" onclick={openCloneDialog}>Clone</Button>
			</div>
		</div>
		<Dialog.Description>
			Add, edit, or remove fields. Filename and image name cannot be modified.
		</Dialog.Description>

		<div class="flex-1 overflow-y-auto flex flex-col gap-4 py-4">
			{#if loading}
				<p class="italic text-muted-foreground">Loading…</p>
			{:else if schema}
				<div class="flex flex-col gap-2">
					<h3 class="font-semibold">Fields</h3>
					<div class="flex flex-col gap-2">
						{#each getEditableSchemaKeys(schema) as key (key)}
							{#if editingKey === key}
								<div class="border rounded-lg p-3 flex flex-col gap-2 bg-muted/30">
									<div class="flex flex-row gap-2 items-center">
										<Label class="w-20 shrink-0">Name</Label>
										<Input
											type="text"
											bind:value={editFieldName}
											placeholder="field_name"
											disabled={isProtectedSchemaKey(key)}
										/>
									</div>
									<div class="flex flex-row gap-2 items-center">
										<Label class="w-20 shrink-0">Type</Label>
										<Select.Root type="single" bind:value={editFieldType}>
											<Select.Trigger class="w-32">
												{editFieldType}
											</Select.Trigger>
											<Select.Content>
												{#each FIELD_TYPES as t}
													<Select.Item value={t}>{t}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									{#if editFieldType === 'url'}
										<div class="flex flex-col gap-2">
											<div class="flex flex-row gap-2 items-center">
												<Label class="w-20 shrink-0">Default display name</Label>
												<Input
													type="text"
													bind:value={editDefaultUrlDisplayName}
													placeholder="Display name"
												/>
											</div>
											<div class="flex flex-row gap-2 items-center">
												<Label class="w-20 shrink-0">Default URL</Label>
												<Input
													type="url"
													bind:value={editDefaultUrlUrl}
													placeholder="https://..."
												/>
											</div>
										</div>
									{:else}
										<div class="flex flex-row gap-2 items-center">
											<Label class="w-20 shrink-0">Default</Label>
											<Input
												type="text"
												bind:value={editDefaultValue}
												placeholder="Default value"
											/>
										</div>
									{/if}
									{#if editFieldType === 'list'}
										<div class="flex flex-row gap-2 items-center">
											<Label class="text-sm w-24 shrink-0">Item type</Label>
											<Select.Root type="single" bind:value={editItemType}>
												<Select.Trigger class="w-28">
													{editItemType}
												</Select.Trigger>
												<Select.Content>
													{#each LIST_ITEM_TYPES as t}
														<Select.Item value={t}>{t}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										</div>
									{/if}
									{#if editFieldType === 'dropdown'}
										<div class="flex flex-row items-center gap-2">
											<Checkbox id="edit-multiselect" bind:checked={editMultiselect} />
											<Label for="edit-multiselect" class="text-sm font-normal cursor-pointer"
												>Multiselect</Label
											>
										</div>
										<div class="flex flex-col gap-1">
											<Label>Options</Label>
											<div class="flex flex-wrap gap-1">
												{#each editOptions as opt, i}
													<span
														class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-sm"
													>
														{opt}
														<button
															type="button"
															class="hover:text-destructive"
															onclick={() => removeEditOption(i)}
															aria-label="Remove option"
														>
															<X class="size-3" />
														</button>
													</span>
												{/each}
											</div>
											<div class="flex gap-2">
												<Input
													type="text"
													bind:value={editOptionInput}
													placeholder="Add option"
													onkeydown={(e) =>
														e.key === 'Enter' && (e.preventDefault(), addEditOption())}
												/>
												<Button type="button" variant="outline" size="sm" onclick={addEditOption}>
													Add
												</Button>
											</div>
										</div>
									{/if}
									<div class="flex gap-2">
										<Button size="sm" onclick={saveEdit}>Save</Button>
										<Button size="sm" variant="outline" onclick={cancelEdit}>Cancel</Button>
									</div>
								</div>
							{:else}
								<div
									class="flex flex-row items-center justify-between gap-2 p-2 rounded border hover:bg-muted/30"
								>
									<div class="flex flex-col min-w-0">
										<span class="font-medium">{fieldLabel(key)}</span>
										<span class="text-xs text-muted-foreground">
											{schema[key]?.type}
											{#if schema[key]?.type === 'dropdown' && schema[key]?.options?.length}
												— {schema[key].options.join(', ')}
												{#if (schema[key] as { multiselect?: boolean }).multiselect}
													(multiselect)
												{/if}
											{:else if schema[key]?.type === 'list' && (schema[key] as { itemTypes?: ListItemType[] }).itemTypes?.length}
												— {(schema[key] as { itemTypes: ListItemType[] }).itemTypes[0]}
											{/if}
										</span>
									</div>
									<div class="flex gap-1 shrink-0">
										<Button
											variant="ghost"
											size="icon"
											title="Edit"
											onclick={() => startEdit(key)}
											disabled={isProtectedSchemaKey(key)}
										>
											<Pencil class="size-4" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											title="Delete"
											onclick={() => openDeleteConfirm(key)}
											disabled={isProtectedSchemaKey(key) || schema[key]?.removable === false}
										>
											<Trash2 class="size-4" />
										</Button>
									</div>
								</div>
							{/if}
						{/each}
					</div>
				</div>

				<Separator />

				<div class="flex flex-col gap-2">
					<h3 class="font-semibold">Add field</h3>
					<div class="flex flex-col gap-2">
						<div class="flex flex-row gap-2 items-center flex-wrap">
							<Input type="text" bind:value={addFieldName} placeholder="field_name" class="w-40" />
							<Select.Root type="single" bind:value={addFieldType}>
								<Select.Trigger class="w-28">
									{addFieldType}
								</Select.Trigger>
								<Select.Content>
									{#each FIELD_TYPES as t}
										<Select.Item value={t}>{t}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							{#if addFieldType !== 'url'}
								<Input
									type="text"
									bind:value={addDefaultValue}
									placeholder="Default value"
									class="w-32"
								/>
							{/if}
							<Button type="button" size="sm" onclick={handleAddField}>
								<Plus class="size-4" />
								Add
							</Button>
						</div>
						{#if addFieldType === 'url'}
							<div class="flex flex-col gap-2 sm:flex-row sm:items-center flex-wrap">
								<div class="flex items-center gap-2">
									<Label class="text-sm w-32 shrink-0">Default display name</Label>
									<Input
										type="text"
										bind:value={addDefaultUrlDisplayName}
										placeholder="Display name"
										class="w-48"
									/>
								</div>
								<div class="flex items-center gap-2">
									<Label class="text-sm w-24 shrink-0">Default URL</Label>
									<Input
										type="url"
										bind:value={addDefaultUrlUrl}
										placeholder="https://..."
										class="w-48"
									/>
								</div>
							</div>
						{:else if addFieldType === 'list'}
							<div class="flex flex-row gap-2 items-center">
								<Label class="text-sm w-24 shrink-0">Item type</Label>
								<Select.Root type="single" bind:value={addItemType}>
									<Select.Trigger class="w-28">
										{addItemType}
									</Select.Trigger>
									<Select.Content>
										{#each LIST_ITEM_TYPES as t}
											<Select.Item value={t}>{t}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{/if}
						{#if addFieldType === 'dropdown'}
							<div class="flex flex-row items-center gap-2">
								<Checkbox id="add-multiselect" bind:checked={addMultiselect} />
								<Label for="add-multiselect" class="text-sm font-normal cursor-pointer"
									>Multiselect</Label
								>
							</div>
							<div class="flex flex-col gap-1">
								<Label class="text-sm">Options</Label>
								<div class="flex flex-wrap gap-1">
									{#each addOptions as opt, i}
										<span
											class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-sm"
										>
											{opt}
											<button
												type="button"
												class="hover:text-destructive"
												onclick={() => removeAddOption(i)}
												aria-label="Remove option"
											>
												<X class="size-3" />
											</button>
										</span>
									{/each}
								</div>
								<div class="flex gap-2">
									<Input
										type="text"
										bind:value={addOptionInput}
										placeholder="Add option"
										onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
									/>
									<Button type="button" variant="outline" size="sm" onclick={addOption}>
										Add option
									</Button>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button type="button" onclick={() => (isOpen = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={renameConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Rename field</AlertDialog.Title>
		<AlertDialog.Description>
			Renaming will update this field across all images. This cannot be undone. Continue?
		</AlertDialog.Description>
		<div class="flex justify-end gap-2 mt-4">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button type="button" onclick={confirmRename}>Continue</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete field</AlertDialog.Title>
		<AlertDialog.Description>How do you want to remove this field?</AlertDialog.Description>
		<div class="flex flex-col gap-2 mt-4">
			<Button variant="outline" type="button" onclick={() => handleDelete(false)}>
				Remove from schema only (data becomes custom fields)
			</Button>
			<Button variant="destructive" type="button" onclick={() => handleDelete(true)}>
				Remove from schema and all images
			</Button>
			<AlertDialog.Cancel type="button" class="mt-2">Cancel</AlertDialog.Cancel>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={multiselectOffConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Turn off multiselect</AlertDialog.Title>
		<AlertDialog.Description>
			Turning off multiselect will change existing data: only the first selected option will be kept
			for each record. Continue?
		</AlertDialog.Description>
		<div class="flex justify-end gap-2 mt-4">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button type="button" onclick={() => editingKey && doSaveEdit(editingKey, editingKey)}>
				Continue
			</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={cloneDialogOpen}>
	<Dialog.Content>
		<Dialog.Title>Clone Schema</Dialog.Title>
		<Dialog.Description>
			Select a media type to clone its schema. This will overwrite the current schema entirely.
			Continue?
		</Dialog.Description>
		<div class="flex flex-col gap-4 py-4">
			<div class="flex flex-col gap-2">
				<Label for="clone-from">Clone from</Label>
				<Select.Root type="single" bind:value={cloneFromTypeId}>
					<Select.Trigger id="clone-from" class="w-full">
						{availableTypes.find((t) => t.id === cloneFromTypeId)?.displayName ??
							'Select media type'}
					</Select.Trigger>
					<Select.Content>
						{#each availableTypes as t}
							<Select.Item value={t.id}>{t.displayName}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (cloneDialogOpen = false)}>Cancel</Button>
			<Button onclick={handleCloneSchema} disabled={!cloneFromTypeId}>Clone</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={repairDialogOpen}>
	<Dialog.Content class="max-w-3xl max-h-[90vh] flex flex-col">
		<Dialog.Title>Validate & Repair Records</Dialog.Title>
		<Dialog.Description>
			Scanned all records against the current schema. Found {repairIssues.length} issue(s).
		</Dialog.Description>
		<div class="flex-1 overflow-y-auto">
			{#if repairIssues.length === 0}
				<div class="p-8 text-center text-muted-foreground border rounded-lg">
					All records are valid! No issues found.
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each repairIssues as issue}
						<div class="p-3 border rounded-lg bg-muted/30 flex flex-col gap-1 text-sm">
							<div><span class="font-semibold">Record ID:</span> {issue.id}</div>
							<div><span class="font-semibold">Field:</span> {issue.field}</div>
							<div class="text-destructive">
								<span class="font-semibold text-foreground">Issue:</span>
								{issue.issue}
							</div>
							<div>
								<span class="font-semibold">Proposed Fix:</span>
								<span class="font-mono bg-muted px-1 py-0.5 rounded text-xs"
									>{JSON.stringify(issue.fix)}</span
								>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (repairDialogOpen = false)}>Close</Button>
			{#if repairIssues.length > 0}
				<Button onclick={handleFixData} disabled={repairing}>Fix All</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
