<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { InfoIcon } from 'lucide-svelte';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { ChevronsUpDownIcon } from 'lucide-svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { toast } from 'svelte-sonner';
	import {
		apiGetFileMetadataById,
		apiGetFileMetadataByIdForType,
		apiStripFileMetadataById,
		apiStripFileMetadataByIdForType
	} from '$lib/api/client.js';
	import type { ImageId } from '$lib/core/ids.js';

	/** Image record id (required for fetching by-id). Media type id when in media-type context. Filename for display only. */
	let { id = undefined as ImageId | undefined, typeId = undefined as string | undefined, filename = undefined as string | undefined } = $props();

	let isOpen = $state(false);
	let metadata = $state<Record<string, any> | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let stripLoading = $state(false);
	let confirmClearAllOpen = $state(false);
	let confirmClearGpsOpen = $state(false);

	/**
	 * Fetch metadata from the API by image id (and optional typeId).
	 * Uses type-scoped or default file-metadata endpoint.
	 *
	 * @param imageId - Image record id
	 * @param mediaTypeId - Optional media type id for type-scoped API
	 */
	async function fetchMetadata(imageId: ImageId, mediaTypeId?: string) {
		loading = true;
		error = null;
		metadata = null;

		try {
			metadata = mediaTypeId
				? await apiGetFileMetadataByIdForType(mediaTypeId, imageId)
				: await apiGetFileMetadataById(imageId);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to fetch metadata';
			console.error('Error fetching metadata:', err);
		} finally {
			loading = false;
		}
	}
	
	/**
	 * Format a value for display, handling various data types
	 * 
	 * @param value - The value to format
	 * @returns Formatted string representation
	 */
	function formatValue(value: any): string {
		if (value === null || value === undefined) {
			return 'N/A';
		}
		
		if (typeof value === 'boolean') {
			return value ? 'Yes' : 'No';
		}
		
		if (value instanceof Date) {
			return value.toLocaleString();
		}
		
		if (typeof value === 'object') {
			return JSON.stringify(value, null, 2);
		}
		
		return String(value);
	}
	
	/**
	 * Human-readable format name for an extension (e.g. .jpg -> JPEG).
	 */
	function formatLabel(ext: string): string {
		const e = (ext || '').toLowerCase();
		if (e === '.jpg' || e === '.jpeg') return 'JPEG';
		if (e === '.png') return 'PNG';
		if (e === '.webp') return 'WebP';
		return ext || 'unknown';
	}

	/**
	 * Get display label for metadata keys
	 * Converts camelCase to readable format
	 *
	 * @param key - The metadata key
	 * @returns Human-readable label
	 */
	function getDisplayLabel(key: string): string {
		const labelMap: Record<string, string> = {
			filename: 'Filename',
			fileSize: 'File Size (bytes)',
			fileSizeFormatted: 'File Size',
			dateCreated: 'Date Created',
			dateModified: 'Date Modified',
			width: 'Width',
			height: 'Height',
			format: 'Format',
			density: 'Density (DPI)',
			channels: 'Channels',
			depth: 'Bit Depth',
			space: 'Color Space',
			hasAlpha: 'Has Alpha Channel',
			hasProfile: 'Has Color Profile',
			exif: 'EXIF Data',
			orientation: 'Orientation',
			compression: 'Compression',
			resolutionUnit: 'Resolution Unit',
			isProgressive: 'Progressive',
			pages: 'Pages',
			pageHeight: 'Page Height',
			loop: 'Loop',
			delay: 'Delay',
			aspectRatio: 'Aspect Ratio',
			megapixels: 'Megapixels'
		};
		
		return labelMap[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
	}
	
	/**
	 * Strip all metadata from the image, then refetch.
	 */
	async function handleStripAll() {
		if (!id) return;
		stripLoading = true;
		confirmClearAllOpen = false;
		try {
			if (typeId) {
				metadata = await apiStripFileMetadataByIdForType(typeId, id, 'all');
			} else {
				metadata = await apiStripFileMetadataById(id, 'all');
			}
			toast.success('All metadata removed');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to strip metadata');
		} finally {
			stripLoading = false;
		}
	}

	/**
	 * Strip only GPS/location metadata, then refetch.
	 */
	async function handleStripGps() {
		if (!id) return;
		stripLoading = true;
		confirmClearGpsOpen = false;
		try {
			if (typeId) {
				metadata = await apiStripFileMetadataByIdForType(typeId, id, 'gps');
			} else {
				metadata = await apiStripFileMetadataById(id, 'gps');
			}
			toast.success('GPS metadata removed');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to strip GPS metadata');
		} finally {
			stripLoading = false;
		}
	}

	// Fetch metadata when dialog opens and we have an id
	$effect(() => {
		if (isOpen && id) {
			fetchMetadata(id, typeId);
		}
	});
</script>

<Dialog.Root bind:open={isOpen}>
	<Tooltip.Root>
		<Tooltip.Trigger>
			<Dialog.Trigger
				class={buttonVariants({ variant: 'outline', size: 'icon' })}
				title="Metadata"
				aria-label="Metadata"
			>
				<InfoIcon />
			</Dialog.Trigger>
		</Tooltip.Trigger>
		<Tooltip.Content side="top" sideOffset={6}>View file metadata</Tooltip.Content>
	</Tooltip.Root>
	<Dialog.Content>
		<Dialog.Title>Image Metadata</Dialog.Title>
		<Dialog.Description>
			View detailed information about the image file.
		</Dialog.Description>
		<div class="flex flex-wrap gap-2 py-2">
			<Button
				variant="outline"
				size="sm"
				disabled={stripLoading || loading || !metadata}
				onclick={() => (confirmClearAllOpen = true)}
			>
				Clear all metadata
			</Button>
			<Button
				variant="outline"
				size="sm"
				disabled={stripLoading || loading || !metadata}
				onclick={() => (confirmClearGpsOpen = true)}
			>
				Clear GPS only
			</Button>
		</div>
		<AlertDialog.Root bind:open={confirmClearAllOpen}>
			<AlertDialog.Content>
				<AlertDialog.Title>Clear all metadata</AlertDialog.Title>
				<AlertDialog.Description>
					Remove all EXIF and other metadata from the file? This cannot be undone.
				</AlertDialog.Description>
				<div class="flex justify-end gap-2 mt-4">
					<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
					<Button type="button" onclick={handleStripAll}>Clear all</Button>
				</div>
			</AlertDialog.Content>
		</AlertDialog.Root>
		<AlertDialog.Root bind:open={confirmClearGpsOpen}>
			<AlertDialog.Content>
				<AlertDialog.Title>Clear GPS only</AlertDialog.Title>
				<AlertDialog.Description>
					Remove only GPS/location data? Other metadata will be kept.
				</AlertDialog.Description>
				<div class="flex justify-end gap-2 mt-4">
					<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
					<Button type="button" onclick={handleStripGps}>Clear GPS</Button>
				</div>
			</AlertDialog.Content>
		</AlertDialog.Root>
		<ScrollArea class="h-[500px]">
		<div class="space-y-6">
			{#if loading}
				<div class="flex items-center justify-center py-8">
					<div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
					<span class="ml-2 text-muted-foreground">Loading metadata...</span>
				</div>
			{:else if error}
				<div class="rounded-md p-4 border border-destructive/30 bg-destructive/10">
					<div class="flex">
						<svg class="w-5 h-5 text-destructive mr-2" fill="currentColor" viewBox="0 0 20 20">
							<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
						</svg>
						<div>
							<h3 class="text-sm font-medium text-foreground">Error loading metadata</h3>
							<p class="text-sm text-muted-foreground mt-1">{error}</p>
						</div>
					</div>
				</div>
			{:else if metadata}
				<div class="space-y-6">
					<!-- Warning when file extension doesn't match image data -->
					{#if metadata.extensionMismatch && metadata.fileExtension != null && metadata.detectedFormatExtension != null}
						<div class="rounded-md p-4 border border-amber-500/50 bg-amber-500/10">
							<div class="flex">
								<svg class="h-5 w-5 text-amber-600 dark:text-amber-500 shrink-0 mr-2" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
									<path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
								</svg>
								<div>
									<h3 class="text-sm font-medium text-amber-800 dark:text-amber-200">Extension doesn't match image data</h3>
									<p class="text-sm text-amber-700 dark:text-amber-300 mt-1">
										This file has a <code class="px-1 py-0.5 rounded bg-amber-500/20 text-xs">{metadata.fileExtension}</code> extension
										but the content appears to be {formatLabel(metadata.detectedFormatExtension)}.
										Consider renaming the file to avoid compatibility issues with some tools.
									</p>
								</div>
							</div>
						</div>
					{/if}
					<!-- Info banner about image format -->
					<div class="rounded-md p-4 border bg-accent/20">
						<div class="flex">
							<svg class="w-5 h-5 text-primary mr-2" fill="currentColor" viewBox="0 0 20 20">
								<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
							</svg>
							<div>
								<h3 class="text-sm font-medium text-foreground">Image Format: {metadata.format?.toUpperCase()}</h3>
								<p class="text-sm text-muted-foreground mt-1">
									{#if metadata.format === 'png'}
										PNG files typically contain basic image properties but limited EXIF data compared to JPEG files.
									{:else if metadata.format === 'jpeg' || metadata.format === 'jpg'}
										JPEG files can contain rich EXIF data including camera settings, GPS coordinates, and creation details.
									{:else}
										Metadata availability varies by image format and creation method.
									{/if}
								</p>
							</div>
						</div>
					</div>
					<!-- Basic Information -->
					<div>
						<h3 class="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
							{#each ['filename', 'fileSizeFormatted', 'dateCreated', 'dateModified'] as key}
								{#if metadata[key] !== undefined}
									<div class="rounded-md p-3 bg-muted">
										<dt class="text-sm font-medium text-muted-foreground">{getDisplayLabel(key)}</dt>
										<dd class="text-sm text-foreground mt-1">{formatValue(metadata[key])}</dd>
									</div>
								{/if}
							{/each}
						</div>
					</div>
					
					<!-- Image Properties -->
					<div>
						<h3 class="text-lg font-semibold text-foreground mb-3">Image Properties</h3>
						<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{#each ['width', 'height', 'format', 'aspectRatio', 'megapixels', 'channels', 'depth', 'density'] as key}
								{#if metadata[key] !== undefined}
									<div class="rounded-md p-3 bg-muted">
										<dt class="text-sm font-medium text-muted-foreground">{getDisplayLabel(key)}</dt>
										<dd class="text-sm text-foreground mt-1">{formatValue(metadata[key])}</dd>
									</div>
								{/if}
							{/each}
						</div>
					</div>
					
					<!-- Color Information -->
					<div>
						<h3 class="text-lg font-semibold text-foreground mb-3">Color Information</h3>
						<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{#each ['space', 'hasAlpha', 'hasProfile', 'orientation'] as key}
								{#if metadata[key] !== undefined}
									<div class="rounded-md p-3 bg-muted">
										<dt class="text-sm font-medium text-muted-foreground">{getDisplayLabel(key)}</dt>
										<dd class="text-sm text-foreground mt-1">{formatValue(metadata[key])}</dd>
									</div>
								{/if}
							{/each}
						</div>
					</div>
					
					<!-- Technical Details -->
					<div>
						<h3 class="text-lg font-semibold text-foreground mb-3">Technical Details</h3>
						<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{#each ['compression', 'resolutionUnit', 'isProgressive', 'pages', 'pageHeight', 'loop', 'delay'] as key}
								{#if metadata[key] !== undefined}
									<div class="rounded-md p-3 bg-muted">
										<dt class="text-sm font-medium text-muted-foreground">{getDisplayLabel(key)}</dt>
										<dd class="text-sm text-foreground mt-1">{formatValue(metadata[key])}</dd>
									</div>
								{/if}
							{/each}
						</div>
					</div>
					
					<!-- EXIF Data -->
					 <Collapsible.Root>
						<div class="flex flex-row gap-2 items-center justify-between">
							<h3 class="text-lg font-semibold text-foreground mb-3">EXIF Data</h3>
							<Collapsible.Trigger class={buttonVariants({ variant: "ghost", size: "sm", class: "w-9 p-0" })}>
								<ChevronsUpDownIcon />
							</Collapsible.Trigger>
						</div>
						<Collapsible.Content>
						{#if metadata.exif && Object.keys(metadata.exif).length > 0}
							<div class="rounded-md p-4 bg-muted">
								<pre class="text-sm text-foreground whitespace-pre-wrap">{formatValue(metadata.exif)}</pre>
							</div>
						{:else}
							<div class="rounded-md p-4 border bg-muted">
								<div class="text-center">
									<svg class="w-8 h-8 text-muted-foreground mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
									</svg>
									<p class="text-sm text-muted-foreground">No EXIF data available</p>
									<p class="text-xs text-muted-foreground mt-1">
										{#if metadata.format === 'png'}
											PNG files typically don't contain traditional EXIF data
										{:else}
											This image may have been processed or edited, removing EXIF data
										{/if}
									</p>
								</div>
							</div>
						{/if}
						</Collapsible.Content>
					</Collapsible.Root>
					
					<!-- Raw EXIF Data (Debug) -->
					<Collapsible.Root>
						<div class="flex flex-row gap-2 items-center justify-between">
							<h3 class="text-lg font-semibold text-foreground mb-3">Raw EXIF Data (Debug)</h3>
							<Collapsible.Trigger class={buttonVariants({ variant: "ghost", size: "sm", class: "w-9 p-0" })}>
								<ChevronsUpDownIcon />
							</Collapsible.Trigger>
						</div>
						<Collapsible.Content>
						{#if metadata.rawExif}
							<div class="rounded-md p-4 bg-muted">
								<div class="space-y-2">
									<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
										<div class="rounded-md p-3 bg-card">
											<dt class="text-sm font-medium text-muted-foreground">Buffer Size</dt>
											<dd class="text-sm text-foreground mt-1">{metadata.rawExif.size} bytes</dd>
										</div>
										<div class="rounded-md p-3 bg-card">
											<dt class="text-sm font-medium text-muted-foreground">Encoding</dt>
											<dd class="text-sm text-foreground mt-1">Base64</dd>
										</div>
									</div>
									<div class="mt-4">
										<dt class="text-sm font-medium text-muted-foreground mb-2">Raw Buffer (Base64)</dt>
										<dd class="rounded-md p-3 bg-card">
											<pre class="text-xs text-foreground whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{metadata.rawExif.buffer}</pre>
										</dd>
									</div>
								</div>
							</div>
						{:else if metadata.exif && Object.keys(metadata.exif).length > 0}
							<div class="rounded-md p-4 bg-muted">
								<p class="text-xs text-muted-foreground mb-2">Parsed tags (exiftool-vendored; no raw EXIF buffer). All metadata read from file:</p>
								<pre class="text-xs text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto">{formatValue(metadata.exif)}</pre>
							</div>
						{:else}
							<div class="rounded-md p-4 border bg-muted">
								<div class="text-center">
									<svg class="w-8 h-8 text-muted-foreground mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"></path>
									</svg>
									<p class="text-sm text-muted-foreground">No raw EXIF buffer available</p>
									<p class="text-xs text-muted-foreground mt-1">This image format doesn't contain raw EXIF data</p>
								</div>
							</div>
						{/if}
						</Collapsible.Content>
					</Collapsible.Root>
				</div>
			{:else}
				<div class="text-center py-8">
					<p class="text-muted-foreground">No metadata to display</p>
				</div>
			{/if}
		</div>
		</ScrollArea>
	</Dialog.Content>
</Dialog.Root>

<style>
	/* Content-specific styles are now handled by Tailwind CSS classes in the template */
</style> 