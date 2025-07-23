<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { filteredImageList } from '$lib/stores/imageList';
	import FiltersPopup from './FiltersPopup.svelte';
	import SettingsPopup from './SettingsPopup.svelte';
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { Input } from '$lib/components/ui/sidebar/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	// import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { ChevronDown, ChevronsUpDownIcon } from 'lucide-svelte';

	let imageLists = $state<{
		inBoth: string[];
		inAssetsOnly: string[];
	}>({
		inBoth: [],
		inAssetsOnly: []
	});
	let view = $state<'linked' | 'unlinked'>('linked');
	let loading = $state(true);

	let { collapsed = $bindable() } = $props();

	let searchQuery = $state('');
	let selectedField = $state('');
	let filterForEmpty = $state(false);
	let schemaFields = $state<string[]>([]);
	let showFiltersPopup = $state(false);
	let showSettingsPopup = $state(false);

	// This will hold the filenames actually displayed in the sidebar
	let displayedFilenames = $state<string[]>([]);
	
	// Map filename to properties for display names
	let imageProperties = $state<Map<string, any>>(new Map());
	
	// Upload-related state variables
	let fileInput: HTMLInputElement | undefined; // Reference to hidden file input
	let uploading = $state(false); // Track upload status
	let uploadMessage = $state(''); // Status messages for uploads

	// Removed liked/unliked functionality as those fields don't exist

	// Image preview hover state
	let previewImage = $state<string | null>(null);
	let previewPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });
	let previewVisible = $state(false);

	/**
	 * Fetches the schema fields from the API
	 * Used to populate the field selection dropdown in filters
	 */
	async function fetchSchema() {
		try {
			const response = await fetch('/api/schema');
			if (response.ok) {
				const schema = await response.json();
				schemaFields = Object.keys(schema);
				if (schemaFields.length > 0) {
					selectedField = schemaFields[0];
				}
				// Fetch initial image lists after schema is loaded
				await fetchImageLists();
			} else {
				console.error('Failed to fetch schema:', response.status);
			}
		} catch (error) {
			console.error('Error fetching schema:', error);
		}
	}

	/**
	 * Fetches properties for a list of images to get display names
	 * @param filenames - Array of image filenames to fetch properties for
	 */
	async function fetchPropertiesForImages(filenames: string[]) {
		const propertiesMap = new Map();
		await Promise.all(filenames.map(async (filename) => {
			try {
				const response = await fetch(`/api/images/properties/${filename}`);
				if (response.ok) {
					const properties = await response.json();
					propertiesMap.set(filename, properties);
				}
			} catch (error) {
				console.error(`Failed to fetch properties for ${filename}:`, error);
			}
		}));
		imageProperties = propertiesMap;
	}

	/**
	 * Gets the display name for an image
	 * Uses image_name if available, otherwise falls back to file_name or filename
	 * @param filename - The filename to get display name for
	 * @returns Display name for the image
	 */
	function getDisplayName(filename: string): string {
		const properties = imageProperties.get(filename);
		if (properties && properties.image_name && properties.image_name.trim() !== '') {
			return properties.image_name;
		}
		return properties?.file_name || filename;
	}

	// Removed isImageLiked function as liked field doesn't exist

	/**
	 * Fetches image lists based on current filters
	 * Applies search, field, and empty value filters
	 */
	async function fetchImageLists() {
		loading = true;
		const params = new URLSearchParams();

		if (filterForEmpty) {
			params.append('empty', 'true');
			if (selectedField) {
				params.append('field', selectedField);
			}
		} else if (searchQuery && selectedField) {
			params.append('query', searchQuery);
			params.append('field', selectedField);
		}
		// If no filters are applied, fetch all images (no params needed)

		const url = `/api/images/compare?${params.toString()}`;

		try {
			const response = await fetch(url);
			if (response.ok) {
				const data = await response.json();
				imageLists = {
					inBoth: data.inBoth || [],
					inAssetsOnly: data.inAssetsOnly || []
				};
				updateDisplayedFilenames();
			} else {
				console.error('Failed to fetch image lists:', response.status);
			}
		} catch (error) {
			console.error('Error fetching image lists:', error);
		}
		loading = false;
	}

	/**
	 * Updates the displayed filenames based on current view and filters
	 * Updates the store with the current list
	 */
	function updateDisplayedFilenames() {
		displayedFilenames = view === 'linked' ? imageLists.inBoth : imageLists.inAssetsOnly;
		
		// Set the store to match the displayed list
		filteredImageList.set(displayedFilenames);
		// Fetch properties for display names
		fetchPropertiesForImages(displayedFilenames);
	}

	// When view changes, update displayedFilenames and store
	$effect(() => {
		updateDisplayedFilenames();
	});

	onMount(fetchSchema);

	$effect(() => {
		// This will re-run whenever searchQuery, selectedField, or filterForEmpty changes
		// We need to read the variables inside the effect for them to be tracked
		const query = searchQuery;
		const field = selectedField;
		const empty = filterForEmpty;
		
		// Trigger the fetch when any of these values change
		fetchImageLists();
	});

	/**
	 * Triggers the hidden file input to open file selection dialog
	 * Only allows image file types to be selected
	 */
	function triggerFileUpload() {
		if (fileInput) {
			fileInput.click();
		}
	}

	/**
	 * Handles the file upload process after user selects a file
	 * Validates file type, uploads to server, and refreshes the image list
	 * 
	 * #NOTE: Future concerns:
	 * - Progress indication: Could add upload progress bar for large files
	 * - Multiple file uploads: Currently only handles single file selection
	 * - Upload queue: No queuing system for multiple sequential uploads
	 * - Drag & drop: Could enhance UX with drag-and-drop functionality
	 */
	async function handleFileUpload(event: Event) {
		const target = event.target as HTMLInputElement;
		const file = target.files?.[0];
		
		if (!file) return;

		// Client-side validation for file type
		const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/svg+xml'];
		if (!allowedTypes.includes(file.type)) {
			uploadMessage = 'Error: Please select a valid image file (JPEG, PNG, GIF, or SVG)';
			setTimeout(() => uploadMessage = '', 3000);
			return;
		}

		uploading = true;
		uploadMessage = 'Uploading...';

		try {
			// Create FormData to send the file
			const formData = new FormData();
			formData.append('image', file);

			// Send the upload request
			const response = await fetch('/api/images/upload', {
				method: 'POST',
				body: formData
			});

			if (response.ok) {
				const result = await response.json();
				uploadMessage = `✅ ${result.message}`;
				
				// Refresh the image lists to show the new upload
				await fetchImageLists();
				
				// Clear the file input for future uploads
				target.value = '';
			} else {
				const errorData = await response.json();
				uploadMessage = `❌ Upload failed: ${errorData.message || 'Unknown error'}`;
			}
		} catch (error) {
			console.error('Upload error:', error);
			uploadMessage = '❌ Upload failed: Network error';
		} finally {
			uploading = false;
			// Clear message after 3 seconds
			setTimeout(() => uploadMessage = '', 3000);
		}
	}

	// Removed handleFiltersApply as advanced filters are now just a coming soon message

	/**
	 * Handles closing the filters popup
	 */
	function handleFiltersClose() {
		showFiltersPopup = false;
	}

	/**
	 * Handles mouse entering an image item to show preview
	 * @param event - The mouse event
	 * @param filename - The filename of the image to preview
	 */
	function handleImageMouseEnter(event: MouseEvent, filename: string) {
		previewImage = filename;
		updatePreviewPosition(event);
		previewVisible = true;
	}

	/**
	 * Handles mouse leaving an image item to hide preview
	 */
	function handleImageMouseLeave() {
		previewVisible = false;
		previewImage = null;
	}

	/**
	 * Updates the preview position based on mouse coordinates
	 * @param event - The mouse event
	 */
	function updatePreviewPosition(event: MouseEvent) {
		const offset = 20;
		const previewWidth = 200;
		const previewHeight = 200;
		const padding = 10;
		
		let x = event.clientX + offset;
		let y = event.clientY + offset;
		
		// Check if preview would go off-screen horizontally
		if (x + previewWidth > window.innerWidth - padding) {
			x = event.clientX - previewWidth - offset;
		}
		
		// Check if preview would go off-screen vertically
		if (y + previewHeight > window.innerHeight - padding) {
			y = event.clientY - previewHeight - offset;
		}
		
		// Ensure preview doesn't go off-screen on left or top
		x = Math.max(padding, x);
		y = Math.max(padding, y);
		
		previewPosition = { x, y };
	}

	/**
	 * Handles mouse movement over an image item to update preview position
	 * @param event - The mouse event
	 */
	function handleImageMouseMove(event: MouseEvent) {
		if (previewVisible) {
			updatePreviewPosition(event);
		}
	}
</script>

<!-- <div class="sidebar" class:collapsed> -->
 <Sidebar.Root>
	<Sidebar.Header>
		<div class="flex flex-row justify-between items-center">
			<h2>Image Manager</h2>
			<Button variant="outline" size="icon" onclick={() => (showSettingsPopup = true)} title="Settings">
				⚙️
			</Button>
		</div>
		<Sidebar.Separator />
		<Sidebar.Group>
			<Collapsible.Root>
				<div class="flex flex-row gap-2 items-center justify-between">
					<Sidebar.GroupLabel>Upload</Sidebar.GroupLabel>
					<Collapsible.Trigger class={buttonVariants({ variant: "ghost", size: "sm", class: "w-9 p-0" })}>
						<ChevronsUpDownIcon />
					</Collapsible.Trigger>
				</div>
				<Collapsible.Content>
					<div class="flex flex-col gap-2">
						<Button 
							class="upload-btn" 
							onclick={triggerFileUpload} 
							disabled={uploading}
							title="Upload new image"
						>
							{uploading ? '⏳ Uploading...' : '📁 Upload Image'}
						</Button>
						<Button variant="outline" onclick={fetchImageLists} title="Refresh lists">
							🔄 Refresh
						</Button>
					</div>
					<!-- Hidden file input for image uploads -->
					<!-- TODO wtf is this input below -->
					<input 
						type="file" 
						bind:this={fileInput}
						onchange={handleFileUpload}
						accept="image/*"
						style="display: none;"
						aria-label="Upload image file"
					/>
					
					<!-- Upload status message -->
					{#if uploadMessage}
						<div class="upload-message">
							{uploadMessage}
						</div>
					{/if}
				</Collapsible.Content>
			</Collapsible.Root>
		</Sidebar.Group>

		<!-- Search Section -->
		<Sidebar.Separator />
		<Sidebar.Group>
			<Collapsible.Root>
				<div class="flex flex-row gap-2 items-center justify-between">
					<Sidebar.GroupLabel>Search</Sidebar.GroupLabel>
					<Collapsible.Trigger class={buttonVariants({ variant: "ghost", size: "sm", class: "w-9 p-0" })}>
						<ChevronsUpDownIcon />
					</Collapsible.Trigger>
				</div>
				<Collapsible.Content>
					<div class="flex flex-col gap-2">
						<div class="flex flex-row gap-2 items-center h-full w-full justify-between">
							<Input
								type="text"
								placeholder="Search images..."
								bind:value={searchQuery}
								disabled={filterForEmpty}
								class="search-input"
							/>
							<Button 
								variant="outline"
								class="clear-search-btn"
								onclick={() => (searchQuery = '')}
								title="Clear search"
								size="icon"
								disabled={searchQuery.length === 0}
							>
								×
							</Button>
						</div>
						<Select.Root type="single" bind:value={selectedField}>
							<Select.Trigger class="w-full">
								<!-- <Select.Value placeholder="Select a field" /> -->
								{selectedField}
							</Select.Trigger>
							<Select.Content>
								{#each schemaFields as field}
									<Select.Item value={field}>{field}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<div class="flex flex-row items-center gap-2">
							<Checkbox id="filter-for-empty" bind:checked={filterForEmpty} />
							<Label for="filter-for-empty">Filter for empty</Label>
						</div>
					</div>
				</Collapsible.Content>
			</Collapsible.Root>
		</Sidebar.Group>

		<!-- Filters Section -->
		<Sidebar.Separator />
		<Sidebar.Group>
			<Sidebar.GroupLabel>Filters</Sidebar.GroupLabel>
			<div class="filter-controls">
				<div class="flex flex-row gap-2 items-center justify-center">
					<Button variant={view === 'linked' ? 'default' : 'outline'} onclick={() => (view = 'linked')}>
						Linked
					</Button>
					<Button variant={view === 'unlinked' ? 'default' : 'outline'} onclick={() => (view = 'unlinked')}>
						Unlinked
					</Button>
				</div>
				<!-- <Button variant="outline" onclick={() => (showFiltersPopup = true)}>
					🔍 Advanced Filters
				</Button> -->
			</div>
		</Sidebar.Group>
		<Sidebar.Separator />
	</Sidebar.Header>
	
	<!-- Removed Key Section as liked/unliked fields don't exist -->

	<!-- Upload Section -->
	<Sidebar.Content>

	<!-- Image List -->
	 <Sidebar.Group>
		<Sidebar.GroupLabel>
			Images ({displayedFilenames.length})
		</Sidebar.GroupLabel>
		<ul class="file-list">
			{#if loading}
				<li class="loading">Loading...</li>
			{:else}
				{#if displayedFilenames.length > 0}
					{#each displayedFilenames as filename (filename)}
						<a
							href="/edit/{filename}?view={view}"
							class:selected={$page.params.filename === filename}
						>
							<Button 
								variant={$page.params.filename === filename ? 'default' : 'ghost'}
								class="w-full justify-start"
								onmouseenter={(e) => handleImageMouseEnter(e, filename)}
								onmouseleave={handleImageMouseLeave}
								onmousemove={handleImageMouseMove}
							>
								{getDisplayName(filename)}
							</Button>
						</a>
					{/each}
				{:else}
					<li class="no-images">No {view} images found.</li>
				{/if}
			{/if}
		</ul>
	</Sidebar.Group>
</Sidebar.Content>
</Sidebar.Root>

<!-- Filters Popup -->
<FiltersPopup 
	bind:show={showFiltersPopup}
	bind:searchQuery
	bind:selectedField
	bind:filterForEmpty
	{schemaFields}
	onApply={() => {}}
	onClose={handleFiltersClose}
/>

<!-- Settings Popup -->
<SettingsPopup 
	bind:isOpen={showSettingsPopup}
	onClose={() => (showSettingsPopup = false)}
/>

<!-- Image Preview Hover -->
{#if previewVisible && previewImage}
	<div 
		class="image-preview"
		style="left: {previewPosition.x}px; top: {previewPosition.y}px;"
	>
		<img 
			src="/api/images/{previewImage}" 
			alt="Preview of {getDisplayName(previewImage)}"
			onerror={() => {
				// Hide preview if image fails to load
				previewVisible = false;
			}}
		/>
		<div class="preview-info">
			<span class="preview-name">{getDisplayName(previewImage)}</span>
		</div>
	</div>
{/if}

<style>
	.search-controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.search-input-group {
		position: relative;
		display: flex;
		align-items: center;
	}
	.search-checkbox {
		display: flex;
		align-items: center;
	}

	.search-checkbox label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		font-size: 0.9rem;
		color: #333;
	}
	.filter-controls {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.view-toggle {
		display: flex;
		gap: 0.5rem;
	}

	.file-list {
		list-style: none;
		padding: 0;
		margin: 0;
		overflow-y: auto;
		flex-grow: 1;
	}

	.file-list a {
		text-decoration: none;
		color: inherit;
		display: block;
	}

	/* Removed liked-indicator styles as liked functionality was removed */

	.loading,
	.no-images {
		padding: 1rem;
		text-align: center;
		color: #666;
		font-style: italic;
	}

	.upload-message {
		background: #f0f8ff;
		border: 1px solid #cce5ff;
		border-radius: 6px;
		padding: 0.5rem;
		margin-top: 0.5rem;
		font-size: 0.9rem;
		text-align: center;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.search-controls,
		.filter-controls {
			flex-direction: row;
			flex-wrap: wrap;
		}
	}

	/* Image Preview Hover Styles */
	.image-preview {
		position: fixed;
		z-index: 2000;
		background: white;
		border-radius: 12px;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15), 0 8px 25px rgba(0, 0, 0, 0.1);
		overflow: hidden;
		max-width: 200px;
		max-height: 200px;
		pointer-events: none;
		transform: translateZ(0) scale(0.9);
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		border: 2px solid #f0f0f0;
		backdrop-filter: blur(10px);
		animation: previewSlideIn 0.3s ease-out;
	}

	@keyframes previewSlideIn {
		from {
			opacity: 0;
			transform: translateZ(0) scale(0.8) translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateZ(0) scale(1) translateY(0);
		}
	}

	.image-preview img {
		width: 100%;
		height: auto;
		max-height: 150px;
		object-fit: cover;
		display: block;
		transition: transform 0.3s ease;
	}

	.image-preview:hover img {
		transform: scale(1.05);
	}

	.preview-info {
		padding: 0.75rem;
		background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
		border-top: 1px solid #e0e0e0;
	}

	.preview-name {
		font-size: 0.85rem;
		color: #333;
		font-weight: 600;
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 100%;
		letter-spacing: 0.25px;
	}
</style>