<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import {
		FolderOpen,
		Image,
		FileJson,
		Plus,
		Pencil,
		Trash2,
		Settings,
		MoreVertical,
		Info
	} from 'lucide-svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import AppearanceSettings from '$lib/components/AppearanceSettings.svelte';
	import {
		apiListMediaTypes,
		apiCreateMediaType,
		apiRenameMediaType,
		apiDeleteMediaType,
		apiGetMediaTypeStats,
		type MediaTypeSummary
	} from '$lib/api/client.js';

	let mediaTypes = $state<MediaTypeSummary[]>([]);
	let loading = $state(true);
	let createOpen = $state(false);
	let createStep = $state(1);
	let createDisplayName = $state('');
	let createKind = $state<'images' | 'json'>('json');
	let createSubmitting = $state(false);
	let renameOpen = $state(false);
	let renameTypeId = $state<string | null>(null);
	let renameDisplayName = $state('');
	let renameSubmitting = $state(false);
	let deleteOpen = $state(false);
	let deleteTypeId = $state<string | null>(null);
	let deleteDisplayName = $state('');
	let deleteSubmitting = $state(false);
	let globalSettingsOpen = $state(false);
	let infoOpen = $state(false);
	let infoMediaType = $state<MediaTypeSummary | null>(null);
	let infoStats = $state<{ recordCount: number; kind: string; lastUpdated: string | null } | null>(
		null
	);
	let infoStatsLoading = $state(false);

	async function loadMediaTypes() {
		loading = true;
		try {
			mediaTypes = await apiListMediaTypes();
		} catch (e) {
			console.error('Failed to list media types:', e);
			toast.error('Failed to load media types');
			mediaTypes = [];
		} finally {
			loading = false;
		}
	}

	function openCreate() {
		createOpen = true;
		createStep = 1;
		createDisplayName = '';
		createKind = 'json';
		createSubmitting = false;
	}

	async function submitCreate() {
		if (createStep === 1) {
			createStep = 2;
			return;
		}
		if (!createDisplayName.trim()) {
			toast.error('Enter a display name');
			return;
		}
		createSubmitting = true;
		try {
			const created = await apiCreateMediaType({
				displayName: createDisplayName.trim(),
				kind: createKind
			});
			createOpen = false;
			toast.success(`Created "${created.displayName}"`);
			await loadMediaTypes();
			goto(`/media/${created.id}`);
		} catch (e) {
			console.error('Create media type failed:', e);
			toast.error((e as Error)?.message ?? 'Failed to create media type');
		} finally {
			createSubmitting = false;
		}
	}

	function openRename(m: MediaTypeSummary) {
		renameTypeId = m.id;
		renameDisplayName = m.displayName ?? m.id;
		renameOpen = true;
		renameSubmitting = false;
	}

	async function submitRename() {
		if (!renameTypeId || !renameDisplayName.trim()) return;
		renameSubmitting = true;
		try {
			await apiRenameMediaType(renameTypeId, renameDisplayName.trim());
			renameOpen = false;
			toast.success('Renamed');
			await loadMediaTypes();
		} catch (e) {
			console.error('Rename failed:', e);
			toast.error((e as Error)?.message ?? 'Failed to rename');
		} finally {
			renameSubmitting = false;
		}
	}

	function openDelete(m: MediaTypeSummary) {
		deleteTypeId = m.id;
		deleteDisplayName = m.displayName ?? m.id;
		deleteOpen = true;
		deleteSubmitting = false;
	}

	async function submitDelete() {
		if (!deleteTypeId) return;
		deleteSubmitting = true;
		try {
			await apiDeleteMediaType(deleteTypeId);
			deleteOpen = false;
			toast.success('Deleted');
			await loadMediaTypes();
		} catch (e) {
			console.error('Delete failed:', e);
			toast.error((e as Error)?.message ?? 'Failed to delete');
		} finally {
			deleteSubmitting = false;
		}
	}

	function openInfo(m: MediaTypeSummary) {
		infoMediaType = m;
		infoOpen = true;
		infoStats = null;
		infoStatsLoading = true;
		apiGetMediaTypeStats(m.id)
			.then((stats) => {
				infoStats = {
					recordCount: stats.recordCount,
					kind: stats.kind,
					lastUpdated: stats.lastUpdated
				};
			})
			.catch((e) => {
				console.error('Failed to load media type stats:', e);
				toast.error('Failed to load info');
			})
			.finally(() => {
				infoStatsLoading = false;
			});
	}

	function closeInfo() {
		infoOpen = false;
		infoMediaType = null;
		infoStats = null;
	}

	$effect(() => {
		loadMediaTypes();
	});
</script>

<div class="min-h-screen p-6 md:p-10">
	<div class="mx-auto max-w-4xl">
		<div class="flex flex-col gap-6">
			<div class="flex flex-wrap items-center justify-between gap-4">
				<h1 class="text-2xl font-semibold tracking-tight">Media types</h1>
				<div class="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						title="Global settings"
						onclick={() => (globalSettingsOpen = true)}
					>
						<Settings class="h-4 w-4" />
					</Button>
					<Button onclick={openCreate}>
						<Plus class="mr-2 h-4 w-4" />
						Create new
					</Button>
				</div>
			</div>

			{#if loading}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each [1, 2, 3] as _}
						<Card.Root class="h-32 animate-pulse rounded-lg bg-muted" />
					{/each}
				</div>
			{:else if mediaTypes.length === 0}
				<Card.Root class="border-dashed">
					<Card.Content class="flex flex-col items-center justify-center gap-4 py-16">
						<p class="text-muted-foreground text-center">No media types yet.</p>
						<Button onclick={openCreate}>
							<Plus class="mr-2 h-4 w-4" />
							Create your first media type
						</Button>
					</Card.Content>
				</Card.Root>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{#each mediaTypes as m}
						<Card.Root class="flex flex-col">
							<Card.Header class="flex flex-row items-start justify-between gap-2 space-y-0">
								<div class="flex items-center gap-2">
									{#if m.kind === 'images'}
										<Image class="h-5 w-5 text-muted-foreground" />
									{:else}
										<FileJson class="h-5 w-5 text-muted-foreground" />
									{/if}
									<Card.Title class="text-lg">{m.displayName ?? m.id}</Card.Title>
								</div>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger
										class="inline-flex h-8 w-8 items-center justify-center rounded-md border-0 hover:bg-accent hover:text-accent-foreground"
									>
										<span class="sr-only">More options</span>
										<MoreVertical class="h-4 w-4" />
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Item onclick={() => openInfo(m)}>
											<Info class="mr-2 h-4 w-4" />
											Info
										</DropdownMenu.Item>
										<DropdownMenu.Item onclick={() => openRename(m)}>
											<Pencil class="mr-2 h-4 w-4" />
											Rename
										</DropdownMenu.Item>
										{#if m.id === 'files'}
											<DropdownMenu.Item disabled class="text-muted-foreground">
												<Trash2 class="mr-2 h-4 w-4" />
												Delete (Protected)
											</DropdownMenu.Item>
										{:else}
											<DropdownMenu.Item
												class="text-destructive focus:text-destructive"
												onclick={() => openDelete(m)}
											>
												<Trash2 class="mr-2 h-4 w-4" />
												Delete
											</DropdownMenu.Item>
										{/if}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							</Card.Header>
							<Card.Content class="flex-1">
								<p class="text-muted-foreground text-sm">
									{m.kind === 'images' ? 'Images with metadata' : 'Pure JSON records'}
								</p>
							</Card.Content>
							<Card.Footer>
								<Button class="w-full" onclick={() => goto(`/media/${m.id}`)}>
									<FolderOpen class="mr-2 h-4 w-4" />
									Open
								</Button>
							</Card.Footer>
						</Card.Root>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Create wizard -->
<Dialog.Root bind:open={createOpen}>
	<Dialog.Content>
		<Dialog.Title>{createStep === 1 ? 'Create media type' : 'Choose type'}</Dialog.Title>
		<Dialog.Description>
			{createStep === 1
				? 'Give it a display name. The folder name will be derived from this.'
				: 'Images: files + metadata. Pure JSON: metadata only (e.g. projects list).'}
		</Dialog.Description>
		{#if createStep === 1}
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="create-display-name">Display name</Label>
					<Input
						id="create-display-name"
						bind:value={createDisplayName}
						placeholder="e.g. My Projects"
					/>
				</div>
			</div>
		{:else}
			<div class="grid gap-4 py-4">
				<div class="flex gap-4">
					<Button
						variant={createKind === 'images' ? 'default' : 'outline'}
						class="flex-1"
						onclick={() => (createKind = 'images')}
					>
						<Image class="mr-2 h-4 w-4" />
						Images
					</Button>
					<Button
						variant={createKind === 'json' ? 'default' : 'outline'}
						class="flex-1"
						onclick={() => (createKind = 'json')}
					>
						<FileJson class="mr-2 h-4 w-4" />
						Pure JSON
					</Button>
				</div>
			</div>
		{/if}
		<Dialog.Footer>
			{#if createStep === 1}
				<Button variant="outline" onclick={() => (createOpen = false)}>Cancel</Button>
				<Button onclick={submitCreate}>Next</Button>
			{:else}
				<Button variant="outline" onclick={() => (createStep = 1)}>Back</Button>
				<Button disabled={createSubmitting} onclick={submitCreate}>
					{createSubmitting ? 'Creating…' : 'Create'}
				</Button>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Rename -->
<Dialog.Root bind:open={renameOpen}>
	<Dialog.Content>
		<Dialog.Title>Rename media type</Dialog.Title>
		<Dialog.Description>Change the display name. The folder name stays the same.</Dialog.Description
		>
		<div class="grid gap-4 py-4">
			<div class="grid gap-2">
				<Label for="rename-display-name">Display name</Label>
				<Input id="rename-display-name" bind:value={renameDisplayName} />
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (renameOpen = false)}>Cancel</Button>
			<Button disabled={renameSubmitting || !renameDisplayName.trim()} onclick={submitRename}>
				{renameSubmitting ? 'Saving…' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete media type?</AlertDialog.Title>
		<AlertDialog.Description>
			Delete "{deleteDisplayName}" and all its data? This cannot be undone.
		</AlertDialog.Description>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
				onclick={submitDelete}
				disabled={deleteSubmitting}
			>
				{deleteSubmitting ? 'Deleting…' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Global settings (appearance) -->
<Dialog.Root bind:open={globalSettingsOpen}>
	<Dialog.Content>
		<Dialog.Title>Global settings</Dialog.Title>
		<Dialog.Description>Appearance and other app-wide settings.</Dialog.Description>
		<div class="py-4">
			<AppearanceSettings />
		</div>
		<Dialog.Footer>
			<Button variant="default" onclick={() => (globalSettingsOpen = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<!-- Info popup -->
<Dialog.Root bind:open={infoOpen}>
	<Dialog.Content>
		<Dialog.Title
			>Info: {infoMediaType?.displayName ?? infoMediaType?.id ?? 'Media type'}</Dialog.Title
		>
		<Dialog.Description>Details about this media group.</Dialog.Description>
		{#if infoMediaType}
			<dl class="grid gap-2 py-4 text-sm">
				<div>
					<dt class="font-medium text-muted-foreground">Folder name</dt>
					<dd class="mt-0.5 font-mono">{infoMediaType.id}</dd>
				</div>
				<div>
					<dt class="font-medium text-muted-foreground">Group type</dt>
					<dd class="mt-0.5">{infoMediaType.kind === 'images' ? 'Images' : 'Pure JSON records'}</dd>
				</div>
				<div>
					<dt class="font-medium text-muted-foreground">Amount</dt>
					<dd class="mt-0.5">
						{#if infoStatsLoading}
							Loading…
						{:else if infoStats != null}
							{infoStats.recordCount} {infoMediaType.kind === 'images' ? 'images' : 'records'}
						{:else}
							—
						{/if}
					</dd>
				</div>
				<div>
					<dt class="font-medium text-muted-foreground">Last updated</dt>
					<dd class="mt-0.5">
						{#if infoStatsLoading}
							Loading…
						{:else if infoStats?.lastUpdated}
							{new Date(infoStats.lastUpdated).toLocaleString()}
						{:else}
							—
						{/if}
					</dd>
				</div>
			</dl>
		{/if}
		<Dialog.Footer>
			<Button variant="default" onclick={closeInfo}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
