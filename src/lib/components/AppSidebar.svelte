<script lang="ts">
	import { onMount } from 'svelte';
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { Input } from '$lib/components/ui/sidebar/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { ChevronsUpDownIcon, Home, LayoutGrid, Plus, RefreshCwIcon, UploadIcon } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as HoverCard from '$lib/components/ui/hover-card/index.js';
	import { toast } from 'svelte-sonner';
	import SettingsButton from './SettingsButton.svelte';
	import SchemaEditorButton from './SchemaEditorButton.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { TOOLTIP_DELAY_MS } from '$lib/utils.js';
	import type { ImageId } from '$lib/core/ids.js';
	import type { ImageListItem, SchemaDefinition } from '$lib/core/types.js';
	import {
		getOperatorsForFieldType,
		OPERATOR_LABELS,
		VALUE_LESS_OPERATORS,
		OPERATORS,
		type OperatorId
	} from '$lib/core/filters.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import {
		apiCreateRecordForType,
		apiGetConfig,
		apiGetMediaType,
		apiGetSchemaForType,
		apiImageUrlByIdForType,
		apiListRecordsForType,
		apiUploadImageForType,
		apiCheckUploadConflictsForType,
		apiUploadImageForTypeWithResolution,
		type AppConfig
	} from '$lib/api/client.js';
	import { refreshTrigger, schemaRefreshTrigger } from '$lib/stores/refreshTrigger.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { ALLOWED_IMAGE_MIME_TYPES } from '$lib/core/images.js';
	import { isUserFieldKey } from '$lib/core/fieldKeys.js';
	import { useSelection } from '$lib/state/selection.svelte';

	let imageLists = $state<{ linked: ImageListItem[]; unlinked: ImageListItem[] }>({
		linked: [],
		unlinked: []
	});
	let loading = $state(true);

	// NOTE: This is a class instance; do not destructure it or you’ll capture initial values.
	const selection = useSelection();

	let { collapsed = $bindable() } = $props();

	/** Multi-filter rows: field, operator, optional value; enabled (default true) toggles whether the filter is applied. */
	type FilterRow = { field: string; operator: string; value?: string | number | boolean; enabled?: boolean };
	let filters = $state<FilterRow[]>([]);
	let schema = $state<SchemaDefinition | null>(null);
	let schemaFields = $state<string[]>([]);
	let config = $state<AppConfig | null>(null);

	/** Current media type from store (set by /media/[typeId] page). */
	const currentMediaType = $derived($currentMediaTypeStore);
	const typeId = $derived(currentMediaType?.typeId ?? null);
	const kind = $derived(currentMediaType?.kind ?? 'images');

	// This will hold the list items actually displayed in the sidebar
	let displayedItems = $state<ImageListItem[]>([]);
	
	// Upload-related state variables
	let fileInput: HTMLInputElement | undefined; // Reference to hidden file input (multiple files)
	let folderInput: HTMLInputElement | undefined; // Reference to hidden folder input (webkitdirectory)
	let uploading = $state(false); // Track upload status

	// Upload conflict dialog state
	let uploadConflictFile = $state<File | null>(null);
	let uploadConflictOpen = $state(false);
	let uploadConflictResolve = $state<((resolution: 'overwrite' | 'auto-rename' | 'skip') => void) | null>(null);

	// HEIC conversion warning dialog state
	let heicWarningOpen = $state(false);
	let heicWarningCount = $state(0);
	let heicWarningResolve = $state<((proceed: boolean) => void) | null>(null);

	// Removed liked/unliked functionality as those fields don't exist

	/**
	 * Fetch runtime config (e.g. active images directory or media type info).
	 */
	async function fetchConfig() {
		if (!typeId) return;
		try {
			const info = await apiGetMediaType(typeId);
			config = { imagesDir: info.filesDir ?? info.baseDir ?? '', baseDir: info.baseDir };
		} catch (error) {
			console.error('Error fetching config:', error);
		}
	}

	/**
	 * Fetches the schema from the API and updates schemaFields for filter field dropdowns.
	 * Full schema is stored for operator/value type-aware UI.
	 */
	async function fetchSchema() {
		if (!typeId) return;
		try {
			const s = await apiGetSchemaForType(typeId);
			schema = s;
			schemaFields = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'image_name' || k === 'name');
			await fetchImageLists();
		} catch (error) {
			console.error('Error fetching schema:', error);
		}
	}

	/**
	 * Gets the display name for a list item.
	 * Images: image_name or file_name. Json: name, then group_by_value, then short id.
	 */
	function getDisplayName(item: ImageListItem & { name?: string; group_by_value?: string | number | boolean | string[] | null }): string {
		const imageName = (item as ImageListItem).image_name?.trim();
		if (imageName && imageName.length > 0) return imageName;
		const jsonName = (item as { name?: string }).name?.trim();
		if (jsonName && jsonName.length > 0) return jsonName;
		if ('file_name' in item && item.file_name) return item.file_name;
		if (item.group_by_value != null && item.group_by_value !== '') return String(item.group_by_value);
		return (item.id as string).slice(0, 8);
	}

	// Removed isImageLiked function as liked field doesn't exist

	/**
	 * Builds API filter clauses from UI filter rows: only enabled rows with field and operator set;
	 * value omitted for is_empty / is_not_empty.
	 */
	function buildFiltersForApi(): { field: string; operator: string; value?: string | number | boolean }[] {
		return filters
			.filter((row) => (row.enabled !== false) && row.field && row.operator)
			.map((row) => {
				const omitValue = VALUE_LESS_OPERATORS.has(row.operator);
				return {
					field: row.field,
					operator: row.operator,
					...(omitValue ? {} : { value: row.value })
				};
			});
	}

	/**
	 * Fetches record lists based on current multi-filter state.
	 * For images: linked/unlinked. For json: single records list.
	 */
	async function fetchImageLists() {
		if (!typeId) return;
		loading = true;
		try {
			const apiFilters = buildFiltersForApi();
			const data = await apiListRecordsForType(typeId, {
				...(apiFilters.length > 0 ? { filters: apiFilters } : {}),
				groupBy: selection.gridGroupByField ?? undefined
			});
			if ('linked' in data) {
				imageLists = { linked: data.linked, unlinked: data.unlinked };
			} else {
				// JsonListResponse: single list
				imageLists = { linked: data.records as ImageListItem[], unlinked: [] };
			}
			updateDisplayedItems();
		} catch (error) {
			console.error('Error fetching lists:', error);
		}
		loading = false;
	}

	/**
	 * Updates the displayed list based on current view mode.
	 * Also updates the shared `visibleImageIds` state for navigation.
	 */
	function updateDisplayedItems() {
		displayedItems = selection.viewMode === 'linked' ? imageLists.linked : imageLists.unlinked;
		selection.setVisibleImageIds(displayedItems.map((i) => i.id));
		selection.setVisibleImageItems(displayedItems);
	}

	// When view changes, update displayed list + shared navigation IDs.
	$effect(() => {
		updateDisplayedItems();
	});

	$effect(() => {
		if (typeId) {
			fetchConfig();
			fetchSchema();
		}
	});

	$effect(() => {
		const _t = typeId;
		const _filters = filters;
		const _groupBy = selection.gridGroupByField;
		if (typeId) fetchImageLists();
	});

	$effect(() => {
		let prev = 0;
		const unsub = refreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				fetchImageLists();
			}
		});
		return unsub;
	});

	$effect(() => {
		let prev = 0;
		const unsub = schemaRefreshTrigger.subscribe((n) => {
			if (n !== prev) {
				prev = n;
				fetchSchema();
			}
		});
		return unsub;
	});

	/**
	 * Triggers the hidden file or folder input to open selection dialog.
	 *
	 * @param mode - 'files' for multiple file(s), 'folder' for folder (webkitdirectory)
	 */
	function triggerUpload(mode: 'files' | 'folder') {
		if (mode === 'files' && fileInput) fileInput.click();
		else if (mode === 'folder' && folderInput) folderInput.click();
	}

	/** HEIC/HEIF MIME types. */
	const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

	/** Check if a file is HEIC/HEIF. */
	function isHeicFile(f: File): boolean {
		if (HEIC_MIME_TYPES.includes(f.type.toLowerCase())) return true;
		const ext = f.name.toLowerCase().split('.').pop();
		return ext === 'heic' || ext === 'heif';
	}

	/** Wait for user to resolve a filename conflict. */
	function waitForConflictResolution(file: File): Promise<'overwrite' | 'auto-rename' | 'skip'> {
		return new Promise((resolve) => {
			uploadConflictFile = file;
			uploadConflictResolve = resolve;
			uploadConflictOpen = true;
		});
	}

	/** Resolve a filename conflict from the dialog. */
	function resolveConflict(resolution: 'overwrite' | 'auto-rename' | 'skip') {
		uploadConflictOpen = false;
		uploadConflictFile = null;
		uploadConflictResolve?.(resolution);
		uploadConflictResolve = null;
	}

	/** Wait for user to confirm HEIC conversion. */
	function waitForHeicConfirmation(count: number): Promise<boolean> {
		return new Promise((resolve) => {
			heicWarningCount = count;
			heicWarningResolve = resolve;
			heicWarningOpen = true;
		});
	}

	/** Resolve the HEIC warning dialog. */
	function resolveHeicWarning(proceed: boolean) {
		heicWarningOpen = false;
		heicWarningResolve?.(proceed);
		heicWarningResolve = null;
	}

	/**
	 * Handles file(s) or folder upload after user selects.
	 * Validates each file type, checks for conflicts and HEIC files,
	 * uploads each to the server, refreshes list once.
	 *
	 * @param event - change event from the file input
	 */
	async function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (!files?.length) return;

		const allowed = ALLOWED_IMAGE_MIME_TYPES as readonly string[];
		const toUpload: File[] = [];
		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			if (allowed.includes(f.type) || isHeicFile(f)) toUpload.push(f);
		}
		if (toUpload.length === 0) {
			toast('Error: Please select valid image files (JPEG, PNG, GIF, SVG, WebP, or HEIC)');
			target.value = '';
			return;
		}
		if (toUpload.length < files.length) {
			toast(`Skipped ${files.length - toUpload.length} non-image file(s).`);
		}

		// Check for HEIC files and warn
		const heicFiles = toUpload.filter(isHeicFile);
		if (heicFiles.length > 0) {
			const proceed = await waitForHeicConfirmation(heicFiles.length);
			if (!proceed) {
				// Remove HEIC files from the upload list
				const heicSet = new Set(heicFiles);
				const remaining = toUpload.filter((f) => !heicSet.has(f));
				if (remaining.length === 0) {
					target.value = '';
					return;
				}
				toUpload.length = 0;
				toUpload.push(...remaining);
			}
		}

		uploading = true;
		let ok = 0;
		let fail = 0;
		let skipped = 0;
		let lastUploadedId: ImageId | null = null;

		try {
			// Check for filename conflicts
			let conflictSet = new Set<string>();
			if (typeId) {
				const filenames = toUpload.map((f) => {
					// For HEIC files, the server will rename to .jpg
					if (isHeicFile(f)) {
						const base = f.name.replace(/\.[^.]+$/, '');
						return `${base}.jpg`;
					}
					return f.name;
				});
				try {
					const { conflicts } = await apiCheckUploadConflictsForType(typeId, filenames);
					conflictSet = new Set(conflicts);
				} catch {
					// If conflict check fails, proceed without it
				}
			}

			for (const file of toUpload) {
				const effectiveName = isHeicFile(file)
					? `${file.name.replace(/\.[^.]+$/, '')}.jpg`
					: file.name;

				let resolution: 'overwrite' | 'auto-rename' | null = null;
				if (conflictSet.has(effectiveName)) {
					const choice = await waitForConflictResolution(file);
					if (choice === 'skip') {
						skipped++;
						continue;
					}
					resolution = choice;
				}

				try {
					const result = typeId
						? resolution
							? await apiUploadImageForTypeWithResolution(typeId, file, resolution)
							: await apiUploadImageForType(typeId, file)
						: await Promise.reject(new Error('No media type'));
					if (result?.id) {
						ok++;
						lastUploadedId = result.id;
					} else fail++;
				} catch {
					fail++;
				}
			}
			await fetchImageLists();
			if (ok > 0 && lastUploadedId) {
				selection.setViewMode('unlinked');
				selection.selectImage(lastUploadedId);
			}
			const parts: string[] = [];
			if (ok > 0) parts.push(`Uploaded ${ok} image(s)`);
			if (fail > 0) parts.push(`${fail} failed`);
			if (skipped > 0) parts.push(`${skipped} skipped`);
			if (parts.length > 0) toast(parts.join('; '));
		} catch (error) {
			console.error('Upload error:', error);
			toast('Upload failed');
		} finally {
			uploading = false;
			target.value = '';
		}
	}

	/**
	 * Resolves schema field type for a field key. image_name and unknown keys default to 'string'.
	 */
	function getFieldTypeForField(fieldKey: string): 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url' {
		if (!schema) return 'string';
		const def = schema[fieldKey];
		if (def?.type) return def.type as 'string' | 'number' | 'boolean' | 'dropdown' | 'list' | 'url';
		return 'string';
	}

	/** Returns operator IDs for the given field key (used for operator dropdown). */
	function operatorsForField(fieldKey: string): OperatorId[] {
		return getOperatorsForFieldType(getFieldTypeForField(fieldKey));
	}

	/** Adds a new filter row with default field and operator. */
	function addFilter() {
		const field = schemaFields[0] ?? (kind === 'json' ? 'name' : 'image_name');
		const ops = operatorsForField(field);
		filters = [...filters, { field, operator: ops[0] ?? OPERATORS.contains, value: '', enabled: true }];
	}

	/** Removes the filter row at index. */
	function removeFilter(index: number) {
		filters = filters.filter((_, i) => i !== index);
	}

	/** Clears all filter rows. */
	function clearAllFilters() {
		filters = [];
	}

	/** When field changes on a row, reset operator to first valid and clear value if needed. */
	function onFilterFieldChange(index: number, newField: string) {
		const ops = operatorsForField(newField);
		const newOp = ops[0] ?? OPERATORS.contains;
		filters = filters.map((row, i) =>
			i === index ? { ...row, field: newField, operator: newOp, value: row.value } : row
		);
	}

	/** When operator changes, clear value for value-less operators. */
	function onFilterOperatorChange(index: number, newOperator: string) {
		filters = filters.map((row, i) =>
			i === index
				? { ...row, operator: newOperator, value: VALUE_LESS_OPERATORS.has(newOperator) ? undefined : row.value }
				: row
		);
	}

	/**
	 * Manually refreshes the image lists using the current filters and view.
	 * Use case: Triggered by the Sync button in the Filters section to reload files and listings.
	 *
	 * Future improvements:
	 * - Optionally re-fetch schema while preserving the selected field if it still exists.
	 * - Add visual loading indicator on the button itself.
	 */
	async function syncImageLists() {
		await fetchImageLists();
	}

	async function openImage(item: ImageListItem) {
		await selection.setGridViewActive(false);
		selection.selectImage(item.id);
	}

	/**
	 * Create a new JSON record (JSON media type only). Refreshes list then selects the new record
	 * so the list and selection stay in sync and the editor can load the record without racing.
	 */
	async function createRecord() {
		if (!typeId || kind !== 'json') return;
		try {
			const created = await apiCreateRecordForType(typeId);
			// Await list refresh so the new record is in displayedItems before we select (avoids race where GET by id fails or UI is stale).
			await fetchImageLists();
			selection.selectImage(created.id);
		} catch (e) {
			console.error(e);
			toast.error('Failed to create record');
		}
	}

	/**
	 * Toggle grid view. When entering grid view, runs save-before-navigate hook then clears selection and multiselect.
	 */
	async function toggleGridView() {
		await selection.setGridViewActive(!selection.gridViewActive);
	}
</script>

<!-- <div class="sidebar" class:collapsed> -->
 <Sidebar.Root>
	<Sidebar.Header>
		<div class="flex flex-row items-center gap-2 min-w-0">
			<Sidebar.Trigger class="shrink-0" />
			<h2 class="text-lg font-bold truncate min-w-0">{currentMediaType?.displayName ?? typeId ?? 'Media Manager'}</h2>
		</div>
		<div class="flex flex-row items-center gap-2 mt-2">
			<Button
				variant="outline"
				size="icon"
				class="h-8 w-8 shrink-0"
				title="Back to all media types"
				onclick={() => goto('/')}
			>
				<Home class="h-4 w-4" />
			</Button>
			<SchemaEditorButton />
			<SettingsButton/>
		</div>
		<Sidebar.Separator />
		<!-- Hidden file inputs: multiple files and folder (triggered by upload dropdown) -->
		<input
			type="file"
			multiple
			bind:this={fileInput}
			onchange={handleFileUpload}
			accept="image/*,.heic,.heif"
			style="display: none;"
			aria-label="Upload image files"
		/>
		<input
			type="file"
			webkitdirectory
			multiple
			bind:this={folderInput}
			onchange={handleFileUpload}
			style="display: none;"
			aria-label="Upload folder"
		/>
		<Sidebar.Group>
			<Collapsible.Root>
				<div class="flex flex-row gap-2 items-center justify-between">
					<Sidebar.GroupLabel>Filters</Sidebar.GroupLabel>
					<Collapsible.Trigger class={buttonVariants({ variant: "ghost", size: "sm", class: "w-9 p-0" })}>
						<ChevronsUpDownIcon />
					</Collapsible.Trigger>
				</div>
				<Collapsible.Content>
					<div class="flex flex-col gap-2">
						{#each filters as row, i}
							{@const fieldType = getFieldTypeForField(row.field)}
							{@const ops = operatorsForField(row.field)}
							{@const needsValue = !VALUE_LESS_OPERATORS.has(row.operator)}
							{@const isEnabled = row.enabled !== false}
							<div class="flex flex-col gap-1.5 rounded border p-1.5" class:opacity-60={!isEnabled}>
								<div class="flex flex-row gap-1 items-center">
									<Checkbox
										id="filter-enabled-{i}"
										checked={isEnabled}
										onCheckedChange={(checked) => {
											filters = filters.map((r, j) => (j === i ? { ...r, enabled: checked === true } : r));
										}}
										aria-label="Enable or disable this filter"
										class="shrink-0"
									/>
									<Select.Root
										type="single"
										value={row.field}
										onValueChange={(v) => v && onFilterFieldChange(i, v)}
									>
										<Select.Trigger class="flex-1 min-w-0 text-xs">
											{row.field || 'Field'}
										</Select.Trigger>
										<Select.Content>
											{#each schemaFields as field}
												<Select.Item value={field}>{field}</Select.Item>
											{/each}
										</Select.Content>
									</Select.Root>
									<Button
										variant="ghost"
										size="icon"
										class="h-8 w-8 shrink-0"
										title="Remove filter"
										onclick={() => removeFilter(i)}
									>
										×
									</Button>
								</div>
								<Select.Root
									type="single"
									value={row.operator}
									onValueChange={(v) => v && onFilterOperatorChange(i, v)}
								>
									<Select.Trigger class="w-full text-xs">
										{OPERATOR_LABELS[row.operator as OperatorId] ?? row.operator}
									</Select.Trigger>
									<Select.Content>
										{#each ops as op}
											<Select.Item value={op}>{OPERATOR_LABELS[op]}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								{#if needsValue}
									{#if fieldType === 'number'}
										<Input
											type="number"
											class="text-xs h-8"
											placeholder="Value"
											value={row.value === undefined || row.value === null ? '' : String(row.value)}
											oninput={(e) => {
												const v = (e.currentTarget as HTMLInputElement).value;
												const num = v === '' ? undefined : Number(v);
												filters = filters.map((r, j) => (j === i ? { ...r, value: num } : r));
											}}
										/>
									{:else if fieldType === 'boolean'}
										<Select.Root
											type="single"
											value={row.value === true ? 'true' : row.value === false ? 'false' : ''}
											onValueChange={(v) => {
												const val = v === 'true' ? true : v === 'false' ? false : undefined;
												filters = filters.map((r, j) => (j === i ? { ...r, value: val } : r));
											}}
										>
											<Select.Trigger class="w-full text-xs h-8">
												{row.value === true ? 'true' : row.value === false ? 'false' : 'Value'}
											</Select.Trigger>
											<Select.Content>
												<Select.Item value="true">true</Select.Item>
												<Select.Item value="false">false</Select.Item>
											</Select.Content>
										</Select.Root>
									{:else if fieldType === 'dropdown' && schema?.[row.field]?.options?.length}
										<Select.Root
											type="single"
											value={typeof row.value === 'string' ? row.value : ''}
											onValueChange={(v) => {
												filters = filters.map((r, j) => (j === i ? { ...r, value: v ?? '' } : r));
											}}
										>
											<Select.Trigger class="w-full text-xs h-8">
												{row.value ?? 'Value'}
											</Select.Trigger>
											<Select.Content>
												{#each (schema[row.field]?.options ?? []) as opt}
													<Select.Item value={String(opt)}>{String(opt)}</Select.Item>
												{/each}
											</Select.Content>
										</Select.Root>
									{:else}
										<Input
											type="text"
											class="text-xs h-8"
											placeholder="Value"
											value={row.value === undefined || row.value === null ? '' : String(row.value)}
											oninput={(e) => {
												const v = (e.currentTarget as HTMLInputElement).value;
												filters = filters.map((r, j) => (j === i ? { ...r, value: v } : r));
											}}
										/>
									{/if}
								{/if}
							</div>
						{/each}
						<div class="flex flex-row gap-1 flex-wrap">
							<Button variant="outline" size="sm" class="text-xs" onclick={addFilter}>
								Add filter
							</Button>
							{#if filters.length > 0}
								<Button variant="ghost" size="sm" class="text-xs" onclick={clearAllFilters}>
									Clear all
								</Button>
							{/if}
						</div>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</Sidebar.Group>

		{#if kind === 'images'}
		<!-- View: Linked / Unlinked (images only; not shown for pure JSON) -->
		<Sidebar.Separator />
		<Sidebar.Group>
			<Sidebar.GroupLabel>View</Sidebar.GroupLabel>
			<div class="filter-controls">
				<div class="flex flex-row gap-2 items-center justify-center">
					<Button
						variant={selection.viewMode === 'linked' ? 'default' : 'outline'}
						onclick={() => selection.setViewMode('linked')}
					>
						Linked
					</Button>
					<Button
						variant={selection.viewMode === 'unlinked' ? 'default' : 'outline'}
						onclick={() => selection.setViewMode('unlinked')}
					>
						Unlinked
					</Button>
				</div>
			</div>
		</Sidebar.Group>
		<Sidebar.Separator />
		{/if}
	</Sidebar.Header>
	
	<!-- Removed Key Section as liked/unliked fields don't exist -->

	<!-- Upload Section -->
	<Sidebar.Content>

	<!-- Image List -->
	 <Sidebar.Group>
		<Sidebar.GroupLabel>
			<div class="flex items-center justify-between gap-2 w-full">
				<span class="ml-2">{kind === 'images' ? 'Images' : 'Records'} ({displayedItems.length})</span>
				<Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
					<div class="flex items-center gap-2">
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Button
									variant={selection.gridViewActive ? 'default' : 'ghost'}
									size="icon"
									title="Grid view"
									onclick={toggleGridView}
									disabled={loading}
									class="h-7 w-7"
								>
									<LayoutGrid class="h-4 w-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>Grid view</Tooltip.Content>
						</Tooltip.Root>
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Button
									variant="ghost"
									size="icon"
									title={kind === 'json' ? 'Reload records' : 'Reload images'}
									onclick={syncImageLists}
									disabled={loading}
									class="h-7 w-7"
								>
									<RefreshCwIcon class="h-4 w-4" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>{kind === 'json' ? 'Sync records' : 'Sync image lists'}</Tooltip.Content>
						</Tooltip.Root>
						{#if kind === 'json'}
						<Tooltip.Root>
							<Tooltip.Trigger>
								<Button
									variant="outline"
									size="icon"
									title="New record"
									onclick={createRecord}
									disabled={loading}
									class="h-7 w-7"
								>
									<Plus class="h-4 w-4" aria-hidden="true" />
								</Button>
							</Tooltip.Trigger>
							<Tooltip.Content>New record</Tooltip.Content>
						</Tooltip.Root>
						{:else if kind === 'images'}
						<DropdownMenu.Root>
							<Tooltip.Root>
								<Tooltip.Trigger>
									<DropdownMenu.Trigger
										class="inline-flex h-7 w-7 items-center justify-center rounded-md border-0 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
										disabled={uploading}
									>
										<UploadIcon class="h-4 w-4" />
									</DropdownMenu.Trigger>
								</Tooltip.Trigger>
								<Tooltip.Content>Upload image(s) or folder</Tooltip.Content>
							</Tooltip.Root>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item onclick={() => triggerUpload('files')}>
									Upload file(s)
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => triggerUpload('folder')}>
									Upload folder
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
						{/if}
					</div>
				</Tooltip.Provider>
			</div>
		</Sidebar.GroupLabel>
		<ul>
			{#if loading}
				<li class="italic flex justify-center">Loading...</li>
			{:else}
				{#if displayedItems.length > 0}
					{#each displayedItems as item (item.id)}
						<HoverCard.Root openDelay={300} closeDelay={0}>
							<HoverCard.Trigger
								class={buttonVariants({
									variant: selection.selectedImageId === item.id ? 'default' : 'ghost',
									class: 'w-full justify-start focus-visible:ring-0'
								})}
								onclick={() => openImage(item)}
							>
								{getDisplayName(item)}
							</HoverCard.Trigger>
							{#if selection.selectedImageId !== item.id && kind === 'images'}
								<HoverCard.Content side="right" align="center" class='pointer-events-none flex flex-col gap-2'>
									<img src={typeId ? apiImageUrlByIdForType(typeId, item.id) : ''} alt="Preview of {getDisplayName(item)}" />
									{#if 'file_name' in item && item.file_name}
										<p class="text-sm text-gray-500 break-all">{item.file_name}</p>
									{/if}
								</HoverCard.Content>
							{/if}
						</HoverCard.Root>
					{/each}
				{:else}
					<li class="italic flex justify-center">No {kind === 'images' ? selection.viewMode + ' images' : 'records'} found.</li>
				{/if}
			{/if}
		</ul>
	</Sidebar.Group>
</Sidebar.Content>
</Sidebar.Root>

<!-- Upload filename conflict dialog -->
<AlertDialog.Root bind:open={uploadConflictOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>File already exists</AlertDialog.Title>
		<AlertDialog.Description>
			A file named "{uploadConflictFile?.name}" already exists. What would you like to do?
		</AlertDialog.Description>
		<div class="flex justify-end gap-2 mt-4">
			<Button variant="outline" onclick={() => resolveConflict('skip')}>Skip</Button>
			<Button variant="outline" onclick={() => resolveConflict('auto-rename')}>Auto-rename</Button>
			<Button onclick={() => resolveConflict('overwrite')}>Overwrite</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- HEIC conversion warning dialog -->
<AlertDialog.Root bind:open={heicWarningOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>HEIC files detected</AlertDialog.Title>
		<AlertDialog.Description>
			{heicWarningCount === 1
				? 'This file is in HEIC format, which cannot be displayed in most browsers. It will be converted to JPEG.'
				: `${heicWarningCount} files are in HEIC format, which cannot be displayed in most browsers. They will be converted to JPEG.`}
		</AlertDialog.Description>
		<div class="flex justify-end gap-2 mt-4">
			<Button variant="outline" onclick={() => resolveHeicWarning(false)}>Cancel</Button>
			<Button onclick={() => resolveHeicWarning(true)}>Convert and upload</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
</style>