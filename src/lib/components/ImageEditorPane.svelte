<script lang="ts">
	import { onMount } from 'svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { toast } from 'svelte-sonner';
	import {
		ChevronLeft,
		ChevronRight,
		MoreVertical,
		Trash2,
		Unlink,
		X,
		EyeOff,
		Eye,
		FileIcon,
		TriangleAlert
	} from 'lucide-svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	import { autogrow, blurSaveOnEnter } from '$lib/actions/autogrow.js';
	import { fieldLabel, isUserFieldKey, RESERVED_FIELD_KEYS } from '$lib/core/fieldKeys.js';
	import type { SchemaDefinition } from '$lib/core/types.js';
	import { normalizeUrlValue } from '$lib/core/types.js';

	import {
		apiGetRecordByIdForType,
		apiGetSchemaForType,
		apiGetFieldValuesForType,
		apiGetSettingsForType,
		apiImageUrlByIdForType,
		apiLinkByFileIdForType,
		apiUpdatePropertiesByIdForType,
		apiUnlinkByIdForType,
		apiDeleteFromDiskByIdForType,
		apiToggleExcludedFilesForType,
		apiGetGlobalFileUsage
	} from '$lib/api/client.js';
	import { isBrowseFirstFileKind } from '$lib/core/mediaKinds.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { currentMediaTypeStore } from '$lib/stores/currentMediaType.js';
	import { useSelection } from '$lib/state/selection.svelte';
	import {
		triggerImageListRefresh,
		schemaRefreshTrigger,
		refreshTrigger
	} from '$lib/stores/refreshTrigger.js';
	import { settingsStore } from '$lib/stores/settings.js';
	import ImageViewGrid from './ImageViewGrid.svelte';
	import MetadataButton from './MetadataButton.svelte';
	import FilePicker from './FilePicker.svelte';

	let schema = $state<SchemaDefinition | null>(null);
	let record = $state<any | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let deleteFromDiskOpen = $state(false);
	/** Catalog groups referencing the selected file (global blob); loaded when delete dialog opens. */
	let deleteDiskImpactGroups = $state<{ typeId: string; displayName: string }[] | null>(null);
	let deleteDiskImpactLoading = $state(false);
	let unlinkConfirmOpen = $state(false);

	// NOTE: This is a class instance; do not destructure it or you’ll capture initial values.
	const selection = useSelection();

	// Local editable values (strings/booleans/arrays) derived from schema + record.
	let formValues = $state<Record<string, any>>({});
	// Pending new item for list fields (key -> input value).
	let newListItemValues = $state<Record<string, string>>({});
	// Existing values for list field autocomplete (key -> string[]).
	let listFieldSuggestions = $state<Record<string, string[]>>({});
	// Which list input is focused (for showing suggestions).
	let listInputFocusedKey = $state<string | null>(null);
	// For mixed-type list: type of the next item to add (string | number | url).
	// For list with url item type: display name and url of the next item.
	let newListItemUrlDisplayName = $state<Record<string, string>>({});
	let newListItemUrlUrl = $state<Record<string, string>>({});
	// Snapshot of last saved patch (from record) for dirty check.
	let lastSavedPatch = $state<Record<string, any>>({});

	/** The visible list item for the current selection (carries the manifest-resolved file_name). */
	const selectedItem = $derived(
		selection.selectedImageId
			? (selection.visibleImageItems.find((i) => i.id === selection.selectedImageId) ?? null)
			: null
	);
	/**
	 * True when the selected blob has no catalog row (on disk, not linked). The id (a `file_id`) is the
	 * same whether linked or unlinked; we tell them apart by whether a record loaded.
	 */
	const isUnlinkedSelection = $derived(
		schema !== null && record === null && !!selection.selectedImageId
	);
	/** Filename for the current selection (record when linked, list item when unlinked). */
	const unlinkedFilename = $derived(record?.file_name ?? selectedItem?.file_name ?? '');
	/** True when current form values differ from the last saved record (or last init for unlinked). */
	const isDirty = $derived(
		schema !== null &&
			(record !== null || isUnlinkedSelection) &&
			JSON.stringify(buildPatch()) !== JSON.stringify(lastSavedPatch)
	);

	/**
	 * Return schema keys in the desired edit order.
	 *
	 * @param s - Schema definition from the server
	 * @returns Ordered editable keys, with `image_name` first if present
	 *
	 * Concerns / future improvements:
	 * - If schema gains explicit ordering metadata, prefer that over lexicographic sorting.
	 */
	function getOrderedEditableKeys(s: SchemaDefinition): string[] {
		const keys = Object.keys(s).filter((k) => isUserFieldKey(k) || k === 'image_name');
		// Put image_name first if present.
		return keys.sort((a, b) =>
			a === 'image_name' ? -1 : b === 'image_name' ? 1 : a.localeCompare(b)
		);
	}

	/**
	 * Initialize formValues from schema + record.
	 *
	 * @param s - Schema definition (used for defaults and field types)
	 * @param rec - Current record fetched from the API
	 *
	 * Concerns / future improvements:
	 * - Replace `any` record with a typed record model once core types stabilize.
	 */
	function initFormValues(s: SchemaDefinition, rec: any) {
		const next: Record<string, any> = {};
		for (const key of getOrderedEditableKeys(s)) {
			const def = (s as any)[key];
			const type = def?.type;
			let value =
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
			// Keep numbers as string for text inputs; convert on save.
			next[key] = type === 'number' ? String(value ?? '') : value;
		}
		formValues = next;
	}

	/** Current media type from store (set by /media/[typeId] page). */
	const currentMediaType = $derived($currentMediaTypeStore);
	const typeId = $derived(currentMediaType?.typeId ?? null);
	const kind = $derived(currentMediaType?.kind ?? 'images');
	const browseFirst = $derived(isBrowseFirstFileKind(kind));

	/**
	 * Fetches saved values for a list field (for autocomplete).
	 * Only fetches from API (saved values); caches to avoid unnecessary refetches.
	 */
	async function fetchListFieldSuggestions(fieldKey: string) {
		if (!typeId || listFieldSuggestions[fieldKey]) return;
		try {
			const { values } = await apiGetFieldValuesForType(typeId, fieldKey);
			listFieldSuggestions = { ...listFieldSuggestions, [fieldKey]: values };
		} catch {
			// Ignore - suggestions are optional
		}
	}

	/**
	 * Adds the current "new item" input(s) to the list for the given key.
	 * List has a single item type (string, number, or url); url uses display name + url.
	 */
	function addListItem(key: string) {
		const itemType =
			(schema?.[key] as { itemTypes?: ('string' | 'number' | 'url')[] })?.itemTypes?.[0] ??
			'string';
		const arr = [...(formValues[key] ?? [])];
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

	/**
	 * Returns filtered suggestions for a list field based on current input.
	 * Excludes values already in the list (saved or unsaved).
	 */
	function getFilteredListSuggestions(key: string): string[] {
		const suggestions = listFieldSuggestions[key] ?? [];
		const existingInList = new Set(
			(formValues[key] ?? []).map((item: unknown) => listItemDisplayText(item).toLowerCase().trim())
		);
		let filtered = suggestions.filter((s) => !existingInList.has(s.toLowerCase().trim()));
		const current = (newListItemValues[key] ?? '').trim().toLowerCase();
		if (!current) return filtered;
		return filtered.filter((s) => s.toLowerCase().includes(current));
	}

	/**
	 * Refresh schema + record for the current selection.
	 *
	 * Use case:
	 * - Runs on selection change and after save/unlink to keep UI in sync.
	 *
	 * Concerns / future improvements:
	 * - Add request cancellation to avoid out-of-order updates when rapidly changing selection.
	 */
	async function refresh() {
		const refreshId = selection.selectedImageId;
		if (!typeId || !refreshId) {
			schema = null;
			record = null;
			listFieldSuggestions = {};
			return;
		}
		loading = true;
		try {
			const [s, r] = await Promise.all([
				apiGetSchemaForType(typeId),
				apiGetRecordByIdForType(typeId, refreshId)
			]);
			schema = s;
			record = r;
			initFormValues(s, r);
			lastSavedPatch = buildPatch();
		} catch (e) {
			const msg = (e as Error)?.message ?? '';
			if (msg.includes('404')) {
				// Unlinked blob: it has a file_id but no catalog row. Load schema and start an empty form.
				record = null;
				try {
					const s = await apiGetSchemaForType(typeId!);
					schema = s;
					const file_name = selectedItem?.file_name ?? '';
					initFormValues(s, { file_name, image_name: '' });
					lastSavedPatch = buildPatch();
				} catch {
					schema = null;
				}
			} else {
				console.error(e);
				toast.error('Failed to load image data');
			}
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		const _id = selection.selectedImageId;
		refresh();
	});

	$effect(() => {
		const unsub = schemaRefreshTrigger.subscribe(() => {
			if (selection.selectedImageId) refresh();
		});
		return unsub;
	});

	$effect(() => {
		const unsub = refreshTrigger.subscribe(() => {
			if (selection.selectedImageId) refresh();
		});
		return unsub;
	});

	$effect(() => {
		if (!deleteFromDiskOpen) {
			deleteDiskImpactGroups = null;
			deleteDiskImpactLoading = false;
			return;
		}
		const fileId = selection.selectedImageId;
		if (!fileId) {
			deleteDiskImpactGroups = [];
			return;
		}
		deleteDiskImpactLoading = true;
		let cancelled = false;
		apiGetGlobalFileUsage(fileId)
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
	 * Document keydown handler for ArrowLeft/ArrowRight to navigate prev/next image.
	 * Only handles when editor is active (image selected, not grid view) and focus is not in an input/textarea/select.
	 */
	function handleKeydown(e: KeyboardEvent) {
		if (selection.gridViewActive || !selection.selectedImageId) return;
		const el = document.activeElement;
		if (
			el &&
			(el instanceof HTMLInputElement ||
				el instanceof HTMLTextAreaElement ||
				el instanceof HTMLSelectElement ||
				el.getAttribute('contenteditable') === 'true')
		)
			return;
		const idx = selection.visibleImageIds.indexOf(selection.selectedImageId);
		if (idx === -1) return;
		if (e.key === 'ArrowLeft') {
			if (idx <= 0) return;
			e.preventDefault();
			navigate('prev');
		} else if (e.key === 'ArrowRight') {
			if (idx >= selection.visibleImageIds.length - 1) return;
			e.preventDefault();
			navigate('next');
		}
	}

	onMount(() => {
		document.addEventListener('keydown', handleKeydown);
		return () => document.removeEventListener('keydown', handleKeydown);
	});

	/**
	 * Register save-before-navigate: when user selects another image (sidebar or grid),
	 * save current edits first if autoSaveOnAdvance is on and form is dirty.
	 */
	$effect(() => {
		const unregister = selection.registerBeforeSelectAnother(async () => {
			const s = typeId ? await apiGetSettingsForType(typeId) : settingsStore.getCurrentSettings();
			if (record && s.autoSaveOnAdvance && isDirty) await save();
		});
		return () => unregister();
	});

	/**
	 * Build a patch payload from the current form values.
	 *
	 * @returns Patch object to send to `apiUpdatePropertiesById`
	 *
	 * Concerns / future improvements:
	 * - If schema defines validation rules, validate locally before sending.
	 */
	function buildPatch(): Record<string, any> {
		if (!schema) return {};
		const patch: Record<string, any> = {};
		for (const key of getOrderedEditableKeys(schema)) {
			const def = (schema as any)[key];
			const type = def?.type;
			const raw = formValues[key];
			if (type === 'number') {
				const n = raw === '' || raw === null || raw === undefined ? null : Number(raw);
				patch[key] = Number.isFinite(n as any) ? n : null;
			} else if (type === 'boolean') {
				patch[key] = Boolean(raw);
			} else if (type === 'list') {
				patch[key] = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
			} else if (type === 'url') {
				const urlVal =
					raw != null && typeof raw === 'object' && 'url' in raw
						? (raw as { display_name: string; url: string })
						: normalizeUrlValue(raw);
				patch[key] = { display_name: urlVal.display_name ?? '', url: urlVal.url ?? '' };
			} else {
				patch[key] = raw ?? '';
			}
		}
		return patch;
	}

	/**
	 * Save current edits for the selected image.
	 */
	async function save() {
		if (!selection.selectedImageId) return;
		saving = true;
		try {
			await apiUpdatePropertiesByIdForType(typeId!, selection.selectedImageId, buildPatch());
			toast.success('Saved');
			triggerImageListRefresh();
			// Clear list suggestions cache so next focus fetches fresh values.
			listFieldSuggestions = {};
			await refresh();
		} catch (e) {
			console.error(e);
			toast.error('Save failed');
		} finally {
			saving = false;
		}
	}

	/**
	 * Add unlinked image to catalog with current form values.
	 * If autoAdvanceToNextUnlinked is on, selects the next unlinked image in the list; otherwise selects the new record.
	 */
	async function linkToCatalog() {
		const id = selection.selectedImageId;
		if (!typeId || !id || !isUnlinkedSelection) return;
		const visibleIds = selection.visibleImageIds;
		const currentIdx = visibleIds.indexOf(id);
		// Use current media type's settings (project-specific), not global settings.
		const settings = await apiGetSettingsForType(typeId);
		const advanceToNext = settings.autoAdvanceToNextUnlinked ?? false;
		// Capture next unlinked id now; after link + refresh the list will no longer contain current item.
		const nextUnlinkedId =
			advanceToNext && currentIdx >= 0 && currentIdx + 1 < visibleIds.length
				? visibleIds[currentIdx + 1]
				: null;

		saving = true;
		try {
			// Linking creates a row under the same file_id, so the selection id never changes.
			const newRecord = await apiLinkByFileIdForType(typeId, id);
			await apiUpdatePropertiesByIdForType(typeId, newRecord.id, buildPatch());
			triggerImageListRefresh();

			if (nextUnlinkedId) {
				selection.setSelectedImageIdOnly(nextUnlinkedId);
			} else {
				selection.setSelectedImageIdOnly(newRecord.id);
			}
			await refresh();
			toast.success('Added to catalog');
		} catch (e) {
			console.error(e);
			toast.error('Failed to link image');
		} finally {
			saving = false;
		}
	}

	/**
	 * Move selection to previous/next item in the visible sidebar list.
	 * If autoSaveOnAdvance is enabled and there are unsaved changes, saves first.
	 *
	 * @param direction - Which way to navigate
	 */
	async function navigate(direction: 'prev' | 'next') {
		if (!selection.selectedImageId) return;
		const idx = selection.visibleImageIds.indexOf(selection.selectedImageId);
		if (idx === -1) return;
		const nextIdx = direction === 'prev' ? idx - 1 : idx + 1;
		if (nextIdx < 0 || nextIdx >= selection.visibleImageIds.length) return;
		const settings = typeId
			? await apiGetSettingsForType(typeId)
			: settingsStore.getCurrentSettings();
		if (settings.autoSaveOnAdvance && isDirty) {
			await save();
		}
		selection.selectImage(selection.visibleImageIds[nextIdx]);
	}

	/**
	 * Unlink the current image and advance selection.
	 */
	async function unlink() {
		if (!selection.selectedImageId) return;
		try {
			await apiUnlinkByIdForType(typeId!, selection.selectedImageId);
			toast('Unlinked');
			unlinkConfirmOpen = false;
			triggerImageListRefresh();
			// Auto-advance if possible.
			const idx = selection.visibleImageIds.indexOf(selection.selectedImageId);
			if (idx !== -1 && idx < selection.visibleImageIds.length - 1) {
				selection.selectImage(selection.visibleImageIds[idx + 1]);
			} else if (idx > 0) {
				selection.selectImage(selection.visibleImageIds[idx - 1]);
			} else {
				selection.selectImage(null);
			}
		} catch (e) {
			console.error(e);
			toast.error('Unlink failed');
		}
	}

	async function handleExclude() {
		const fileId = selection.selectedImageId;
		if (!typeId || !fileId) return;
		try {
			if (record) {
				await apiUnlinkByIdForType(typeId, fileId);
			}
			await apiToggleExcludedFilesForType(typeId, [fileId], 'exclude');
			toast.success('Excluded image');
			triggerImageListRefresh();
			const selectedId = selection.selectedImageId;
			if (!selectedId) return;
			const idx = selection.visibleImageIds.indexOf(selectedId);
			if (idx !== -1 && idx < selection.visibleImageIds.length - 1) {
				selection.selectImage(selection.visibleImageIds[idx + 1]);
			} else if (idx > 0) {
				selection.selectImage(selection.visibleImageIds[idx - 1]);
			} else {
				selection.selectImage(null);
			}
		} catch (e) {
			console.error(e);
			toast.error('Exclude failed');
		}
	}

	async function handleUnexclude() {
		const fileId = selection.selectedImageId;
		if (!typeId || !fileId) return;
		try {
			await apiToggleExcludedFilesForType(typeId, [fileId], 'unexclude');
			toast.success('Unlinked image');
			triggerImageListRefresh();
			const selectedId = selection.selectedImageId;
			if (!selectedId) return;
			const idx = selection.visibleImageIds.indexOf(selectedId);
			if (idx !== -1 && idx < selection.visibleImageIds.length - 1) {
				selection.selectImage(selection.visibleImageIds[idx + 1]);
			} else if (idx > 0) {
				selection.selectImage(selection.visibleImageIds[idx - 1]);
			} else {
				selection.selectImage(null);
			}
		} catch (e) {
			console.error(e);
			toast.error('Failed to unlink image');
		}
	}

	/**
	 * Delete the image file from disk and remove its record.
	 * Shows AlertDialog confirmation before proceeding.
	 */
	async function handleDeleteFromDisk(e: Event) {
		e.preventDefault();
		if (!selection.selectedImageId) return;
		try {
			await apiDeleteFromDiskByIdForType(typeId!, selection.selectedImageId);
			toast.success('Deleted from disk');
			deleteFromDiskOpen = false;
			triggerImageListRefresh();
			const idx = selection.visibleImageIds.indexOf(selection.selectedImageId);
			if (idx !== -1 && idx < selection.visibleImageIds.length - 1) {
				selection.selectImage(selection.visibleImageIds[idx + 1]);
			} else if (idx > 0) {
				selection.selectImage(selection.visibleImageIds[idx - 1]);
			} else {
				selection.selectImage(null);
			}
		} catch (e) {
			console.error(e);
			toast.error('Delete failed');
		}
	}

	/**
	 * Close delete dialog and hide the file from this group only (unlink + exclude), keeping the blob for others.
	 */
	async function excludeFromGroupInstead() {
		deleteFromDiskOpen = false;
		await handleExclude();
	}

	/**
	 * Returns keys in the record that are not in schema and not system keys.
	 * These are "custom fields" (orphaned data).
	 */
	function getCustomFieldKeys(rec: any, s: SchemaDefinition | null): string[] {
		if (!rec || typeof rec !== 'object') return [];
		const schemaKeys = s ? new Set(Object.keys(s)) : new Set();
		return Object.keys(rec).filter((k) => !RESERVED_FIELD_KEYS.has(k) && !schemaKeys.has(k));
	}

	/**
	 * Removes a custom field from the current image by sending null.
	 */
	async function clearCustomField(key: string) {
		if (!selection.selectedImageId) return;
		try {
			await apiUpdatePropertiesByIdForType(typeId!, selection.selectedImageId, { [key]: null });
			toast.success('Custom field removed');
			triggerImageListRefresh();
			await refresh();
		} catch (e) {
			console.error(e);
			toast.error('Failed to remove field');
		}
	}
</script>

{#if selection.gridViewActive}
	<ImageViewGrid />
{:else if !selection.selectedImageId}
	<div class="flex flex-col items-center justify-center h-full w-full p-8">
		<p class="text-base text-gray-500 text-center italic">
			Select an image from the sidebar to begin editing.
		</p>
	</div>
{:else if record || (isUnlinkedSelection && schema)}
	<div class="flex flex-row h-dvh w-full">
		<!-- Image pane: scrolls independently when image is tall -->
		<div class="flex-1 min-w-0 overflow-auto p-4">
			<Card.Root>
				<Card.Content>
					{#if browseFirst}
						{@const filename = record?.file_name || unlinkedFilename || ''}
						{@const parts = filename.split('.')}
						<div class="flex flex-col items-center justify-center p-8 gap-4 min-h-[50vh]">
							<FileIcon class="w-32 h-32 text-muted-foreground" />
							<div class="text-2xl font-bold font-mono">
								{parts.length > 1 ? parts.pop()?.toUpperCase() : 'FILE'}
							</div>
						</div>
					{:else}
						<img
							src={typeId ? apiImageUrlByIdForType(typeId, selection.selectedImageId) : ''}
							alt={record?.image_name || record?.file_name || unlinkedFilename}
						/>
					{/if}
				</Card.Content>
			</Card.Root>
		</div>

		<!-- Side panel: fixed width, own scrollbar, buttons at top -->
		<div
			class="flex flex-col h-full w-80 min-w-80 flex-shrink-0 border-l border-border bg-card overflow-hidden"
		>
			<!-- Button bar: always visible at top -->
			<div class="flex flex-wrap gap-2 p-3 border-b border-border shrink-0">
				<Button
					variant="secondary"
					size="icon"
					onclick={() => navigate('prev')}
					disabled={selection.visibleImageIds.indexOf(selection.selectedImageId) <= 0}
				>
					<ChevronLeft />
				</Button>
				<Button
					variant="secondary"
					size="icon"
					onclick={() => navigate('next')}
					disabled={selection.visibleImageIds.indexOf(selection.selectedImageId) === -1 ||
						selection.visibleImageIds.indexOf(selection.selectedImageId) >=
							selection.visibleImageIds.length - 1}
				>
					<ChevronRight />
				</Button>
				{#if !browseFirst}
					{#if record}
						<Button variant="outline" onclick={save} disabled={saving || loading || !isDirty}>
							{saving ? 'Saving…' : 'Save'}
						</Button>
						{#if record.id}
							<MetadataButton
								id={record.id}
								typeId={typeId ?? undefined}
								filename={record.file_name}
							/>
						{/if}
					{:else}
						<Button onclick={linkToCatalog} disabled={saving || loading}>
							{saving ? 'Linking…' : 'Link to catalog'}
						</Button>
						{#if selection.viewMode === 'unlinked'}
							<Button variant="outline" onclick={handleExclude} disabled={saving || loading}>
								Exclude
							</Button>
						{/if}
						{#if selection.viewMode === 'excluded'}
							<Button variant="outline" onclick={handleUnexclude} disabled={saving || loading}>
								Unlink
							</Button>
						{/if}
					{/if}
				{/if}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-transparent hover:bg-accent hover:text-accent-foreground"
						aria-label="More actions"
					>
						<MoreVertical class="h-4 w-4" />
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end">
						{#if record}
							<DropdownMenu.Item onclick={() => (unlinkConfirmOpen = true)}>
								<Unlink class="h-4 w-4 mr-2" />
								Unlink
							</DropdownMenu.Item>
							<DropdownMenu.Item onclick={handleExclude}>
								<EyeOff class="h-4 w-4 mr-2" />
								Exclude
							</DropdownMenu.Item>
						{/if}
						<DropdownMenu.Item variant="destructive" onclick={() => (deleteFromDiskOpen = true)}>
							<Trash2 class="h-4 w-4 mr-2" />
							Delete from disk
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				<AlertDialog.Root bind:open={unlinkConfirmOpen}>
					<AlertDialog.Content>
						<AlertDialog.Title>Unlink image</AlertDialog.Title>
						<AlertDialog.Description>
							Unlink this image? Metadata will be cleared but the file will stay on disk.
						</AlertDialog.Description>
						<div class="flex justify-end gap-2 mt-4">
							<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
							<Button type="button" onclick={unlink}>Unlink</Button>
						</div>
					</AlertDialog.Content>
				</AlertDialog.Root>
				<AlertDialog.Root bind:open={deleteFromDiskOpen}>
					<AlertDialog.Content>
						<AlertDialog.Title>Delete from disk</AlertDialog.Title>
						<AlertDialog.Description class="space-y-2">
							<p>
								This permanently deletes the file from global storage and removes matching catalog
								rows in every media group that references it.
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
								To hide the file only in this group, use <strong>Exclude from this group</strong> instead.
							</p>
						</AlertDialog.Description>
						<div class="flex flex-wrap justify-end gap-2 mt-4">
							<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
							<Button type="button" variant="outline" onclick={excludeFromGroupInstead}>
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
			</div>

			<!-- Scrollable content: filename + metadata form -->
			<div class="flex-1 overflow-y-auto">
				<p class="p-3 text-sm text-muted-foreground break-all">
					{record?.file_name ?? unlinkedFilename}
				</p>
				{#if record?.width != null && record?.height != null}
					<p class="px-3 pb-1 text-sm text-muted-foreground">
						{record.width} &times; {record.height} px
					</p>
				{/if}
				{#if loading}
					<p class="px-3 pb-3 italic">Loading…</p>
				{:else if schema && !browseFirst}
					<div class="flex flex-col gap-3 p-3">
						{#each getOrderedEditableKeys(schema) as key (key)}
							{#if key !== 'file_name' && key !== 'last_modified' && key !== 'default'}
								<div class="flex flex-col gap-1">
									<Label>{fieldLabel(key)}</Label>
									{#if schema[key]?.type === 'boolean'}
										<div class="flex items-center gap-2">
											<Checkbox bind:checked={formValues[key]} />
											<span class="text-sm text-muted-foreground"
												>{formValues[key] ? 'True' : 'False'}</span
											>
										</div>
									{:else if schema[key]?.type === 'number'}
										<Input type="number" bind:value={formValues[key]} />
									{:else if schema[key]?.type === 'url'}
										{@const urlObj =
											formValues[key] != null &&
											typeof formValues[key] === 'object' &&
											'url' in formValues[key]
												? formValues[key]
												: { display_name: '', url: '' }}
										<div class="flex flex-col gap-1">
											<Input
												type="text"
												placeholder="Display name"
												value={urlObj.display_name ?? ''}
												oninput={(e) => {
													const v = (e.target as HTMLInputElement).value;
													formValues = { ...formValues, [key]: { ...urlObj, display_name: v } };
												}}
											/>
											<Input
												type="url"
												placeholder="https://..."
												value={urlObj.url ?? ''}
												oninput={(e) => {
													const v = (e.target as HTMLInputElement).value;
													formValues = { ...formValues, [key]: { ...urlObj, url: v } };
												}}
											/>
											{#if (urlObj.url ?? '').trim()}
												<a
													href={urlObj.url}
													target="_blank"
													rel="noopener noreferrer"
													class="text-sm text-primary hover:underline truncate"
												>
													{(urlObj.display_name ?? '').trim() || urlObj.url}
												</a>
											{/if}
										</div>
									{:else if schema[key]?.type === 'dropdown'}
										{#if (schema[key] as { multiselect?: boolean }).multiselect}
											<Select.Root
												type="multiple"
												value={formValues[key] ?? []}
												onValueChange={(v) => (formValues = { ...formValues, [key]: v ?? [] })}
											>
												<Select.Trigger class="w-full">
													{((formValues[key] ?? []) as string[]).length === 0
														? '(none)'
														: ((formValues[key] ?? []) as string[]).join(', ')}
												</Select.Trigger>
												<Select.Content>
													{#each schema[key]?.options ?? [] as opt}
														{#if opt !== ''}
															<Select.Item value={opt}>{opt}</Select.Item>
														{/if}
													{/each}
												</Select.Content>
											</Select.Root>
										{:else}
											<Select.Root type="single" bind:value={formValues[key]}>
												<Select.Trigger class="w-full">
													{(formValues[key] ?? '') === ''
														? '(none)'
														: (formValues[key] ?? 'Select…')}
												</Select.Trigger>
												<Select.Content>
													<Select.Item value="">(none)</Select.Item>
													{#each schema[key]?.options ?? [] as opt}
														{#if opt !== ''}
															<Select.Item value={opt}>{opt}</Select.Item>
														{/if}
													{/each}
												</Select.Content>
											</Select.Root>
										{/if}
									{:else if schema[key]?.type === 'list'}
										{@const itemType =
											(schema[key] as { itemTypes?: ('string' | 'number' | 'url')[] })
												?.itemTypes?.[0] ?? 'string'}
										<div class="flex flex-col gap-1">
											<div class="flex flex-wrap gap-1">
												{#each formValues[key] ?? [] as item, i}
													<span
														class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-muted text-sm"
													>
														{listItemDisplayText(item)}
														<button
															type="button"
															class="hover:text-destructive"
															onclick={() => {
																const arr = [...(formValues[key] ?? [])];
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
											<div class="relative flex flex-wrap gap-2 items-end">
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
													<div class="relative flex-1 min-w-0">
														<Input
															type={itemType === 'number' ? 'number' : 'text'}
															bind:value={newListItemValues[key]}
															placeholder="Add item"
															onfocus={() => {
																listInputFocusedKey = key;
																fetchListFieldSuggestions(key);
															}}
															onblur={() => setTimeout(() => (listInputFocusedKey = null), 150)}
															onkeydown={(e) => {
																if (e.key === 'Enter') {
																	e.preventDefault();
																	addListItem(key);
																}
															}}
														/>
														{#if listInputFocusedKey === key}
															{@const suggestions = getFilteredListSuggestions(key)}
															{#if suggestions.length > 0}
																<div
																	class="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
																>
																	{#each suggestions as suggestion}
																		<button
																			type="button"
																			class="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
																			onmousedown={(e) => {
																				e.preventDefault();
																				const arr = [...(formValues[key] ?? []), suggestion];
																				formValues = { ...formValues, [key]: arr };
																				newListItemValues = { ...newListItemValues, [key]: '' };
																				listInputFocusedKey = null;
																			}}
																		>
																			{suggestion}
																		</button>
																	{/each}
																</div>
															{/if}
														{/if}
													</div>
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
									{:else if schema[key]?.type === 'file'}
										{@const missingName = (record as Record<string, any>)?._missing_files?.[key]}
										{@const isMissing =
											missingName !== undefined &&
											formValues[key] === (record as Record<string, any>)?.[key]}
										<div class="flex flex-col gap-1 w-full">
											<FilePicker bind:value={formValues[key]} />
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
											bind:value={formValues[key]}
											rows="1"
											use:autogrow={formValues[key]}
											onkeydown={(e) => blurSaveOnEnter(e, save)}
											class="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none"
										></textarea>
									{/if}
								</div>
							{/if}
						{/each}
					</div>

					{#if record && getCustomFieldKeys(record, schema).length > 0}
						<Collapsible.Root class="border-t border-border pt-3 mt-3">
							<Collapsible.Trigger
								class="flex w-full items-center justify-between text-sm font-medium"
							>
								Custom fields
								<span class="text-muted-foreground text-xs">
									{getCustomFieldKeys(record, schema).length}
								</span>
							</Collapsible.Trigger>
							<Collapsible.Content>
								<div class="flex flex-col gap-2 pt-2">
									<p class="text-xs text-muted-foreground">
										Fields not in schema. You can clear them to remove from this image.
									</p>
									{#each getCustomFieldKeys(record, schema) as key (key)}
										<div
											class="flex flex-row items-center justify-between gap-2 p-2 rounded bg-muted/50"
										>
											<div class="min-w-0 flex-1">
												<span class="text-sm font-medium">{fieldLabel(key)}</span>
												<p class="text-xs text-muted-foreground truncate">
													{typeof record[key] === 'object'
														? JSON.stringify(record[key])
														: String(record[key] ?? '')}
												</p>
											</div>
											<Button variant="outline" size="sm" onclick={() => clearCustomField(key)}>
												Clear and remove
											</Button>
										</div>
									{/each}
								</div>
							</Collapsible.Content>
						</Collapsible.Root>
					{/if}
				{/if}
			</div>
		</div>
	</div>
{:else}
	<div class="flex min-h-[50vh] items-center justify-center p-8">
		<p class="text-muted-foreground">{loading ? 'Loading…' : 'Failed to load image.'}</p>
	</div>
{/if}
