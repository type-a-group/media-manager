<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiListClasses, apiListFiles } from '$lib/api/files.js';
	import { apiListMediaTypes, apiCreateMediaType, type MediaTypeSummary } from '$lib/api/client.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import SettingsButton from '$lib/components/SettingsButton.svelte';
	import { apiCreateClass } from '$lib/api/files.js';
	import { Files, FolderOpen, FileJson, Plus } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import type { ClassSummary } from '$lib/core/types.js';

	/**
	 * Dashboard landing: an overview of everything in the workspace as cards — All Files (the blob
	 * hub), each class, and each `json` record type — plus toolbar actions to create a class or a
	 * record type and open global settings. Cards drill into `/files`, `/files?class=<id>`, or
	 * `/media/<typeId>`.
	 */
	let classes = $state<ClassSummary[]>([]);
	let recordTypes = $state<MediaTypeSummary[]>([]);
	let totalFiles = $state(0);
	let loading = $state(true);

	let newClassOpen = $state(false);
	let newClassName = $state('');
	let newTypeOpen = $state(false);
	let newTypeName = $state('');

	async function load() {
		loading = true;
		try {
			const [cls, types, files] = await Promise.all([
				apiListClasses(),
				apiListMediaTypes().catch(() => []),
				apiListFiles().catch(() => ({ files: [] }))
			]);
			classes = cls;
			recordTypes = types;
			totalFiles = files.files.length;
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function createClass() {
		const name = newClassName.trim();
		if (!name) return;
		try {
			const created = await apiCreateClass(name);
			newClassName = '';
			newClassOpen = false;
			goto(`/files?class=${created.id}`);
		} catch (e) {
			console.error(e);
			toast.error('Failed to create class');
		}
	}

	async function createRecordType() {
		const name = newTypeName.trim();
		if (!name) return;
		try {
			const created = await apiCreateMediaType({ displayName: name, kind: 'json' });
			newTypeName = '';
			newTypeOpen = false;
			goto(`/media?type=${created.id}`);
		} catch (e) {
			console.error(e);
			toast.error('Failed to create record type');
		}
	}
</script>

<div class="mx-auto max-w-5xl p-6">
	<header class="mb-6 flex items-center gap-3">
		<h1 class="text-2xl font-semibold">Overview</h1>
		<div class="flex-1"></div>
		<Button variant="outline" size="sm" onclick={() => (newClassOpen = true)}>
			<Plus class="size-4" /> New class
		</Button>
		<Button variant="outline" size="sm" onclick={() => (newTypeOpen = true)}>
			<Plus class="size-4" /> New record type
		</Button>
		<SettingsButton />
	</header>

	{#if loading}
		<p class="text-muted-foreground">Loading…</p>
	{:else}
		<section class="mb-6">
			<h2 class="mb-2 text-xs font-semibold uppercase text-muted-foreground">Files</h2>
			<div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
				<a href="/files" class="block">
					<Card.Root class="h-full transition-colors hover:border-primary hover:bg-muted/40">
						<Card.Header>
							<Files class="size-6 text-muted-foreground" />
							<Card.Title>All Files</Card.Title>
							<Card.Description>{totalFiles} file{totalFiles === 1 ? '' : 's'}</Card.Description>
						</Card.Header>
					</Card.Root>
				</a>
				{#each classes as c (c.id)}
					<a href={`/files?class=${c.id}`} class="block">
						<Card.Root class="h-full transition-colors hover:border-primary hover:bg-muted/40">
							<Card.Header>
								<FolderOpen class="size-6 text-muted-foreground" />
								<Card.Title class="truncate">{c.displayName}</Card.Title>
								<Card.Description>{c.count} file{c.count === 1 ? '' : 's'}</Card.Description>
							</Card.Header>
						</Card.Root>
					</a>
				{/each}
			</div>
		</section>

		{#if recordTypes.length > 0}
			<section>
				<h2 class="mb-2 text-xs font-semibold uppercase text-muted-foreground">Records</h2>
				<div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
					{#each recordTypes as t (t.id)}
						<a href={`/media?type=${t.id}`} class="block">
							<Card.Root class="h-full transition-colors hover:border-primary hover:bg-muted/40">
								<Card.Header>
									<FileJson class="size-6 text-muted-foreground" />
									<Card.Title class="truncate">{t.displayName}</Card.Title>
									<Card.Description>{t.id === 'globals' ? 'Singleton' : 'Records'}</Card.Description
									>
								</Card.Header>
							</Card.Root>
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<Dialog.Root bind:open={newClassOpen}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Title>New class</Dialog.Title>
		<Dialog.Description
			>A class is a schema + opt-in per-file metadata over your blobs.</Dialog.Description
		>
		<div class="flex flex-col gap-2 py-2">
			<Label for="new-class-name">Name</Label>
			<Input
				id="new-class-name"
				bind:value={newClassName}
				placeholder="Class name"
				onkeydown={(e) => e.key === 'Enter' && createClass()}
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (newClassOpen = false)}>Cancel</Button>
			<Button onclick={createClass} disabled={!newClassName.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={newTypeOpen}>
	<Dialog.Content class="max-w-sm">
		<Dialog.Title>New record type</Dialog.Title>
		<Dialog.Description>A `json` record type — pure records, no file attachment.</Dialog.Description
		>
		<div class="flex flex-col gap-2 py-2">
			<Label for="new-type-name">Name</Label>
			<Input
				id="new-type-name"
				bind:value={newTypeName}
				placeholder="Record type name"
				onkeydown={(e) => e.key === 'Enter' && createRecordType()}
			/>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (newTypeOpen = false)}>Cancel</Button>
			<Button onclick={createRecordType} disabled={!newTypeName.trim()}>Create</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
