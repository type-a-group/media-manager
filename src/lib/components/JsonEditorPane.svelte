<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { ChevronLeft, ChevronRight, Trash2, X, TriangleAlert } from 'lucide-svelte';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import JsonRecordGrid from '$lib/components/JsonRecordGrid.svelte';
	import FilePicker from '$lib/components/FilePicker.svelte';
	import { autogrow, blurSaveOnEnter } from '$lib/actions/autogrow.js';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { normalizeUrlValue } from '$lib/core/types.js';
	import {
		apiGetSchemaForType,
		apiGetRecordByIdForType,
		apiUpdatePropertiesByIdForType,
		apiDeleteRecordForType,
		apiGetSettingsForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { useSelection } from '$lib/state/selection.svelte';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';

	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);
	const selection = useSelection();

	let schema = $state<SchemaDefinition | null>(null);
	let record = $state<Record<string, unknown> | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let deleteOpen = $state(false);
	let formValues = $state<Record<string, unknown>>({});
	let lastSavedPatch = $state<Record<string, unknown>>({});
	let newListItemValues = $state<Record<string, string>>({});
	let newListItemUrlDisplayName = $state<Record<string, string>>({});
	let newListItemUrlUrl = $state<Record<string, string>>({});

	/**
	 * Returns display text for a list item (string, number, or url object).
	 * For url objects, shows both display name and URL (e.g. "Label (https://...)") when present.
	 */
	function listItemDisplayText(item: unknown): string {
		if (item != null && typeof item === 'object' && 'url' in (item as object)) {
			const o = item as { display_name?: string; url?: string };
			const name = (o.display_name ?? '').trim();
			const url = (o.url ?? '').trim();
			if (name && url) return `${name} (${url})`;
			if (url) return url;
			return name || '';
		}
		return String(item);
	}

	function addListItem(key: string) {
		const itemType =
			(schema?.[key] as { itemTypes?: ('string' | 'number' | 'url')[] })?.itemTypes?.[0] ??
			'string';
		const arr = [...(Array.isArray(formValues[key]) ? (formValues[key] as unknown[]) : [])];
		let value: string | number | { display_name: string; url: string };
		if (itemType === 'url') {
			value = {
				display_name: (newListItemUrlDisplayName[key] ?? '').trim(),
				url: (newListItemUrlUrl[key] ?? '').trim()
			};
			if (!value.url) return;
			newListItemUrlDisplayName = { ...newListItemUrlDisplayName, [key]: '' };
			newListItemUrlUrl = { ...newListItemUrlUrl, [key]: '' };
		} else if (itemType === 'number') {
			const v = (newListItemValues[key] ?? '').trim();
			const n = Number(v);
			if (v === '' || !Number.isFinite(n)) return;
			value = n;
		} else {
			const v = (newListItemValues[key] ?? '').trim();
			if (!v) return;
			value = v;
		}
		arr.push(value);
		formValues = { ...formValues, [key]: arr };
		if (itemType !== 'url') newListItemValues = { ...newListItemValues, [key]: '' };
	}

	/** Ordered editable keys (name first for JSON list/editor display). */
	function getOrderedEditableKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'name');
		return keys.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
	}

	function initFormValues(s: SchemaDefinition, rec: Record<string, unknown> | null) {
		const next: Record<string, unknown> = {};
		for (const key of getOrderedEditableKeys(s)) {
			const def = s[key];
			const type = def?.type;
			let value: unknown =
				rec?.[key] ??
				def?.defaultValue ??
				(type === 'boolean'
					? false
					: type === 'number'
						? 0
						: type === 'dropdown'
							? (def as { multiselect?: boolean }).multiselect
								? []
								: (def?.options?.[0] ?? '')
							: type === 'list'
								? []
								: type === 'url'
									? { display_name: '', url: '' }
									: '');
			if (type === 'url') value = normalizeUrlValue(value);
			if (type === 'dropdown' && (def as { multiselect?: boolean }).multiselect) {
				value = Array.isArray(value)
					? value
					: typeof value === 'string' && value !== ''
						? [value]
						: [];
			}
			next[key] = type === 'number' ? String(value ?? '') : value;
		}
		formValues = next;
	}

	function buildPatch(): Record<string, unknown> {
		if (!schema) return {};
		const patch: Record<string, unknown> = {};
		for (const key of getOrderedEditableKeys(schema)) {
			const def = schema[key];
			const current = formValues[key];
			if (def?.type === 'number') {
				const n = Number(current);
				patch[key] = Number.isNaN(n) ? 0 : n;
			} else if (def?.type === 'url') {
				const urlVal =
					current != null && typeof current === 'object' && 'url' in (current as object)
						? (current as { display_name?: string; url?: string })
						: normalizeUrlValue(current);
				patch[key] = { display_name: urlVal.display_name ?? '', url: urlVal.url ?? '' };
			} else {
				patch[key] = current;
			}
		}
		return patch;
	}

	const isDirty = $derived(
		schema !== null &&
			record !== null &&
			JSON.stringify(buildPatch()) !== JSON.stringify(lastSavedPatch)
	);

	async function refresh() {
		if (!typeId || !selection.selectedImageId) {
			schema = null;
			record = null;
			return;
		}
		loading = true;
		try {
			const [s, r] = await Promise.all([
				apiGetSchemaForType(typeId),
				apiGetRecordByIdForType(typeId, selection.selectedImageId)
			]);
			schema = s;
			record = r as Record<string, unknown>;
			initFormValues(s, record);
			lastSavedPatch = buildPatch();
		} catch (e) {
			console.error(e);
			toast.error('Failed to load record');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const _id = selection.selectedImageId;
		const _t = typeId;
		if (typeId) refresh();
	});

	/**
	 * Register save-before-navigate: when user selects another record (sidebar or grid),
	 * save current edits first if autoSaveOnAdvance is on and form is dirty.
	 */
	$effect(() => {
		const unregister = selection.registerBeforeSelectAnother(async () => {
			if (!typeId) return;
			try {
				const s = await apiGetSettingsForType(typeId);
				if (s.autoSaveOnAdvance && isDirty) await save();
			} catch {
				// Proceed without saving if settings fetch fails
			}
		});
		return () => unregister();
	});

	async function save() {
		if (!typeId || !selection.selectedImageId || !schema) return;
		saving = true;
		try {
			const updated = await apiUpdatePropertiesByIdForType(
				typeId,
				selection.selectedImageId,
				buildPatch()
			);
			record = updated as Record<string, unknown>;
			initFormValues(schema, record);
			lastSavedPatch = buildPatch();
			toast.success('Saved');
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Failed to save');
		} finally {
			saving = false;
		}
	}

	async function deleteRecord() {
		if (!typeId || !selection.selectedImageId) return;
		try {
			await apiDeleteRecordForType(typeId, selection.selectedImageId);
			selection.selectImage(null);
			toast.success('Deleted');
			triggerImageListRefresh();
			deleteOpen = false;
		} catch (e) {
			console.error(e);
			toast.error('Failed to delete');
		}
	}

	/**
	 * Navigate to previous/next record. If autoSaveOnAdvance is enabled and there are unsaved changes, saves first.
	 */
	async function navigate(direction: 'prev' | 'next') {
		if (typeId && isDirty) {
			try {
				const s = await apiGetSettingsForType(typeId);
				if (s.autoSaveOnAdvance) await save();
			} catch {
				// Proceed with navigation even if settings fetch fails
			}
		}
		const ids = selection.visibleImageIds;
		const idx = ids.indexOf(selection.selectedImageId!);
		if (direction === 'prev' && idx > 0) selection.selectImage(ids[idx - 1]);
		if (direction === 'next' && idx >= 0 && idx < ids.length - 1)
			selection.selectImage(ids[idx + 1]);
	}
</script>

{#if selection.gridViewActive}
	<JsonRecordGrid />
{:else if !selection.selectedImageId}
	<div class="flex flex-col items-center justify-center h-full w-full p-8 gap-4">
		<p class="text-base text-muted-foreground text-center italic">
			Select a record from the sidebar or use New record in the sidebar.
		</p>
	</div>
{:else}
	<div class="flex flex-col h-dvh w-full">
		<div class="flex flex-wrap gap-2 p-3 border-b border-border shrink-0">
			<Button
				variant="secondary"
				size="icon"
				onclick={() => navigate('prev')}
				disabled={selection.visibleImageIds.indexOf(selection.selectedImageId) <= 0 || saving}
			>
				<ChevronLeft />
			</Button>
			<Button
				variant="secondary"
				size="icon"
				onclick={() => navigate('next')}
				disabled={saving ||
					selection.visibleImageIds.indexOf(selection.selectedImageId) === -1 ||
					selection.visibleImageIds.indexOf(selection.selectedImageId) >=
						selection.visibleImageIds.length - 1}
			>
				<ChevronRight />
			</Button>
			<Button variant="outline" onclick={save} disabled={saving || loading || !isDirty}>
				{saving ? 'Saving…' : 'Save'}
			</Button>
			<AlertDialog.Root bind:open={deleteOpen}>
				<AlertDialog.Trigger>
					<Button variant="destructive" size="icon" aria-label="Delete">
						<Trash2 class="h-4 w-4" />
					</Button>
				</AlertDialog.Trigger>
				<AlertDialog.Content>
					<AlertDialog.Title>Delete record</AlertDialog.Title>
					<AlertDialog.Description
						>Remove this record? This cannot be undone.</AlertDialog.Description
					>
					<div class="flex justify-end gap-2 mt-4">
						<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
						<Button variant="destructive" type="button" onclick={deleteRecord}>Delete</Button>
					</div>
				</AlertDialog.Content>
			</AlertDialog.Root>
		</div>
		<div class="flex-1 overflow-y-auto p-4">
			{#if loading}
				<p class="italic">Loading…</p>
			{:else if schema}
				<Card.Root>
					<Card.Content class="pt-4">
						<div class="flex flex-col gap-4">
							{#each getOrderedEditableKeys(schema) as key (key)}
								{@const def = schema[key]}
								{@const type = def?.type ?? 'string'}
								<div class="flex flex-col gap-2">
									<Label for={key}>{fieldLabel(key)}</Label>
									{#if type === 'boolean'}
										<div class="flex items-center gap-2">
											<Checkbox
												id={key}
												checked={!!formValues[key]}
												onCheckedChange={(c) => (formValues = { ...formValues, [key]: !!c })}
											/>
										</div>
									{:else if type === 'number'}
										<Input
											id={key}
											type="number"
											value={formValues[key] ?? ''}
											oninput={(e) =>
												(formValues = {
													...formValues,
													[key]: (e.currentTarget as HTMLInputElement).valueAsNumber ?? 0
												})}
										/>
									{:else if type === 'dropdown' && def?.options?.length}
										{#if (def as { multiselect?: boolean }).multiselect}
											<Select.Root
												type="multiple"
												value={(formValues[key] ?? []) as string[]}
												onValueChange={(v) => (formValues = { ...formValues, [key]: v ?? [] })}
											>
												<Select.Trigger id={key} class="w-full">
													{((formValues[key] ?? []) as string[]).length === 0
														? '(none)'
														: ((formValues[key] ?? []) as string[]).join(', ')}
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
												value={String(formValues[key] ?? '')}
												onValueChange={(v) => (formValues = { ...formValues, [key]: v ?? '' })}
											>
												<Select.Trigger id={key} class="w-full">
													{String(formValues[key] ?? '') || 'Select…'}
												</Select.Trigger>
												<Select.Content>
													{#each def.options ?? [] as opt}
														<Select.Item value={opt}>{opt}</Select.Item>
													{/each}
												</Select.Content>
											</Select.Root>
										{/if}
									{:else if type === 'list'}
										{@const itemType =
											(def as { itemTypes?: ('string' | 'number' | 'url')[] })?.itemTypes?.[0] ??
											'string'}
										<div class="flex flex-col gap-2">
											<div class="flex flex-wrap gap-1">
												{#each Array.isArray(formValues[key]) ? (formValues[key] as unknown[]) : [] as item, i}
													<span
														class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-sm"
													>
														{listItemDisplayText(item)}
														<button
															type="button"
															class="hover:text-destructive"
															onclick={() => {
																const arr = [...(formValues[key] as unknown[])];
																arr.splice(i, 1);
																formValues = { ...formValues, [key]: arr };
															}}
															aria-label="Remove item"
														>
															<X class="size-3" />
														</button>
													</span>
												{/each}
											</div>
											<div class="flex flex-wrap gap-2 items-end">
												{#if itemType === 'url'}
													<Input
														type="text"
														placeholder="Display name"
														value={newListItemUrlDisplayName[key] ?? ''}
														oninput={(e) => {
															newListItemUrlDisplayName = {
																...newListItemUrlDisplayName,
																[key]: (e.target as HTMLInputElement).value
															};
														}}
														class="w-32"
													/>
													<Input
														type="url"
														placeholder="https://..."
														value={newListItemUrlUrl[key] ?? ''}
														oninput={(e) => {
															newListItemUrlUrl = {
																...newListItemUrlUrl,
																[key]: (e.target as HTMLInputElement).value
															};
														}}
														onkeydown={(e) => {
															if (e.key === 'Enter') {
																e.preventDefault();
																addListItem(key);
															}
														}}
														class="flex-1 min-w-0"
													/>
												{:else}
													<Input
														type={itemType === 'number' ? 'number' : 'text'}
														placeholder="Add item"
														value={newListItemValues[key] ?? ''}
														oninput={(e) => {
															newListItemValues = {
																...newListItemValues,
																[key]: (e.target as HTMLInputElement).value
															};
														}}
														onkeydown={(e) => {
															if (e.key === 'Enter') {
																e.preventDefault();
																addListItem(key);
															}
														}}
														class="flex-1 min-w-0"
													/>
												{/if}
												<Button
													type="button"
													variant="outline"
													size="sm"
													onclick={() => addListItem(key)}
												>
													Add
												</Button>
											</div>
										</div>
									{:else if type === 'url'}
										{@const urlObj =
											formValues[key] != null &&
											typeof formValues[key] === 'object' &&
											'url' in (formValues[key] as object)
												? (formValues[key] as { display_name?: string; url?: string })
												: { display_name: '', url: '' }}
										<div class="flex flex-col gap-2">
											<Input
												id={key + '-display'}
												type="text"
												placeholder="Display name"
												value={urlObj.display_name ?? ''}
												oninput={(e) => {
													const v = (e.currentTarget as HTMLInputElement).value;
													formValues = { ...formValues, [key]: { ...urlObj, display_name: v } };
												}}
											/>
											<Input
												id={key}
												type="url"
												placeholder="https://..."
												value={urlObj.url ?? ''}
												oninput={(e) => {
													const v = (e.currentTarget as HTMLInputElement).value;
													formValues = { ...formValues, [key]: { ...urlObj, url: v } };
												}}
											/>
										</div>
									{:else if type === 'file'}
										{@const missingName = (record as Record<string, any>)?._missing_files?.[key]}
										{@const isMissing =
											missingName !== undefined &&
											formValues[key] === (record as Record<string, any>)?.[key]}
										<div class="flex flex-col gap-1 w-full">
											<FilePicker
												value={formValues[key] as string}
												onSelect={(id) => (formValues[key] = id)}
											/>
											{#if isMissing}
												<div class="flex items-center justify-between gap-2 mt-1">
													<span class="text-xs text-destructive flex items-center gap-1">
														<TriangleAlert class="h-3 w-3 shrink-0" />
														{missingName
															? `Missing file: ${missingName}`
															: 'File not found on disk'}
													</span>
													<Button
														variant="ghost"
														size="sm"
														class="h-6 px-2 text-xs"
														onclick={() => (formValues[key] = '')}
													>
														Clear
													</Button>
												</div>
											{/if}
										</div>
									{:else}
										<textarea
											id={key}
											rows="1"
											use:autogrow={formValues[key]}
											onkeydown={(e) => blurSaveOnEnter(e, save)}
											class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
											value={String(formValues[key] ?? '')}
											oninput={(e) =>
												(formValues = {
													...formValues,
													[key]: (e.currentTarget as HTMLTextAreaElement).value
												})}
										></textarea>
									{/if}
								</div>
							{/each}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	</div>
{/if}
