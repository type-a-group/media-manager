<script lang="ts">
	import { page } from '$app/stores';
	import LightDarkModeButton from './LightDarkModeButton.svelte';
	import { onMount } from 'svelte';
	import { filteredImageList } from '$lib/stores/imageList';
	import * as Sidebar from "$lib/components/ui/sidebar/index.js";
	import { Button, buttonVariants } from "$lib/components/ui/button";
	import { Input } from '$lib/components/ui/sidebar/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { ChevronsUpDownIcon } from 'lucide-svelte';
	import * as HoverCard from '$lib/components/ui/hover-card/index.js';
	import { toast } from 'svelte-sonner';
	import SettingsButton from './SettingsButton.svelte';

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

	// This will hold the filenames actually displayed in the sidebar
	let displayedFilenames = $state<string[]>([]);
	
	// Map filename to properties for display names
	let imageProperties = $state<Map<string, any>>(new Map());
	
	// Upload-related state variables
	let fileInput: HTMLInputElement | undefined; // Reference to hidden file input
	let uploading = $state(false); // Track upload status

	// Removed liked/unliked functionality as those fields don't exist

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
			toast("Error: Please select a valid image file (JPEG, PNG, GIF, or SVG)");
			return;
		}

		uploading = true;

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
				toast("Uploaded successfully");
				
				// Refresh the image lists to show the new upload
				await fetchImageLists();
				
				// Clear the file input for future uploads
				target.value = '';
			} else {
				toast("Upload failed");
			}
		} catch (error) {
			console.error('Upload error:', error);
			toast("Upload failed");
		} finally {
			uploading = false;
		}
	}

	// Removed handleFiltersApply as advanced filters are now just a coming soon message

	/**
	 * Handles closing the filters popup
	 */
	function handleFiltersClose() {
		showFiltersPopup = false;
	}
</script>

<!-- <div class="sidebar" class:collapsed> -->
 <Sidebar.Root>
	<Sidebar.Header>
		<div class="flex flex-row justify-between items-center">
			<h2 class="text-lg font-bold">Image Manager</h2>
			<SettingsButton/>
			<LightDarkModeButton />
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
		<ul>
			{#if loading}
				<li class="italic flex justify-center">Loading...</li>
			{:else}
				{#if displayedFilenames.length > 0}
					{#each displayedFilenames as filename (filename)}
						<a
							href="/edit/{filename}?view={view}"
							class:selected={$page.params.filename === filename}
						>
							<HoverCard.Root openDelay={100} closeDelay={0}>
								<HoverCard.Trigger>
									<Button 
										variant={$page.params.filename === filename ? 'default' : 'ghost'}
										class="w-full justify-start"
									>
										{getDisplayName(filename)}
									</Button>
								</HoverCard.Trigger>
								{#if $page.params.filename !== filename}
									<HoverCard.Content side="right" align="center" class='pointer-events-none flex flex-col gap-2'>
										<img src="/api/images/{filename}" alt="Preview of {getDisplayName(filename)}" />
										<p class="text-sm text-gray-500 break-all">{filename}</p>
									</HoverCard.Content>
								{/if}
							</HoverCard.Root>
						</a>
					{/each}
				{:else}
					<li class="italic flex justify-center">No {view} images found.</li>
				{/if}
			{/if}
		</ul>
	</Sidebar.Group>
</Sidebar.Content>
</Sidebar.Root>
<style>
</style>