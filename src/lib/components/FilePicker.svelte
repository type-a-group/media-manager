<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Search, File, X, ExternalLink } from 'lucide-svelte';
	import { apiListFiles, apiBlobUrl } from '$lib/api/files.js';
	import { hasAllowedImageExtension } from '$lib/core/images.js';
	import type { FileItem } from '$lib/core/types.js';

	let {
		value = $bindable(),
		onSelect
	}: {
		/** The selected blob's `file_id` (stable manifest identity), or empty. */
		value?: string;
		onSelect?: (fileId: string) => void;
	} = $props();

	let open = $state(false);
	let files = $state<FileItem[]>([]);
	let loading = $state(false);
	let query = $state('');
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/** Resolve the selected file_id to a display name from the loaded blob list. */
	const selectedName = $derived(value ? (files.find((f) => f.id === value)?.file_name ?? '') : '');
	/** URL to the selected blob's bytes (for thumbnail + open-in-new-tab). */
	const selectedUrl = $derived(value ? apiBlobUrl(value) : '');
	/** Whether the selected blob is an image we can thumbnail. */
	const selectedIsImage = $derived(!!selectedName && hasAllowedImageExtension(selectedName));

	/** Load blobs from the global files hub, honouring the current search query. */
	async function fetchFiles() {
		loading = true;
		try {
			const res = await apiListFiles({ query: query || undefined });
			files = res.files;
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
		if (open) fetchFiles();
	});

	// When a value is set but we haven't loaded the blob list yet, load it once so the trigger button
	// can show the resolved filename instead of the raw file_id.
	$effect(() => {
		if (value && files.length === 0 && !loading) fetchFiles();
	});

	function handleSelect(file: FileItem) {
		value = file.id;
		open = false;
		onSelect?.(file.id);
	}

	function handleClear() {
		value = '';
		onSelect?.('');
	}
</script>

<div class="flex items-center gap-2">
	<Dialog.Root bind:open>
		<Dialog.Trigger class="min-w-0 flex-1">
			{#snippet child({ props })}
				<Button
					{...props}
					variant="outline"
					class="h-auto w-full min-w-0 flex-1 justify-start gap-2 py-1.5 text-left font-normal"
				>
					{#if value}
						<span
							class="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded bg-muted"
						>
							{#if selectedIsImage && selectedUrl}
								<img
									src={selectedUrl}
									alt={selectedName}
									class="h-full w-full object-cover"
									loading="lazy"
								/>
							{:else}
								<File class="size-5 text-muted-foreground" />
							{/if}
						</span>
						<span class="flex-1 truncate">{selectedName || 'Selected file'}</span>
					{:else}
						<span class="text-muted-foreground">Select file…</span>
					{/if}
				</Button>
			{/snippet}
		</Dialog.Trigger>
		<Dialog.Content class="flex max-h-[80vh] max-w-2xl flex-col">
			<Dialog.Title>Select File</Dialog.Title>
			<Dialog.Description
				>Search and select a file from the global files directory.</Dialog.Description
			>
			<div class="mt-4 flex items-center gap-2">
				<Search class="size-4 shrink-0 text-muted-foreground" />
				<Input
					type="search"
					placeholder="Search files…"
					value={query}
					oninput={handleSearchInput}
				/>
			</div>
			<div
				class="mt-4 grid min-h-[16rem] flex-1 grid-cols-2 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-3 md:grid-cols-4"
			>
				{#if loading}
					<div class="col-span-full flex justify-center py-8 text-muted-foreground">Loading…</div>
				{:else if files.length === 0}
					<div class="col-span-full flex justify-center py-8 text-muted-foreground">
						{query ? 'No files match your search.' : 'No files found.'}
					</div>
				{:else}
					{#each files as file (file.id)}
						{@const isSelected = value === file.id}
						<button
							class="flex flex-col items-center gap-2 rounded-md border p-2 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring {isSelected
								? 'bg-accent/50 ring-2 ring-primary'
								: ''}"
							onclick={() => handleSelect(file)}
						>
							<div
								class="flex aspect-square w-full items-center justify-center overflow-hidden rounded bg-muted"
							>
								{#if hasAllowedImageExtension(file.file_name)}
									<img
										src={apiBlobUrl(file.id)}
										alt={file.file_name}
										class="h-full w-full object-cover"
										loading="lazy"
									/>
								{:else}
									<File class="size-8 text-muted-foreground" />
								{/if}
							</div>
							<span class="w-full truncate text-center text-xs" title={file.file_name}>
								{file.file_name}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</Dialog.Content>
	</Dialog.Root>
	{#if value}
		{#if selectedUrl}
			<a
				href={selectedUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				aria-label="Open file in new tab"
				title="Open in new tab"
			>
				<ExternalLink class="size-4" />
			</a>
		{/if}
		<button
			type="button"
			class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			onclick={handleClear}
			aria-label="Clear file selection"
		>
			<X class="size-4" />
		</button>
	{/if}
</div>
