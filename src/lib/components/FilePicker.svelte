<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Search, File, Image as ImageIcon } from 'lucide-svelte';
	import { apiListRecordsForType, apiImageUrlByIdForType } from '$lib/api/client.js';
	import type { ImageListItem } from '$lib/core/types.js';

	let {
		value = $bindable(),
		onSelect
	}: {
		value?: string;
		onSelect?: (id: string) => void;
	} = $props();

	let open = $state(false);
	let records = $state<ImageListItem[]>([]);
	let loading = $state(false);
	let query = $state('');

	async function fetchFiles() {
		loading = true;
		try {
			const res = await apiListRecordsForType('files', { query });
			if ('linked' in res) {
				records = res.linked as ImageListItem[];
			}
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) {
			fetchFiles();
		}
	});

	function handleSelect(id: string) {
		value = id;
		open = false;
		onSelect?.(id);
	}

	function isImage(filename: string) {
		const ext = filename.split('.').pop()?.toLowerCase();
		return ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext ?? '');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger>
		<Button variant="outline" class="w-full justify-start text-left font-normal truncate">
			{#if value}
				{value}
			{:else}
				<span class="text-muted-foreground">Select file...</span>
			{/if}
		</Button>
	</Dialog.Trigger>
	<Dialog.Content class="max-w-2xl max-h-[80vh] flex flex-col">
		<Dialog.Title>Select File</Dialog.Title>
		<Dialog.Description>Search and select a file from the uploaded files.</Dialog.Description>
		<div class="flex gap-2 items-center mt-4">
			<Search class="size-4 text-muted-foreground" />
			<Input type="search" placeholder="Search files..." bind:value={query} onchange={fetchFiles} />
			<Button variant="secondary" onclick={fetchFiles}>Search</Button>
		</div>
		<div
			class="flex-1 overflow-y-auto min-h-[16rem] border rounded-md p-2 mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2"
		>
			{#if loading}
				<div class="col-span-full flex justify-center py-8 text-muted-foreground">Loading...</div>
			{:else if records.length === 0}
				<div class="col-span-full flex justify-center py-8 text-muted-foreground">
					No files found.
				</div>
			{:else}
				{#each records as rec (rec.id)}
					<button
						class="flex flex-col items-center gap-2 p-2 border rounded-md hover:bg-accent hover:text-accent-foreground text-left focus:outline-none focus:ring-2 focus:ring-ring"
						onclick={() => handleSelect(rec.id)}
					>
						<div
							class="w-full aspect-square bg-muted flex items-center justify-center rounded overflow-hidden"
						>
							{#if isImage(rec.file_name)}
								<img
									src={apiImageUrlByIdForType('files', rec.id)}
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
							title={rec.image_name || rec.file_name}
						>
							{rec.image_name || rec.file_name}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
