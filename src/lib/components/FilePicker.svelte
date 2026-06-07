<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Search, File, X } from 'lucide-svelte';
	import {
		apiListRecordsForType,
		apiImageUrlByIdForType,
		apiListMediaTypes
	} from '$lib/api/client.js';
	import type { ImageListItem } from '$lib/core/types.js';

	let {
		value = $bindable(),
		onSelect
	}: {
		value?: string;
		onSelect?: (filename: string) => void;
	} = $props();

	let open = $state(false);
	let records = $state<ImageListItem[]>([]);
	let loading = $state(false);
	let query = $state('');
	let blobStoreTypeId = $state<string | null>(null);
	let noBlobStore = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Discover the blob_store type dynamically.
	 * Falls back to 'files' if a blob_store is not found by kind.
	 */
	async function discoverBlobStore(): Promise<string | null> {
		try {
			const types = await apiListMediaTypes();
			const blobType = types.find((t) => t.kind === 'blob_store');
			return blobType?.id ?? null;
		} catch {
			return null;
		}
	}

	async function fetchFiles() {
		if (!blobStoreTypeId) return;
		loading = true;
		try {
			const res = await apiListRecordsForType(blobStoreTypeId, { query: query || undefined });
			if ('linked' in res) {
				// blob_store returns all files as unlinked (disk-only listing)
				records = [...(res.unlinked ?? []), ...(res.linked ?? [])] as ImageListItem[];
			}
		} catch (e) {
			console.error('FilePicker: failed to fetch files', e);
		} finally {
			loading = false;
		}
	}

	function handleSearchInput(e: Event) {
		query = (e.target as HTMLInputElement).value;
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => fetchFiles(), 300);
	}

	$effect(() => {
		if (open) {
			// Discover blob store on open, then fetch files
			(async () => {
				if (!blobStoreTypeId) {
					const id = await discoverBlobStore();
					if (id) {
						blobStoreTypeId = id;
						noBlobStore = false;
					} else {
						noBlobStore = true;
						return;
					}
				}
				await fetchFiles();
			})();
		}
	});

	function handleSelect(rec: ImageListItem) {
		const filename = rec.file_name;
		value = filename;
		open = false;
		onSelect?.(filename);
	}

	function handleClear() {
		value = '';
		onSelect?.('');
	}

	function isImage(filename: string) {
		const ext = filename.split('.').pop()?.toLowerCase();
		return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif'].includes(ext ?? '');
	}

	function fileUrl(rec: ImageListItem): string {
		if (!blobStoreTypeId) return '';
		return apiImageUrlByIdForType(blobStoreTypeId, rec.id);
	}
</script>

<div class="flex items-center gap-2">
	<Dialog.Root bind:open>
		<Dialog.Trigger class="flex-1 min-w-0">
			<Button variant="outline" class="w-full justify-start text-left font-normal truncate">
				{#if value}
					<span class="truncate">{value}</span>
				{:else}
					<span class="text-muted-foreground">Select file…</span>
				{/if}
			</Button>
		</Dialog.Trigger>
		<Dialog.Content class="max-w-2xl max-h-[80vh] flex flex-col">
			<Dialog.Title>Select File</Dialog.Title>
			<Dialog.Description>Search and select a file from the global files directory.</Dialog.Description>
			<div class="flex gap-2 items-center mt-4">
				<Search class="size-4 text-muted-foreground shrink-0" />
				<Input
					type="search"
					placeholder="Search files…"
					value={query}
					oninput={handleSearchInput}
				/>
			</div>
			<div
				class="flex-1 overflow-y-auto min-h-[16rem] border rounded-md p-2 mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
			>
				{#if noBlobStore}
					<div class="col-span-full flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
						<File class="size-8" />
						<p class="text-sm text-center">No global files directory found.</p>
						<p class="text-xs text-center">
							Create a blob store media type or ensure the "files" folder exists under your data root.
						</p>
					</div>
				{:else if loading}
					<div class="col-span-full flex justify-center py-8 text-muted-foreground">Loading…</div>
				{:else if records.length === 0}
					<div class="col-span-full flex justify-center py-8 text-muted-foreground">
						{query ? 'No files match your search.' : 'No files found.'}
					</div>
				{:else}
					{#each records as rec (rec.id)}
						{@const isSelected = value === rec.file_name}
						<button
							class="flex flex-col items-center gap-2 p-2 border rounded-md hover:bg-accent hover:text-accent-foreground text-left focus:outline-none focus:ring-2 focus:ring-ring transition-colors {isSelected
								? 'ring-2 ring-primary bg-accent/50'
								: ''}"
							onclick={() => handleSelect(rec)}
						>
							<div
								class="w-full aspect-square bg-muted flex items-center justify-center rounded overflow-hidden"
							>
								{#if isImage(rec.file_name)}
									<img
										src={fileUrl(rec)}
										alt={rec.image_name || rec.file_name}
										class="w-full h-full object-cover"
										loading="lazy"
									/>
								{:else}
									<File class="size-8 text-muted-foreground" />
								{/if}
							</div>
							<span
								class="text-xs truncate w-full text-center"
								title={rec.file_name}
							>
								{rec.file_name}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Root>
	{#if value}
		<button
			type="button"
			class="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
			onclick={handleClear}
			aria-label="Clear file selection"
		>
			<X class="size-4" />
		</button>
	{/if}
</div>
