<script lang="ts">
	import { onMount } from 'svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Plus, Pencil, Trash2, X, Link2, Link2Off } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import { fieldLabel, isProtectedSchemaKey } from '$lib/core/fieldKeys.js';
	import { fieldSupportsSuggest } from '$lib/core/types.js';
	import { isValidIsoDate } from '$lib/core/dates.js';
	import DateField from '$lib/components/DateField.svelte';
	import type { SchemaDefinition, FieldType, ListItemType } from '$lib/core/types.js';
	import type { SchemaEditorAdapter } from './types.js';
	import { apiListMediaTypes, apiGetSchemaForType } from '$lib/api/client.js';
	import { apiListClasses, apiUpdateClassField, apiClassLinkPreview } from '$lib/api/files.js';

	/**
	 * Shared schema editor body: add / edit / delete fields with full field-type support (dropdown
	 * options + multiselect, list item type, url default), driven by an injected {@link
	 * SchemaEditorAdapter}. Used by both the class schema dialog and the media-type schema editor.
	 * Renders only the editor content + its confirm dialogs; the host supplies the surrounding Dialog.
	 *
	 * @param adapter - Data layer (get/add/update/delete field + optional key ordering).
	 * @param recordNoun - What a row is called in confirmations ("record" | "image"). Default "record".
	 * @param onchanged - Called after any schema mutation so the host can refresh dependent views.
	 */
	let {
		adapter,
		recordNoun = 'record',
		onchanged
	}: {
		adapter: SchemaEditorAdapter;
		recordNoun?: string;
		onchanged?: () => void;
	} = $props();

	const FIELD_TYPES: FieldType[] = [
		'string',
		'number',
		'boolean',
		'dropdown',
		'list',
		'url',
		'file',
		'record',
		'date'
	];
	const LIST_ITEM_TYPES: ListItemType[] = ['string', 'number', 'url'];

	let schema = $state<SchemaDefinition | null>(null);
	let loading = $state(false);

	/**
	 * Selectable target record types for `record` fields — every `json` record type except the reserved
	 * `globals` singleton (which is not a navigable record collection). Loaded once on mount.
	 */
	let recordTypes = $state<{ id: string; displayName: string }[]>([]);
	const recordTypeLabel = $derived((id?: string) =>
		id ? (recordTypes.find((t) => t.id === id)?.displayName ?? id) : ''
	);

	/** Selectable classes for scoping a `file` field's picker to one class's members. Loaded on mount. */
	let classes = $state<{ id: string; displayName: string }[]>([]);
	const classLabel = $derived((id?: string) =>
		id ? (classes.find((c) => c.id === id)?.displayName ?? id) : ''
	);

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
	let addRecordType = $state('');
	let addClassId = $state('');
	let addSuggest = $state(false);

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
	let editRecordType = $state('');
	let editClassId = $state('');
	let editSuggest = $state(false);
	// Two-way relation link (record-field side, only on a class). `editLinkedField` is the chosen
	// counterpart file-field key on the target type; '' = unlinked.
	let editLinkEnabled = $state(false);
	let editLinkedField = $state('');
	/** Eligible counterpart file fields on the selected record type (scoped to this class, unlinked or ours). */
	let counterparts = $state<{ key: string; label: string }[]>([]);
	/** Link-mismatch reconcile prompt (shown only when both sides already hold conflicting data). */
	let linkPromptOpen = $state(false);
	let linkPromptCounts = $state<{ classOnly: number; typeOnly: number }>({
		classOnly: 0,
		typeOnly: 0
	});
	/** The authoritative side the user chose in the prompt; threaded to the save as `linkSync`. */
	let linkSyncStrategy = $state<'class' | 'type' | undefined>(undefined);

	/** This schema's entity identity (drives the link UI). Undefined adapters fall back to no-link. */
	const entityKind = $derived(adapter.entityKind);
	const entityId = $derived(adapter.entityId ?? '');
	/** Linking is configured only from a class's record field (the declaration side). */
	const canLink = $derived(entityKind === 'class' && editFieldType === 'record');
	/** The stored def of the field being edited (pre-edit), for the read-only file-side link badge. */
	const editStoredDef = $derived(editingKey ? schema?.[editingKey] : undefined);
	/** When editing a *type*'s linked file field, the class + record field it links back to. */
	const editFileLink = $derived.by(() => {
		const d = editStoredDef as
			| { type?: string; classId?: string; linkedField?: string }
			| undefined;
		if (entityKind === 'type' && d?.type === 'file' && d.classId && d.linkedField)
			return { classId: d.classId, recordField: d.linkedField };
		return null;
	});

	/** Unlink from the file side: clear the link declaration on the partner class's record field. */
	async function unlinkFileField(linkClassId: string, recordField: string) {
		try {
			await apiUpdateClassField(linkClassId, { fieldName: recordField, linkedField: '' });
			toast.success('Unlinked');
			await fetchSchema();
			onchanged?.();
		} catch (e) {
			console.error(e);
			toast.error('Failed to unlink');
		}
	}

	/** Whether the "Suggest existing values" toggle applies to the in-progress add form. */
	const addCanSuggest = $derived(fieldSupportsSuggest(addFieldType, [addItemType]));
	/** Whether the "Suggest existing values" toggle applies to the in-progress edit form. */
	const editCanSuggest = $derived(fieldSupportsSuggest(editFieldType, [editItemType]));

	/** `multiselect` (array vs single value) applies to dropdown, file, and record fields. */
	function canMultiselect(t: FieldType): boolean {
		return t === 'dropdown' || t === 'file' || t === 'record';
	}

	/**
	 * Load the eligible counterpart file fields for linking the edited class record field to
	 * `recordType`: file fields on the target type scoped to this class that are unlinked (or already
	 * linked to the field being edited).
	 */
	async function loadCounterparts(recordType: string, ownKey: string | null) {
		if (entityKind !== 'class' || !recordType) {
			counterparts = [];
			return;
		}
		try {
			const targetSchema = await apiGetSchemaForType(recordType);
			counterparts = Object.entries(targetSchema)
				.filter(([, d]) => {
					const def = d as { type: string; classId?: string; linkedField?: string };
					return (
						def.type === 'file' &&
						def.classId === entityId &&
						(!def.linkedField || def.linkedField === ownKey)
					);
				})
				.map(([key]) => ({ key, label: fieldLabel(key) }));
		} catch (e) {
			console.error('SchemaEditorBody: failed to load link counterparts', e);
			counterparts = [];
		}
	}

	// Reload eligible counterparts whenever the edited record field's target type changes.
	$effect(() => {
		if (canLink && editRecordType) loadCounterparts(editRecordType, editingKey);
		else counterparts = [];
	});

	let deleteConfirmOpen = $state(false);
	let deleteTargetKey = $state<string | null>(null);
	let renameConfirmOpen = $state(false);
	let renameFromKey = $state('');
	let renameToKey = $state('');

	async function fetchSchema() {
		loading = true;
		try {
			schema = await adapter.getSchema();
		} catch (e) {
			console.error(e);
			toast.error('Failed to load schema');
		} finally {
			loading = false;
		}
	}

	/** Load the selectable target record types for `record` fields (json types, excluding globals). */
	async function fetchRecordTypes() {
		try {
			const types = await apiListMediaTypes();
			recordTypes = types
				.filter((t) => t.kind === 'json' && t.id !== 'globals')
				.map((t) => ({ id: t.id, displayName: t.displayName }));
		} catch (e) {
			console.error('SchemaEditorBody: failed to load record types', e);
		}
	}

	/** Load the selectable classes for scoping `file` fields. */
	async function fetchClasses() {
		try {
			const list = await apiListClasses();
			classes = list.map((c) => ({ id: c.id, displayName: c.displayName }));
		} catch (e) {
			console.error('SchemaEditorBody: failed to load classes', e);
		}
	}

	onMount(() => {
		fetchSchema();
		fetchRecordTypes();
		fetchClasses();
	});

	/** Schema keys in display order (adapter override, else plain locale sort). */
	function getEditableSchemaKeys(s: SchemaDefinition): string[] {
		return adapter.orderKeys
			? adapter.orderKeys(s)
			: Object.keys(s).sort((a, b) => a.localeCompare(b));
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
		if (type === 'date') return isValidIsoDate(raw) ? raw : undefined;
		return raw || undefined;
	}

	async function handleAddField() {
		const name = addFieldName.trim().toLowerCase().replace(/\s+/g, '_');
		if (!name) return toast.error('Field name is required');
		if (!/^[a-z_][a-z0-9_]*$/.test(name))
			return toast.error('Field name must be snake_case (e.g. my_field)');
		if (schema && name in schema) return toast.error('Field already exists');
		if (addFieldType === 'record' && !addRecordType)
			return toast.error('Choose a record type for this field');

		try {
			await adapter.addField({
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
				multiselect: canMultiselect(addFieldType) ? addMultiselect : undefined,
				recordType: addFieldType === 'record' ? addRecordType || undefined : undefined,
				classId: addFieldType === 'file' ? addClassId || undefined : undefined,
				suggest: addCanSuggest ? addSuggest : undefined
			});
			toast.success('Field added');
			addFieldName = '';
			addDefaultValue = '';
			addDefaultUrlDisplayName = '';
			addDefaultUrlUrl = '';
			addOptions = [];
			addItemType = 'string';
			addMultiselect = false;
			addRecordType = '';
			addClassId = '';
			addSuggest = false;
			await fetchSchema();
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
		editMultiselect = canMultiselect(def.type)
			? ((def as { multiselect?: boolean }).multiselect ?? false)
			: false;
		editRecordType =
			def.type === 'record' ? ((def as { recordType?: string }).recordType ?? '') : '';
		editClassId = def.type === 'file' ? ((def as { classId?: string }).classId ?? '') : '';
		const existingLink =
			def.type === 'record' ? ((def as { linkedField?: string }).linkedField ?? '') : '';
		editLinkEnabled = !!existingLink;
		editLinkedField = existingLink;
		linkSyncStrategy = undefined;
		editSuggest = (def as { suggest?: boolean }).suggest ?? false;
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
		if (editFieldType === 'record' && !editRecordType)
			return toast.error('Choose a record type for this field');
		if (canLink && editLinkEnabled && !editLinkedField)
			return toast.error('Choose a field to link to (or turn off linking)');
		if (newName !== editingKey && isProtectedSchemaKey(editingKey))
			return toast.error('This field cannot be renamed');
		if (newName !== editingKey && schema[newName])
			return toast.error('A field with that name already exists');

		// When newly linking a field whose two sides already hold mismatched data, prompt the user to
		// pick an authoritative side before saving (so the link doesn't silently leave a mismatch).
		const originalLink = (editStoredDef as { linkedField?: string } | undefined)?.linkedField ?? '';
		if (canLink && editLinkEnabled && editLinkedField && editLinkedField !== originalLink) {
			try {
				const preview = await apiClassLinkPreview(
					entityId,
					editingKey,
					editRecordType,
					editLinkedField
				);
				if (preview.mismatch) {
					linkPromptCounts = preview;
					linkPromptOpen = true;
					return; // wait for the user's choice → onLinkSyncChoice → continueSave
				}
			} catch (e) {
				console.error('SchemaEditorBody: link preview failed', e); // fall through, link without sync
			}
		}
		await continueSave();
	}

	/** Run the rename gate (if the field is being renamed) then persist the edit. */
	async function continueSave() {
		if (!editingKey) return;
		const newName = editFieldName.trim().toLowerCase().replace(/\s+/g, '_');
		if (newName !== editingKey) {
			renameFromKey = editingKey;
			renameToKey = newName;
			renameConfirmOpen = true;
			return;
		}
		await doSaveEdit(editingKey, editingKey);
	}

	/** The user picked an authoritative side in the link-mismatch prompt; continue the save with it. */
	function onLinkSyncChoice(strategy: 'class' | 'type') {
		linkSyncStrategy = strategy;
		linkPromptOpen = false;
		continueSave();
	}

	async function doSaveEdit(oldKey: string, newKey: string) {
		try {
			await adapter.updateField({
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
				multiselect: canMultiselect(editFieldType) ? editMultiselect : undefined,
				recordType: editFieldType === 'record' ? editRecordType || undefined : undefined,
				classId: editFieldType === 'file' ? editClassId || undefined : undefined,
				// Record-field link: send the chosen counterpart, or '' to clear (unlink). The server
				// validates the counterpart and mirrors the back-link on the target type's file field.
				linkedField: canLink ? (editLinkEnabled ? editLinkedField : '') : undefined,
				// How to reconcile pre-existing data on initial linkage (set only when the prompt fired).
				linkSync: canLink && editLinkEnabled ? linkSyncStrategy : undefined,
				suggest: editCanSuggest ? editSuggest : false
			});
			toast.success('Field updated');
			editingKey = null;
			renameConfirmOpen = false;
			await fetchSchema();
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
			await adapter.deleteField(deleteTargetKey, removeFromRecords);
			toast.success(
				removeFromRecords
					? `Field removed from schema and all ${recordNoun}s`
					: 'Field removed from schema'
			);
			deleteTargetKey = null;
			deleteConfirmOpen = false;
			await fetchSchema();
			onchanged?.();
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete field');
		}
	}
</script>

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
							{:else if editFieldType === 'date'}
								<div class="flex flex-row items-center gap-2">
									<Label class="w-20 shrink-0">Default</Label>
									<DateField
										value={editDefaultValue}
										onValueChange={(v) => (editDefaultValue = v)}
									/>
								</div>
							{:else if editFieldType !== 'file' && editFieldType !== 'record'}
								<div class="flex flex-row items-center gap-2">
									<Label class="w-20 shrink-0">Default</Label>
									<Input type="text" bind:value={editDefaultValue} placeholder="Default value" />
								</div>
							{/if}
							{#if editFieldType === 'record'}
								<div class="flex flex-row items-center gap-2">
									<Label class="w-20 shrink-0">Record type</Label>
									<Select.Root type="single" bind:value={editRecordType}>
										<Select.Trigger class="w-48"
											>{recordTypeLabel(editRecordType) || 'Select type…'}</Select.Trigger
										>
										<Select.Content>
											{#each recordTypes as t (t.id)}
												<Select.Item value={t.id}>{t.displayName}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
							{/if}
							{#if editFieldType === 'file'}
								<div class="flex flex-row items-center gap-2">
									<Label class="w-20 shrink-0">Class</Label>
									<Select.Root type="single" bind:value={editClassId}>
										<Select.Trigger class="w-48"
											>{classLabel(editClassId) || 'Any file'}</Select.Trigger
										>
										<Select.Content>
											<Select.Item value="">Any file</Select.Item>
											{#each classes as c (c.id)}
												<Select.Item value={c.id}>{c.displayName}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
								</div>
							{/if}
							{#if editFileLink}
								<div
									class="flex flex-col gap-1 rounded-md border border-dashed bg-muted/40 p-2 text-sm"
								>
									<div class="flex items-center gap-1.5">
										<Link2 class="size-4 text-muted-foreground" />
										<span
											>Linked with <span class="font-medium"
												>{classLabel(editFileLink.classId)}</span
											>
											· {fieldLabel(editFileLink.recordField)}</span
										>
									</div>
									<p class="text-xs text-muted-foreground">
										Two-way relation — edits here also update the linked record field.
									</p>
									<Button
										type="button"
										variant="outline"
										size="sm"
										class="mt-1 w-fit gap-1.5"
										onclick={() =>
											editFileLink &&
											unlinkFileField(editFileLink.classId, editFileLink.recordField)}
									>
										<Link2Off class="size-3.5" /> Unlink
									</Button>
								</div>
							{/if}
							{#if editFieldType === 'file' || editFieldType === 'record'}
								<div class="flex flex-row items-center gap-2">
									<Checkbox id="edit-multiselect-ref" bind:checked={editMultiselect} />
									<Label for="edit-multiselect-ref" class="cursor-pointer text-sm font-normal"
										>Allow multiple</Label
									>
								</div>
							{/if}
							{#if canLink}
								<div class="flex flex-col gap-2 rounded-md border bg-muted/30 p-2">
									<div class="flex flex-row items-center gap-2">
										<Checkbox id="edit-link" bind:checked={editLinkEnabled} />
										<Label for="edit-link" class="cursor-pointer text-sm font-normal"
											>Link to inverse field (two-way relation)</Label
										>
									</div>
									{#if editLinkEnabled}
										{#if !editRecordType}
											<p class="text-xs text-muted-foreground">Choose a record type first.</p>
										{:else if counterparts.length === 0}
											<p class="text-xs text-muted-foreground">
												No class-scoped file field on {recordTypeLabel(editRecordType)} is available.
												Add a
												<span class="font-medium">file</span> field there scoped to this class first.
											</p>
										{:else}
											<div class="flex flex-row items-center gap-2">
												<Label class="w-20 shrink-0 text-sm">Counterpart</Label>
												<Select.Root type="single" bind:value={editLinkedField}>
													<Select.Trigger class="w-56"
														>{editLinkedField
															? fieldLabel(editLinkedField)
															: 'Select field…'}</Select.Trigger
													>
													<Select.Content>
														{#each counterparts as c (c.key)}
															<Select.Item value={c.key}>{c.label}</Select.Item>
														{/each}
													</Select.Content>
												</Select.Root>
											</div>
											<p class="text-xs text-muted-foreground">
												Edits to this field will also update the chosen field on {recordTypeLabel(
													editRecordType
												)}.
											</p>
										{/if}
									{/if}
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
							{#if editCanSuggest}
								<div class="flex flex-row items-center gap-2">
									<Checkbox id="edit-suggest" bind:checked={editSuggest} />
									<Label for="edit-suggest" class="cursor-pointer text-sm font-normal"
										>Suggest existing values</Label
									>
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
											onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addEditOption())}
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
									{:else if schema[key]?.type === 'record'}
										→ {recordTypeLabel((schema[key] as { recordType?: string }).recordType)}
										{#if (schema[key] as { multiselect?: boolean }).multiselect}(multiple){/if}
									{:else if schema[key]?.type === 'file'}
										{#if (schema[key] as { classId?: string }).classId}→ {classLabel(
												(schema[key] as { classId?: string }).classId
											)}{/if}
										{#if (schema[key] as { multiselect?: boolean }).multiselect}(multiple){/if}
									{/if}
									{#if (schema[key] as { linkedField?: string }).linkedField}
										· <Link2 class="inline size-3 align-text-bottom" />{fieldLabel(
											(schema[key] as { linkedField?: string }).linkedField!
										)}
									{/if}
									{#if (schema[key] as { suggest?: boolean }).suggest}· suggestions{/if}
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
					<p class="text-sm text-muted-foreground">No fields yet.</p>
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
				{#if addFieldType === 'date'}
					<div class="w-44">
						<DateField value={addDefaultValue} onValueChange={(v) => (addDefaultValue = v)} />
					</div>
				{:else if addFieldType !== 'url' && addFieldType !== 'file' && addFieldType !== 'record'}
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
					<Input type="url" bind:value={addDefaultUrlUrl} placeholder="https://…" class="w-48" />
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
			{#if addFieldType === 'record'}
				<div class="flex flex-row items-center gap-2">
					<Label class="w-24 shrink-0 text-sm">Record type</Label>
					<Select.Root type="single" bind:value={addRecordType}>
						<Select.Trigger class="w-48"
							>{recordTypeLabel(addRecordType) || 'Select type…'}</Select.Trigger
						>
						<Select.Content>
							{#if recordTypes.length === 0}
								<div class="px-2 py-1.5 text-sm text-muted-foreground">No record types yet</div>
							{:else}
								{#each recordTypes as t (t.id)}
									<Select.Item value={t.id}>{t.displayName}</Select.Item>
								{/each}
							{/if}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
			{#if addFieldType === 'file'}
				<div class="flex flex-row items-center gap-2">
					<Label class="w-24 shrink-0 text-sm">Class</Label>
					<Select.Root type="single" bind:value={addClassId}>
						<Select.Trigger class="w-48">{classLabel(addClassId) || 'Any file'}</Select.Trigger>
						<Select.Content>
							<Select.Item value="">Any file</Select.Item>
							{#each classes as c (c.id)}
								<Select.Item value={c.id}>{c.displayName}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}
			{#if addFieldType === 'file' || addFieldType === 'record'}
				<div class="flex flex-row items-center gap-2">
					<Checkbox id="add-multiselect-ref" bind:checked={addMultiselect} />
					<Label for="add-multiselect-ref" class="cursor-pointer text-sm font-normal"
						>Allow multiple</Label
					>
				</div>
			{/if}
			{#if addCanSuggest}
				<div class="flex flex-row items-center gap-2">
					<Checkbox id="add-suggest" bind:checked={addSuggest} />
					<Label for="add-suggest" class="cursor-pointer text-sm font-normal"
						>Suggest existing values</Label
					>
				</div>
			{/if}
			{#if addFieldType === 'dropdown'}
				<div class="flex flex-row items-center gap-2">
					<Checkbox id="add-multiselect" bind:checked={addMultiselect} />
					<Label for="add-multiselect" class="cursor-pointer text-sm font-normal">Multiselect</Label
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
						<Button type="button" variant="outline" size="sm" onclick={addOption}>Add option</Button
						>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<AlertDialog.Root bind:open={renameConfirmOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Rename field</AlertDialog.Title>
		<AlertDialog.Description>
			Renaming will update this field across all member {recordNoun}s. This cannot be undone.
			Continue?
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
				Remove from schema and all {recordNoun}s
			</Button>
			<AlertDialog.Cancel type="button" class="mt-2">Cancel</AlertDialog.Cancel>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={linkPromptOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>These fields already have mismatched data</AlertDialog.Title>
		<AlertDialog.Description>
			Linking <span class="font-medium">{fieldLabel(editingKey ?? '')}</span> and
			<span class="font-medium"
				>{recordTypeLabel(editRecordType)} · {fieldLabel(editLinkedField)}</span
			>, but they don't agree:
		</AlertDialog.Description>
		<ul class="my-2 ml-4 list-disc text-sm text-muted-foreground">
			{#if linkPromptCounts.classOnly > 0}
				<li>
					{linkPromptCounts.classOnly} reference{linkPromptCounts.classOnly === 1 ? '' : 's'} only on
					the
					<span class="font-medium">{classLabel(entityId)}</span> side
				</li>
			{/if}
			{#if linkPromptCounts.typeOnly > 0}
				<li>
					{linkPromptCounts.typeOnly} reference{linkPromptCounts.typeOnly === 1 ? '' : 's'} only on the
					<span class="font-medium">{recordTypeLabel(editRecordType)}</span> side
				</li>
			{/if}
		</ul>
		<p class="text-sm">Which side is correct? The other will be rebuilt to match.</p>
		<div class="mt-4 flex flex-col gap-2">
			<Button variant="outline" type="button" onclick={() => onLinkSyncChoice('class')}>
				Keep {classLabel(entityId)} side
			</Button>
			<Button variant="outline" type="button" onclick={() => onLinkSyncChoice('type')}>
				Keep {recordTypeLabel(editRecordType)} side
			</Button>
			<AlertDialog.Cancel type="button" class="mt-2">Cancel</AlertDialog.Cancel>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>
