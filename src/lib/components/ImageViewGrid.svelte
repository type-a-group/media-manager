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
	import {
		CheckSquare,
		Square,
		Trash2,
		Unlink,
		FileIcon,
		Pencil,
		UploadIcon,
		TriangleAlert
	} from 'lucide-svelte';
	import { toast } from 'svelte-sonner';

	import type { ImageListItem } from '$lib/core/types.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { fieldLabel, isUserFieldKey } from '$lib/core/fieldKeys.js';
	import {
		apiImageUrlByIdForType,
		apiUnlinkByIdForType,
		apiDeleteFromDiskByIdForType,
		apiGetSchemaForType,
		apiUpdatePropertiesByIdForType,
		apiToggleExcludedFilesForType,
		apiUploadImageForType,
		apiCheckUploadConflictsForType,
		apiUploadImageForTypeWithResolution,
		apiGetGlobalFileUsage
	} from '$lib/api/client.js';
	import { isBrowseFirstFileKind } from '$lib/core/mediaKinds.js';
	import type { ImageId } from '$lib/core/ids.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { ALLOWED_IMAGE_MIME_TYPES } from '$lib/core/images.js';
	import { useSelection } from '$lib/state/selection.svelte';
	import { triggerImageListRefresh } from '$lib/stores/refreshTrigger.js';
	import { settingsStore } from '$lib/stores/settings.js';
	import { hasAllowedImageExtension } from '$lib/core/images.js';
	import MetadataButton from '$lib/components/MetadataButton.svelte';
	import { apiRenameFileByIdForType } from '$lib/api/client.js';

	// NOTE: This is a class instance; do not destructure it or you'll capture initial values.
	const typeId = $derived($currentMediaTypeStore?.typeId ?? null);
	const kind = $derived($currentMediaTypeStore?.kind ?? 'images');
	const browseFirst = $derived(isBrowseFirstFileKind(kind));
	/**
	 * Blob store ("Files") is a flat file manager: no linked/unlinked/excluded actions.
	 * The reserved `files` group is always the blob store even if its on-disk kind is still legacy `generic`.
	 */
	const isBlobStore = $derived(kind === 'blob_store' || typeId === 'files');
	const selection = useSelection();

	let deleteFromDiskOpen = $state(false);
	let deleteDiskImpactGroups = $state<{ typeId: string; displayName: string }[] | null>(null);
	let deleteDiskImpactLoading = $state(false);
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

	// Local rename state for non-images
	let localRenameOpen = $state(false);
	let localRenameId = $state<string | null>(null);
	let localRenameValue = $state('');
	let localRenameSubmitting = $state(false);

	// Upload-related state
	let fileInput: HTMLInputElement | undefined;
	let uploading = $state(false);
	let uploadConflictFile = $state<File | null>(null);
	let uploadConflictOpen = $state(false);
	let uploadConflictResolve = $state<
		((resolution: 'overwrite' | 'auto-rename' | 'skip') => void) | null
	>(null);
	let heicWarningOpen = $state(false);
	let heicWarningCount = $state(0);
	let heicWarningResolve = $state<((proceed: boolean) => void) | null>(null);

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

	$effect(() => {
		if (!deleteFromDiskOpen) {
			deleteDiskImpactGroups = null;
			deleteDiskImpactLoading = false;
			return;
		}
		const items = selection.visibleImageItems.filter((i) =>
			selection.multiselectedIds.includes(i.id)
		);
		const unique = [...new Set(items.map((i) => i.id).filter(Boolean))];
		if (unique.length === 0) {
			deleteDiskImpactGroups = [];
			return;
		}
		deleteDiskImpactLoading = true;
		let cancelled = false;
		apiGetGlobalFileUsage(unique)
			.then((r) => {
				if (!cancelled) deleteDiskImpactGroups = r.groups;
			})
			.catch(() => {
				if (!cancelled) deleteDiskImpactGroups = null;
			})
			.finally(() => {
				if (!cancelled) deleteDiskImpactLoading = false;
			});
		return () => {
			cancelled = true;
		};
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
			if (browseFirst || hasAllowedImageExtension(item.file_name)) {
				await selection.setGridViewActive(false);
				selection.selectImage(item.id);
			} else {
				// Don't open missing/non-image files in the image editor
				toast('Cannot open non-image file in editor');
			}
		}
	}

	function openLocalRename(item: ImageListItem) {
		localRenameId = item.id;
		localRenameValue = item.file_name.replace(/\.[^.]+$/, '');
		localRenameOpen = true;
		localRenameSubmitting = false;
	}

	async function submitLocalRename(e: Event) {
		e.preventDefault();
		if (!localRenameId || !localRenameValue.trim() || !typeId) return;
		const originalItem = selection.visibleImageItems.find((i) => i.id === localRenameId);
		if (!originalItem) return;

		const currentExt = originalItem.file_name.includes('.')
			? originalItem.file_name.substring(originalItem.file_name.lastIndexOf('.'))
			: '';
		const newFilename = localRenameValue.trim() + currentExt;

		localRenameSubmitting = true;
		try {
			await apiRenameFileByIdForType(typeId, localRenameId, newFilename);
			toast.success(`Renamed to ${newFilename}`);
			localRenameOpen = false;
			triggerImageListRefresh();
		} catch (err) {
			console.error(err);
			const msg = err instanceof Error ? err.message : 'Rename failed';
			toast.error(msg);
		} finally {
			localRenameSubmitting = false;
		}
	}

	const HEIC_MIME_TYPES = ['image/heic', 'image/heif'];

	function isHeicFile(f: File): boolean {
		if (HEIC_MIME_TYPES.includes(f.type.toLowerCase())) return true;
		const ext = f.name.toLowerCase().split('.').pop();
		return ext === 'heic' || ext === 'heif';
	}

	function waitForConflictResolution(file: File): Promise<'overwrite' | 'auto-rename' | 'skip'> {
		return new Promise((resolve) => {
			uploadConflictFile = file;
			uploadConflictResolve = resolve;
			uploadConflictOpen = true;
		});
	}

	function resolveConflict(resolution: 'overwrite' | 'auto-rename' | 'skip') {
		uploadConflictOpen = false;
		uploadConflictFile = null;
		uploadConflictResolve?.(resolution);
		uploadConflictResolve = null;
	}

	function waitForHeicConfirmation(count: number): Promise<boolean> {
		return new Promise((resolve) => {
			heicWarningCount = count;
			heicWarningResolve = resolve;
			heicWarningOpen = true;
		});
	}

	function resolveHeicWarning(proceed: boolean) {
		heicWarningOpen = false;
		heicWarningResolve?.(proceed);
		heicWarningResolve = null;
	}

	async function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const files = target.files;
		if (!files?.length) return;

		const allowed = ALLOWED_IMAGE_MIME_TYPES as readonly string[];
		const isFilesGroup = typeId === 'files';
		const toUpload: File[] = [];

		for (let i = 0; i < files.length; i++) {
			const f = files[i];
			if (isFilesGroup || allowed.includes(f.type) || isHeicFile(f)) {
				toUpload.push(f);
			}
		}

		if (toUpload.length === 0) {
			toast('Error: Please select valid files.');
			target.value = '';
			return;
		}

		if (toUpload.length < files.length) {
			toast(`Skipped ${files.length - toUpload.length} invalid file(s).`);
		}

		const heicFiles = toUpload.filter(isHeicFile);
		if (heicFiles.length > 0) {
			const proceed = await waitForHeicConfirmation(heicFiles.length);
			if (!proceed) {
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
			let conflictSet = new Set<string>();
			if (typeId) {
				const filenames = toUpload.map((f) => {
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
					// Proceed without conflict check
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
			triggerImageListRefresh();
			if (ok > 0 && lastUploadedId) {
				selection.setViewMode('unlinked');
				selection.selectImage(lastUploadedId);
			}
			const parts: string[] = [];
			if (ok > 0) parts.push(`Uploaded ${ok} file(s)`);
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

	/**
	 * From the delete confirmation: exclude all selected items from this group only (unlink + excluded list).
	 */
	async function excludeSelectedFromGroupFromDeleteDialog() {
		const items = selection.visibleImageItems.filter((i) =>
			selection.multiselectedIds.includes(i.id)
		);
		if (!typeId || items.length === 0) return;
		deleteFromDiskOpen = false;
		const fileIds = items.map((i) => i.id);
		try {
			for (const item of items) {
				// Only linked items have a row to unlink; unlinked/excluded items do not.
				if (selection.viewMode === 'linked') {
					await apiUnlinkByIdForType(typeId, item.id);
				}
			}
			await apiToggleExcludedFilesForType(typeId, fileIds, 'exclude');
			toast.success(
				`Excluded ${items.length} file${items.length === 1 ? '' : 's'} from this group`
			);
			selection.clearMultiselect();
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error('Exclude failed');
		}
	}

	async function handleToggleExcluded(action: 'exclude' | 'unexclude') {
		const items = selection.visibleImageItems.filter((i) =>
			selection.multiselectedIds.includes(i.id)
		);
		if (items.length === 0) return;
		const fileIds = items.map((i) => i.id);
		try {
			await apiToggleExcludedFilesForType(typeId!, fileIds, action);
			toast.success(
				`${action === 'exclude' ? 'Excluded' : 'Unlinked'} ${items.length} image${items.length === 1 ? '' : 's'}`
			);
			selection.clearMultiselect();
			triggerImageListRefresh();
		} catch (e) {
			console.error(e);
			toast.error(`Failed to ${action === 'exclude' ? 'exclude' : 'unlink'} images`);
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

				<input
					type="file"
					multiple
					bind:this={fileInput}
					onchange={handleFileUpload}
					accept={typeId === 'files' ? '*' : 'image/*,.heic,.heif'}
					style="display: none;"
					aria-label="Upload files"
				/>
				<Button
					variant="outline"
					size="sm"
					class="gap-1 ml-2 shrink-0"
					disabled={uploading}
					onclick={() => fileInput?.click()}
				>
					{#if uploading}
						<span class="animate-spin mr-1">○</span>
						Uploading...
					{:else}
						<UploadIcon class="h-4 w-4" />
						Upload files
					{/if}
				</Button>
			</div>
		</div>
		{#if selection.multiselectedIds.length > 0}
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">
					{selection.multiselectedIds.length} selected
				</span>
				{#if !isBlobStore}
					{#if selection.viewMode === 'linked'}
						<Button variant="outline" size="sm" onclick={openSetFieldDialog}>Set field…</Button>
					{/if}
					{#if hasLinkedSelected}
						<Button variant="outline" size="sm" onclick={() => (unlinkConfirmOpen = true)}>
							<Unlink class="h-4 w-4 mr-1" />
							Unlink
						</Button>
					{/if}
					{#if selection.viewMode === 'unlinked'}
						<Button variant="outline" size="sm" onclick={() => handleToggleExcluded('exclude')}>
							Exclude
						</Button>
					{/if}
					{#if selection.viewMode === 'excluded'}
						<Button variant="outline" size="sm" onclick={() => handleToggleExcluded('unexclude')}>
							Unlink
						</Button>
					{/if}
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
			<AlertDialog.Description class="space-y-2">
				<p>
					This permanently deletes {deleteCount} file{deleteCount === 1 ? '' : 's'} from global storage
					and removes matching catalog rows in every media group that references
					{deleteCount === 1 ? 'it' : 'them'}.
				</p>
				{#if deleteDiskImpactLoading}
					<p class="text-muted-foreground text-sm">Checking catalog references…</p>
				{:else if deleteDiskImpactGroups && deleteDiskImpactGroups.length > 0}
					<p class="text-sm">
						<strong>Referenced in:</strong>
						{deleteDiskImpactGroups.map((g) => g.displayName).join(', ')}
					</p>
				{/if}
				<p class="text-sm text-muted-foreground">
					To hide only in this group, use <strong>Exclude from this group</strong>.
				</p>
			</AlertDialog.Description>
			<div class="flex flex-wrap justify-end gap-2 mt-4">
				<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
				<Button type="button" variant="outline" onclick={excludeSelectedFromGroupFromDeleteDialog}>
					Exclude from this group
				</Button>
				<form onsubmit={handleDeleteFromDisk} class="inline">
					<AlertDialog.Action
						type="submit"
						class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						Delete from disk
					</AlertDialog.Action>
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

	<Dialog.Root bind:open={localRenameOpen}>
		<Dialog.Content>
			<Dialog.Title>Rename File</Dialog.Title>
			<Dialog.Description>Rename this file without changing its extension.</Dialog.Description>
			<form onsubmit={submitLocalRename}>
				<div class="grid gap-4 py-4">
					<div class="grid gap-2">
						<Label for="local-rename-value">New filename</Label>
						<Input id="local-rename-value" bind:value={localRenameValue} />
					</div>
				</div>
				<Dialog.Footer>
					<Button variant="outline" type="button" onclick={() => (localRenameOpen = false)}
						>Cancel</Button
					>
					<Button type="submit" disabled={localRenameSubmitting || !localRenameValue.trim()}>
						{localRenameSubmitting ? 'Saving…' : 'Save'}
					</Button>
				</Dialog.Footer>
			</form>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={uploadConflictOpen}>
		<Dialog.Content>
			<Dialog.Title>Filename Conflict</Dialog.Title>
			<Dialog.Description>
				A file named "{uploadConflictFile?.name}" already exists.
			</Dialog.Description>
			<div class="flex justify-end gap-2 py-4">
				<Button variant="outline" onclick={() => resolveConflict('skip')}>Skip</Button>
				<Button variant="outline" onclick={() => resolveConflict('auto-rename')}>Rename</Button>
				<Button variant="destructive" onclick={() => resolveConflict('overwrite')}>Overwrite</Button
				>
			</div>
		</Dialog.Content>
	</Dialog.Root>

	<Dialog.Root bind:open={heicWarningOpen}>
		<Dialog.Content>
			<Dialog.Title>HEIC Files Detected</Dialog.Title>
			<Dialog.Description>
				You are uploading {heicWarningCount} HEIC file(s). They will be automatically converted to JPEG.
				This might take a while. Proceed?
			</Dialog.Description>
			<div class="flex justify-end gap-2 py-4">
				<Button variant="outline" onclick={() => resolveHeicWarning(false)}>Cancel HEIC</Button>
				<Button onclick={() => resolveHeicWarning(true)}>Convert & Upload</Button>
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
									class="group relative flex flex-col rounded-lg overflow-hidden border-2 transition-colors focus:outline-none focus:ring-0 w-full {isSelected
										? 'border-primary bg-primary/10'
										: 'border-transparent hover:border-muted-foreground/30 hover:bg-muted/50'}"
									onclick={() => handleImageClick(item)}
								>
									<!-- 
										We don't need padding-bottom hack here because Frame handles sizing.
										But we want to ensure the image fits nicely.
									-->
									<div
										class="w-full relative {isUnlinked
											? 'aspect-square'
											: ''} bg-muted/20 flex flex-col items-center justify-center"
									>
										{#if hasAllowedImageExtension(item.file_name)}
											<img
												src={typeId ? apiImageUrlByIdForType(typeId, item.id) : ''}
												alt={getDisplayName(item)}
												class="w-full {isUnlinked
													? 'h-full object-cover absolute inset-0'
													: 'h-auto object-contain block'}"
											/>
										{:else}
											<div
												class="flex flex-col items-center justify-center p-6 gap-2 w-full {isUnlinked
													? 'h-full absolute inset-0'
													: 'h-32'}"
											>
												<FileIcon class="h-10 w-10 text-muted-foreground/50" />
												<span
													class="text-xs font-mono text-muted-foreground bg-muted px-2 py-0.5 rounded uppercase"
												>
													{item.file_name.split('.').pop() || 'FILE'}
												</span>
											</div>
										{/if}
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
									{#if item.missing_file_fields && item.missing_file_fields.length > 0}
										<div
											class="absolute top-1 right-1 rounded bg-background/80 p-0.5 text-amber-500 shadow-sm"
											title={`Missing file reference: ${item.missing_file_fields.join(', ')}`}
										>
											<TriangleAlert class="h-4 w-4" />
										</div>
									{/if}
									<div class="flex flex-row items-center w-full px-2">
										<p
											class="py-2 text-xs text-muted-foreground truncate text-left flex-1 min-w-0"
											title={getDisplayName(item)}
										>
											{getDisplayName(item)}
										</p>
										{#if !selection.gridSelectMode}
											<div
												class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity ml-1"
											>
												{#if !browseFirst && hasAllowedImageExtension(item.file_name) && typeId}
													<!-- svelte-ignore a11y_click_events_have_key_events -->
													<div
														role="button"
														tabindex="0"
														class="appearance-none p-0 m-0 border-none bg-transparent"
														onclick={(e) => e.stopPropagation()}
													>
														<MetadataButton id={item.id} {typeId} filename={item.file_name} />
													</div>
												{/if}
												<Button
													variant="outline"
													size="icon"
													class="h-7 w-7"
													title="Rename"
													onclick={(e) => {
														e.stopPropagation();
														openLocalRename(item);
													}}
												>
													<Pencil class="h-3 w-3" />
												</Button>
											</div>
										{/if}
									</div>
								</button>
							</Frame>
						{/each}
					</BalancedMasonryGrid>
				</div>
			{/each}
		{/if}
	</div>
</div>
