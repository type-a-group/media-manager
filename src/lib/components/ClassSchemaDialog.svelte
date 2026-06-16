<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Plus, Pencil, Trash2, X } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import { fieldLabel, isProtectedSchemaKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition, FieldType, ListItemType } from '$lib/core/types.js';
	import {
		apiGetClass,
		apiAddClassField,
		apiUpdateClassField,
		apiDeleteClassField
	} from '$lib/api/files.js';

	/**
	 * Class schema editor dialog: add / edit / delete fields on one class, with full field-type
	 * support (dropdown options + multiselect, list item type, url default). Mirrors the media-type
	 * `SchemaEditorButton`, wired to the `/api/classes/[id]/schema` surface.
	 *
	 * @param classId - The class whose schema is edited.
	 * @param open - Bindable dialog open state.
	 * @param displayName - Class display name (dialog title).
	 * @param onchanged - Called after any schema mutation so callers can refresh counts/grids.
	 */
	let {
		classId,
		open = $bindable(false),
		displayName = '',
		onchanged
	}: {
		classId: string;
		open?: boolean;
		displayName?: string;
		onchanged?: () => void;
	} = $props();

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

	let deleteConfirmOpen = $state(false);
	let deleteTargetKey = $state<string | null>(null);
	let renameConfirmOpen = $state(false);
	let renameFromKey = $state('');
	let renameToKey = $state('');

	/** Fetch the class's current schema. */
	async function fetchSchema() {
		loading = true;
		try {
			const detail = await apiGetClass(classId);
			schema = detail.schema;
		} catch (e) {
			console.error(e);
			toast.error('Failed to load schema');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && classId) fetchSchema();
	});

	/** Schema keys in display order. */
	function getEditableSchemaKeys(s: SchemaDefinition): string[] {
		return Object.keys(s).sort((a, b) => a.localeCompare(b));
	}

	/** Coerce the form's string default into the typed default for the chosen field type. */
	function coerceDefault(
		type: FieldType,
		raw: string,
		urlName: string,
		urlUrl: string,
		multi: boolean
	) {
		if (type === 'number') {
			const n = Number(raw);
			return Number.isFinite(n) ? n : undefined;
		}
		if (type === 'boolean') return raw.toLowerCase() === 'true';
		if (type === 'list' || (type === 'dropdown' && multi)) {
			return raw
				? raw
						.split(',')
						.map((s) => s.trim())
						.filter(Boolean)
				: [];
		}
		if (type === 'url') return { display_name: urlName.trim(), url: urlUrl.trim() };
		return raw || undefined;
	}

	async function handleAddField() {
		const name = addFieldName.trim().toLowerCase().replace(/\s+/g, '_');
		if (!name) return toast.error('Field name is required');
		if (!/^[a-z_][a-z0-9_]*$/.test(name))
			return toast.error('Field name must be snake_case (e.g. my_field)');
		if (schema && name in schema) return toast.error('Field already exists');

		try {
			schema = await apiAddClassField(classId, {
				fieldName: name,
				fieldType: addFieldType,
				defaultValue: coerceDefault(
					addFieldType,
					addDefaultValue,
					addDefaultUrlDisplayName,
					addDefaultUrlUrl,
					addMultiselect
				),
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
			onchanged?.();
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

	function startEdit(key: string) {
		const def = schema?.[key];
		if (!def) return;
		editingKey = key;
		editFieldName = key;
		editFieldType = def.type;
		editDefaultUrlDisplayName = '';
		editDefaultUrlUrl = '';
		editOptions = def.options ?? [];
		editOptionInput = '';
		editMultiselect =
			def.type === 'dropdown' ? ((def as { multiselect?: boolean }).multiselect ?? false) : false;
		if (def.type === 'url') {
			const raw = def.defaultValue;
			if (raw != null && typeof raw === 'object' && 'url' in raw) {
				editDefaultUrlDisplayName = String((raw as { display_name?: string }).display_name ?? '');
				editDefaultUrlUrl = String((raw as { url: string }).url ?? '');
			} else {
				editDefaultUrlUrl = typeof raw === 'string' ? raw : '';
			}
			editDefaultValue = '';
		} else if (def.type === 'list') {
			editDefaultValue = Array.isArray(def.defaultValue)
				? def.defaultValue.join(', ')
				: String(def.defaultValue ?? '');
			editItemType = (def as { itemTypes?: ListItemType[] }).itemTypes?.[0] ?? 'string';
		} else {
			editDefaultValue = Array.isArray(def.defaultValue)
				? (def.defaultValue as string[]).join(', ')
				: String(def.defaultValue ?? '');
		}
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

	async function saveEdit() {
		if (!editingKey || !schema) return;
		const newName = editFieldName.trim().toLowerCase().replace(/\s+/g, '_');
		if (!newName || !/^[a-z_][a-z0-9_]*$/.test(newName))
			return toast.error('Field name must be snake_case');
		if (newName !== editingKey && isProtectedSchemaKey(editingKey))
			return toast.error('This field cannot be renamed');
		if (newName !== editingKey && schema[newName])
			return toast.error('A field with that name already exists');
		if (newName !== editingKey) {
			renameFromKey = editingKey;
			renameToKey = newName;
			renameConfirmOpen = true;
			return;
		}
		await doSaveEdit(editingKey, editingKey);
	}

	async function doSaveEdit(oldKey: string, newKey: string) {
		try {
			schema = await apiUpdateClassField(classId, {
				fieldName: oldKey,
				newFieldName: newKey !== oldKey ? newKey : undefined,
				fieldType: editFieldType,
				defaultValue: coerceDefault(
					editFieldType,
					editDefaultValue,
					editDefaultUrlDisplayName,
					editDefaultUrlUrl,
					editMultiselect
				),
				options: editFieldType === 'dropdown' ? editOptions : undefined,
				itemTypes: editFieldType === 'list' ? [editItemType] : undefined,
				multiselect: editFieldType === 'dropdown' ? editMultiselect : undefined
			});
			toast.success('Field updated');
			editingKey = null;
			renameConfirmOpen = false;
			onchanged?.();
		} catch (e) {
			console.error(e);
			toast.error('Failed to update field');
		}
	}

	async function confirmRename() {
		if (renameFromKey && renameToKey) await doSaveEdit(renameFromKey, renameToKey);
	}

	function openDeleteConfirm(key: string) {
		deleteTargetKey = key;
		deleteConfirmOpen = true;
	}

	async function handleDelete(removeFromRecords: boolean) {
		if (!deleteTargetKey) return;
		try {
			schema = await apiDeleteClassField(classId, deleteTargetKey, removeFromRecords);
			toast.success(
				removeFromRecords
					? 'Field removed from schema and all records'
					: 'Field removed from schema'
			);
			deleteTargetKey = null;
			deleteConfirmOpen = false;
			onchanged?.();
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete field');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col">
		<Dialog.Title>Schema — {displayName || classId}</Dialog.Title>
		<Dialog.Description>
			Add, edit, or remove fields for this class. A class with no fields is a valid pure tag.
		</Dialog.Description>

		<div class="flex flex-1 flex-col gap-4 overflow-y-auto py-4">
			{#if loading}
				<p class="italic text-muted-foreground">Loading…</p>
			{:else if schema}
				<div class="flex flex-col gap-2">
					<h3 class="font-semibold">Fields</h3>
					<div class="flex flex-col gap-2">
						{#each getEditableSchemaKeys(schema) as key (key)}
							{#if editingKey === key}
								<div class="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
									<div class="flex flex-row items-center gap-2">
										<Label class="w-20 shrink-0">Name</Label>
										<Input
											type="text"
											bind:value={editFieldName}
											placeholder="field_name"
											disabled={isProtectedSchemaKey(key)}
										/>
									</div>
									<div class="flex flex-row items-center gap-2">
										<Label class="w-20 shrink-0">Type</Label>
										<Select.Root type="single" bind:value={editFieldType}>
											<Select.Trigger class="w-32">{editFieldType}</Select.Trigger>
											<Select.Content>
												{#each FIELD_TYPES as t (t)}
													<Select.Item value={t}>{t}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									</div>
									{#if editFieldType === 'url'}
										<div class="flex flex-col gap-2">
											<div class="flex flex-row items-center gap-2">
												<Label class="w-20 shrink-0">Default name</Label>
												<Input
													type="text"
													bind:value={editDefaultUrlDisplayName}
													placeholder="Display name"
												/>
											</div>
											<div class="flex flex-row items-center gap-2">
												<Label class="w-20 shrink-0">Default URL</Label>
												<Input type="url" bind:value={editDefaultUrlUrl} placeholder="https://…" />
											</div>
										</div>
									{:else}
										<div class="flex flex-row items-center gap-2">
											<Label class="w-20 shrink-0">Default</Label>
											<Input
												type="text"
												bind:value={editDefaultValue}
												placeholder="Default value"
											/>
										</div>
									{/if}
									{#if editFieldType === 'list'}
										<div class="flex flex-row items-center gap-2">
											<Label class="w-24 shrink-0 text-sm">Item type</Label>
											<Select.Root type="single" bind:value={editItemType}>
												<Select.Trigger class="w-28">{editItemType}</Select.Trigger>
												<Select.Content>
													{#each LIST_ITEM_TYPES as t (t)}
														<Select.Item value={t}>{t}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										</div>
									{/if}
									{#if editFieldType === 'dropdown'}
										<div class="flex flex-row items-center gap-2">
											<Checkbox id="edit-multiselect" bind:checked={editMultiselect} />
											<Label for="edit-multiselect" class="cursor-pointer text-sm font-normal"
												>Multiselect</Label
											>
										</div>
										<div class="flex flex-col gap-1">
											<Label>Options</Label>
											<div class="flex flex-wrap gap-1">
												{#each editOptions as opt, i (opt)}
													<span
														class="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm"
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
												<Button type="button" variant="outline" size="sm" onclick={addEditOption}
													>Add</Button
												>
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
									class="flex flex-row items-center justify-between gap-2 rounded border p-2 hover:bg-muted/30"
								>
									<div class="flex min-w-0 flex-col">
										<span class="font-medium">{fieldLabel(key)}</span>
										<span class="text-xs text-muted-foreground">
											{schema[key]?.type}
											{#if schema[key]?.type === 'dropdown' && schema[key]?.options?.length}
												— {schema[key].options.join(', ')}
												{#if (schema[key] as { multiselect?: boolean }).multiselect}(multiselect){/if}
											{:else if schema[key]?.type === 'list' && (schema[key] as { itemTypes?: ListItemType[] }).itemTypes?.length}
												— {(schema[key] as { itemTypes: ListItemType[] }).itemTypes[0]}
											{/if}
										</span>
									</div>
									<div class="flex shrink-0 gap-1">
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
						{#if getEditableSchemaKeys(schema).length === 0}
							<p class="text-sm text-muted-foreground">No fields yet — this class is a pure tag.</p>
						{/if}
					</div>
				</div>

				<Separator />

				<div class="flex flex-col gap-2">
					<h3 class="font-semibold">Add field</h3>
					<div class="flex flex-row flex-wrap items-center gap-2">
						<Input type="text" bind:value={addFieldName} placeholder="field_name" class="w-40" />
						<Select.Root type="single" bind:value={addFieldType}>
							<Select.Trigger class="w-28">{addFieldType}</Select.Trigger>
							<Select.Content>
								{#each FIELD_TYPES as t (t)}
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
							<Plus class="size-4" /> Add
						</Button>
					</div>
					{#if addFieldType === 'url'}
						<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
							<Input
								type="text"
								bind:value={addDefaultUrlDisplayName}
								placeholder="Default display name"
								class="w-48"
							/>
							<Input
								type="url"
								bind:value={addDefaultUrlUrl}
								placeholder="https://…"
								class="w-48"
							/>
						</div>
					{:else if addFieldType === 'list'}
						<div class="flex flex-row items-center gap-2">
							<Label class="w-24 shrink-0 text-sm">Item type</Label>
							<Select.Root type="single" bind:value={addItemType}>
								<Select.Trigger class="w-28">{addItemType}</Select.Trigger>
								<Select.Content>
									{#each LIST_ITEM_TYPES as t (t)}
										<Select.Item value={t}>{t}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}
					{#if addFieldType === 'dropdown'}
						<div class="flex flex-row items-center gap-2">
							<Checkbox id="add-multiselect" bind:checked={addMultiselect} />
							<Label for="add-multiselect" class="cursor-pointer text-sm font-normal"
								>Multiselect</Label
							>
						</div>
						<div class="flex flex-col gap-1">
							<Label class="text-sm">Options</Label>
							<div class="flex flex-wrap gap-1">
								{#each addOptions as opt, i (opt)}
									<span class="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-sm">
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
								<Button type="button" variant="outline" size="sm" onclick={addOption}
									>Add option</Button
								>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<Dialog.Footer>
			<Button type="button" onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={renameConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Rename field</AlertDialog.Title>
		<AlertDialog.Description>
			Renaming will update this field across all member records. This cannot be undone. Continue?
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button type="button" onclick={confirmRename}>Continue</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete field</AlertDialog.Title>
		<AlertDialog.Description>How do you want to remove this field?</AlertDialog.Description>
		<div class="mt-4 flex flex-col gap-2">
			<Button variant="outline" type="button" onclick={() => handleDelete(false)}>
				Remove from schema only (data becomes custom fields)
			</Button>
			<Button variant="destructive" type="button" onclick={() => handleDelete(true)}>
				Remove from schema and all records
			</Button>
			<AlertDialog.Cancel type="button" class="mt-2">Cancel</AlertDialog.Cancel>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>
