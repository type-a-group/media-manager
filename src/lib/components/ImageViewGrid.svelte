<script lang="ts">
	import { onMount } from 'svelte';
	import { BalancedMasonryGrid, Frame } from '@masonry-grid/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { CheckSquare, Square, Trash2, Unlink } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import type { ImageListItem } from '$lib/core/types.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import {
		apiImageUrlByIdForType,
		apiUnlinkByIdForType,
		apiDeleteFromDiskByIdForType,
		apiGetSchemaForType,
		apiUpdatePropertiesByIdForType
	} from '$lib/api/client.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { useSelection } from '$lib/state/selection.svelte';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';
	import { settingsStore } from '$lib/stores/settings.js';

	// NOTE: This is a class instance; do not destructure it or you'll capture initial values.
	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);
	const selection = useSelection();

	let deleteFromDiskOpen = $state(false);
	let unlinkConfirmOpen = $state(false);
	let setFieldDialogOpen = $state(false);
	let setFieldSchema = $state<SchemaDefinition | null>(null);
	let setFieldKey = $state('');
	let setFieldValue = $state<
		string | number | boolean | string[] | { display_name: string; url: string }
	>('');
	let gridSchemaFields = $state<string[]>([]);
	/** Local value for Group by dropdown ('' = None); synced with selection.gridGroupByField. */
	let groupByValue = $state('');

	/** Sync Group by dropdown with selection: when user picks an option, update selection. */
	$effect(() => {
		const next = groupByValue ? groupByValue : null;
		if (selection.gridGroupByField !== next) selection.setGridGroupByField(next);
	});

	/** When selection.gridGroupByField changes (e.g. from another source), update local dropdown value. */
	$effect(() => {
		const fromSelection = selection.gridGroupByField ?? '';
		if (groupByValue !== fromSelection) groupByValue = fromSelection;
	});

	/** Local value for Size dropdown; synced with selection and settings. */
	let gridSizeOption = $state<'small' | 'medium' | 'large'>('medium');

	/** When selection.gridSize changes (e.g. from layout applying settings), sync dropdown. */
	$effect(() => {
		if (gridSizeOption !== selection.gridSize) gridSizeOption = selection.gridSize;
	});

	/** Min pixel width for grid cells from current size setting. */
	const gridMinPx = $derived(
		selection.gridSize === 'small' ? 80 : selection.gridSize === 'large' ? 180 : 120
	);

	$effect(() => {
		if (typeId) {
			apiGetSchemaForType(typeId)
				.then((s) => {
					gridSchemaFields = getOrderedEditableKeys(s);
				})
				.catch(() => {});
		}
	});

	/**
	 * Ordered editable keys from schema (image_name first if present).
	 */
	function getOrderedEditableKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'image_name');
		return keys.sort((a, b) =>
			a === 'image_name' ? -1 : b === 'image_name' ? 1 : a.localeCompare(b)
		);
	}

	/**
	 * Opens the Set field dialog: fetches schema and resets field/value.
	 */
	async function openSetFieldDialog() {
		if (!typeId) return;
		try {
			const s = await apiGetSchemaForType(typeId);
			setFieldSchema = s;
			const keys = getOrderedEditableKeys(s);
			setFieldKey = keys[0] ?? '';
			const def = s[setFieldKey];
			setFieldValue =
				def?.type === 'boolean'
					? false
					: def?.type === 'number'
						? 0
						: def?.type === 'list'
							? []
							: '';
			setFieldDialogOpen = true;
		} catch (e) {
			console.error(e);
			toast.error('Failed to load schema');
		}
	}

	/**
	 * Coerces the current setFieldValue into the correct type for the selected field.
	 */
	function getCoercedValue():
		| string
		| number
		| boolean
		| string[]
		| { display_name: string; url: string }
		| null {
		if (!setFieldSchema || !setFieldKey) return null;
		const def = setFieldSchema[setFieldKey];
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

	/**
	 * Sets the selected field to the entered value for all multiselected images.
	 */
	async function handleSetFieldSubmit() {
		const ids = [...selection.multiselectedIds];
		if (ids.length === 0 || !setFieldKey) return;
		const value = getCoercedValue();
		if (value === null && setFieldSchema?.[setFieldKey]?.type !== 'number') return;
		try {
			for (const id of ids) {
				await apiUpdatePropertiesByIdForType(typeId!, id, { [setFieldKey]: value });
			}
			toast.success(`Updated ${ids.length} image${ids.length === 1 ? '' : 's'}`);
			setFieldDialogOpen = false;
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Failed to update images');
		}
	}

	/** When selected field key changes in the dialog, reset value to default for that type. */
	$effect(() => {
		if (!setFieldDialogOpen || !setFieldSchema) return;
		const key = setFieldKey;
		if (!key) return;
		const def = setFieldSchema[key];
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

	/**
	 * Gets the display name for an image list item.
	 * Uses `image_name` if present, otherwise falls back to filename.
	 *
	 * @param item - The image list item
	 * @returns Display name string
	 */
	function getDisplayName(item: ImageListItem): string {
		const name = item.image_name?.trim();
		return name && name.length > 0 ? name : item.file_name;
	}

	/**
	 * Handles click on an image in the grid.
	 * When Select mode is off: single-select and return to regular view.
	 * When Select mode is on: toggle multiselect for that image.
	 *
	 * @param item - The clicked image list item
	 */
	async function handleImageClick(item: ImageListItem) {
		if (selection.gridSelectMode) {
			selection.toggleMultiselect(item.id);
		} else {
			await selection.setGridViewActive(false);
			selection.selectImage(item.id);
		}
	}

	/**
	 * Toggles Select mode. When turning off, clears multiselect.
	 */
	function toggleSelectMode() {
		selection.setGridSelectMode(!selection.gridSelectMode);
	}

	/**
	 * Unlinks all selected images (only applicable when viewing linked list).
	 * Removes records from JSON; files stay on disk. Refreshes list after.
	 */
	async function handleUnlink() {
		const items = selection.visibleImageItems.filter((i) =>
			selection.multiselectedIds.includes(i.id)
		);
		if (items.length === 0) {
			toast('No images selected');
			return;
		}
		try {
			for (const item of items) {
				await apiUnlinkByIdForType(typeId!, item.id);
			}
			toast(`Unlinked ${items.length} image${items.length === 1 ? '' : 's'}`);
			unlinkConfirmOpen = false;
			selection.clearMultiselect();
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Unlink failed');
		}
	}

	/**
	 * Deletes all selected images from disk.
	 * Shows confirmation dialog first. Refreshes list and clears multiselect after.
	 */
	async function handleDeleteFromDisk(e: Event) {
		e.preventDefault();
		const ids = [...selection.multiselectedIds];
		if (ids.length === 0) return;
		try {
			for (const id of ids) {
				await apiDeleteFromDiskByIdForType(typeId!, id);
			}
			toast.success(`Deleted ${ids.length} image${ids.length === 1 ? '' : 's'} from disk`);
			deleteFromDiskOpen = false;
			selection.clearMultiselect();
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Delete failed');
		}
	}

	/** Whether Unlink applies: viewing linked list and at least one selected. */
	const hasLinkedSelected = $derived(
		selection.viewMode === 'linked' && selection.multiselectedIds.length > 0
	);

	/**
	 * Partitions visible items into groups by group_by_value when gridGroupByField is set.
	 * Returns a single "group" with null label when not grouping.
	 */
	function formatGroupLabel(key: string): string {
		if (key === '__empty__') return '(empty)';
		try {
			const v = JSON.parse(key);
			return Array.isArray(v) ? v.join(', ') : String(v);
		} catch {
			return key;
		}
	}

	const groupedSections = $derived.by(() => {
		const field = selection.gridGroupByField;
		const items = selection.visibleImageItems;
		if (!field || items.length === 0) {
			return items.length ? [{ label: null as string | null, items }] : [];
		}
		const map = new Map<string, ImageListItem[]>();
		for (const item of items) {
			const v = item.group_by_value;
			const key = v === undefined || v === null ? '__empty__' : JSON.stringify(v);
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(item);
		}
		const sections = [...map.entries()].map(([key, groupItems]) => ({
			label: formatGroupLabel(key),
			items: groupItems
		}));
		sections.sort((a, b) => {
			if (a.label === '(empty)') return -1;
			if (b.label === '(empty)') return 1;
			return (a.label ?? '').localeCompare(b.label ?? '');
		});
		return sections;
	});

	/**
	 * Helper to get width/height for Frame.
	 * For linked images: use actual dims.
	 * For unlinked: use default 100x100 (square).
	 */
	/**
	 * Helper to get width/height for Frame.
	 * For linked images: use actual dims.
	 * For unlinked: use default 100x100 (square).
	 *
	 * Adds extra height to account for the fixed-height footer (text + padding + border).
	 * We calculate this relative to gridMinPx so that at the minimum column width,
	 * we have enough pixels. As the column grows, we'll have slightly more than enough.
	 */
	function getItemDims(item: ImageListItem, minPx: number): { width: number; height: number } {
		const w = item.width ?? 100;
		const h = item.height ?? 100;

		// Footer: border-2 (4px) + p-2 (16px) + text-xs (16px line-height) ~= 36px.
		// Add a small buffer -> 40px.
		const FOOTER_HEIGHT = 36;

		// extra_h / w = FOOTER_HEIGHT / minPx
		// extra_h = w * FOOTER_HEIGHT / minPx
		const extraH = (w * FOOTER_HEIGHT) / minPx;

		return { width: w, height: h + extraH };
	}
</script>

<div class="flex flex-col h-full w-full">
	<!-- Grid header: sticky so it stays visible when scrolling -->
	<div
		class="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 p-3 border-b border-border shrink-0 bg-background"
	>
		<div class="flex items-center gap-2 flex-wrap">
			<Button
				variant={selection.gridSelectMode ? 'default' : 'outline'}
				size="sm"
				onclick={toggleSelectMode}
			>
				{#if selection.gridSelectMode}
					<CheckSquare class="h-4 w-4 mr-1" />
					Select
				{:else}
					<Square class="h-4 w-4 mr-1" />
					Select
				{/if}
			</Button>
			{#if selection.gridSelectMode && selection.multiselectedIds.length > 0}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => {
						selection.clearMultiselect();
						selection.setGridSelectMode(false);
					}}
				>
					Done
				</Button>
			{/if}
			<div class="flex items-center gap-2">
				<Label for="grid-group-by" class="text-sm text-muted-foreground whitespace-nowrap"
					>Group by</Label
				>
				<Select.Root type="single" bind:value={groupByValue}>
					<Select.Trigger id="grid-group-by" class="w-[140px]">
						{groupByValue ? fieldLabel(groupByValue) : 'None'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="">None</Select.Item>
						{#each gridSchemaFields as key}
							<Select.Item value={key}>{fieldLabel(key)}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="flex items-center gap-2">
				<Label for="grid-size" class="text-sm text-muted-foreground whitespace-nowrap">Size</Label>
				<Select.Root
					type="single"
					bind:value={gridSizeOption}
					onValueChange={(v) => {
						if (v != null && (v === 'small' || v === 'medium' || v === 'large')) {
							gridSizeOption = v;
							selection.setGridSize(v);
							settingsStore.updateSetting('gridSize', v);
						}
					}}
				>
					<Select.Trigger id="grid-size" class="w-[100px]">
						{gridSizeOption === 'small' ? 'Small' : gridSizeOption === 'large' ? 'Large' : 'Medium'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="small">Small</Select.Item>
						<Select.Item value="medium">Medium</Select.Item>
						<Select.Item value="large">Large</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>
		</div>
		{#if selection.multiselectedIds.length > 0}
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">
					{selection.multiselectedIds.length} selected
				</span>
				<Button variant="outline" size="sm" onclick={openSetFieldDialog}>Set field…</Button>
				{#if hasLinkedSelected}
					<Button variant="outline" size="sm" onclick={() => (unlinkConfirmOpen = true)}>
						<Unlink class="h-4 w-4 mr-1" />
						Unlink
					</Button>
				{/if}
				<Button variant="destructive" size="sm" onclick={() => (deleteFromDiskOpen = true)}>
					<Trash2 class="h-4 w-4 mr-1" />
					Delete from disk
				</Button>
			</div>
		{/if}
	</div>

	<AlertDialog.Root bind:open={unlinkConfirmOpen}>
		<AlertDialog.Content>
			{@const linkedCount = selection.multiselectedIds.length}
			<AlertDialog.Title>Unlink images</AlertDialog.Title>
			<AlertDialog.Description>
				Unlink {linkedCount} image{linkedCount === 1 ? '' : 's'}? Metadata will be cleared but the
				file{linkedCount === 1 ? '' : 's'} will stay on disk.
			</AlertDialog.Description>
			<div class="flex justify-end gap-2 mt-4">
				<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
				<Button type="button" onclick={handleUnlink}>Unlink</Button>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<AlertDialog.Root bind:open={deleteFromDiskOpen}>
		<AlertDialog.Content>
			{@const deleteCount = selection.multiselectedIds.length}
			<AlertDialog.Title>Delete from disk</AlertDialog.Title>
			<AlertDialog.Description>
				This will permanently delete {deleteCount} image {deleteCount === 1 ? 'file' : 'files'} and remove
				{deleteCount === 1 ? 'it' : 'them'} from the database. This cannot be undone.
			</AlertDialog.Description>
			<div class="flex justify-end gap-2 mt-4">
				<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
				<form onsubmit={handleDeleteFromDisk}>
					<AlertDialog.Action type="submit">Delete</AlertDialog.Action>
				</form>
			</div>
		</AlertDialog.Content>
	</AlertDialog.Root>

	<Dialog.Root bind:open={setFieldDialogOpen}>
		<Dialog.Content>
			<Dialog.Title>Set field for selected images</Dialog.Title>
			<Dialog.Description>
				Choose a field and value. This will update all {selection.multiselectedIds.length} selected image{selection
					.multiselectedIds.length === 1
					? ''
					: 's'}.
			</Dialog.Description>
			{#if setFieldSchema}
				<div class="flex flex-col gap-4 py-4">
					<div class="flex flex-col gap-2">
						<Label for="set-field-key">Field</Label>
						<Select.Root type="single" bind:value={setFieldKey}>
							<Select.Trigger id="set-field-key" class="w-full">
								{setFieldKey ? fieldLabel(setFieldKey) : 'Select field'}
							</Select.Trigger>
							<Select.Content>
								{#each getOrderedEditableKeys(setFieldSchema) as key}
									<Select.Item value={key}>{fieldLabel(key)}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					{#if setFieldKey}
						{@const def = setFieldSchema[setFieldKey]}
						{@const type = def?.type ?? 'string'}
						<div class="flex flex-col gap-2">
							<Label for="set-field-value">Value</Label>
							{#if type === 'boolean'}
								<div class="flex items-center gap-2">
									<Checkbox
										id="set-field-value"
										checked={typeof setFieldValue === 'boolean' ? setFieldValue : false}
										onchange={(e) => (setFieldValue = (e.target as HTMLInputElement).checked)}
									/>
									<Label for="set-field-value" class="font-normal"
										>{def?.type === 'boolean' && setFieldValue ? 'Yes' : 'No'}</Label
									>
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
										(setFieldValue = (e.target as HTMLInputElement).valueAsNumber ?? 0)}
								/>
							{:else if type === 'list'}
								<Input
									id="set-field-value"
									type="text"
									placeholder="Comma-separated values"
									value={Array.isArray(setFieldValue)
										? setFieldValue.join(', ')
										: String(setFieldValue ?? '')}
									oninput={(e) => (setFieldValue = (e.target as HTMLInputElement).value)}
								/>
							{:else if type === 'url'}
								{@const urlObj =
									setFieldValue != null &&
									typeof setFieldValue === 'object' &&
									'url' in setFieldValue
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
												display_name: (e.target as HTMLInputElement).value
											})}
									/>
									<Input
										type="url"
										placeholder="https://..."
										value={urlObj.url ?? ''}
										oninput={(e) =>
											(setFieldValue = { ...urlObj, url: (e.target as HTMLInputElement).value })}
									/>
								</div>
							{:else}
								<Input
									id="set-field-value"
									type="text"
									value={String(setFieldValue ?? '')}
									oninput={(e) => (setFieldValue = (e.target as HTMLInputElement).value)}
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

	<!-- Image grid (optionally grouped by field) -->
	<div class="flex-1 overflow-auto p-4">
		{#if groupedSections.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-muted-foreground italic">
				No images to display.
			</div>
		{:else}
			{#each groupedSections as section}
				<div class="mb-6">
					{#if section.label !== null}
						<h3 class="text-sm font-semibold text-muted-foreground mb-2">
							{selection.gridGroupByField
								? fieldLabel(selection.gridGroupByField) + ': '
								: ''}{section.label}
						</h3>
					{/if}

					<BalancedMasonryGrid frameWidth={gridMinPx} gap={12}>
						{#each section.items as item (item.id)}
							{@const dims = getItemDims(item, gridMinPx)}
							{@const isSelected = selection.multiselectedIds.includes(item.id)}
							{@const isUnlinked = !item.width || !item.height}
							<Frame width={dims.width} height={dims.height}>
								<button
									type="button"
									class="relative flex flex-col rounded-lg overflow-hidden border-2 transition-colors focus:outline-none focus:ring-0 w-full {isSelected
										? 'border-primary bg-primary/10'
										: 'border-transparent hover:border-muted-foreground/30 hover:bg-muted/50'}"
									onclick={() => handleImageClick(item)}
								>
									<!-- 
										We don't need padding-bottom hack here because Frame handles sizing.
										But we want to ensure the image fits nicely.
									-->
									<div class="w-full relative {isUnlinked ? 'aspect-square' : ''}">
										<img
											src={typeId ? apiImageUrlByIdForType(typeId, item.id) : ''}
											alt={getDisplayName(item)}
											class="w-full {isUnlinked
												? 'h-full object-cover absolute inset-0'
												: 'h-auto object-contain block'}"
										/>
									</div>
									{#if selection.gridSelectMode}
										<div
											class="absolute top-1 left-1 p-0.5 rounded bg-background/80 {isSelected
												? 'text-primary'
												: 'text-muted-foreground'}"
										>
											{#if isSelected}
												<CheckSquare class="h-4 w-4" />
											{:else}
												<Square class="h-4 w-4" />
											{/if}
										</div>
									{/if}
									<p
										class="p-2 text-xs text-muted-foreground truncate text-left w-full"
										title={getDisplayName(item)}
									>
										{getDisplayName(item)}
									</p>
								</button>
							</Frame>
						{/each}
					</BalancedMasonryGrid>
				</div>
			{/each}
		{/if}
	</div>
</div>
