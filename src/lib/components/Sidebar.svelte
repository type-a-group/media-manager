<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { filteredImageList } from '$lib/stores/imageList';
	import FiltersPopup from './FiltersPopup.svelte';
	import SettingsPopup from './SettingsPopup.svelte';

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

<div class="sidebar" class:collapsed>
	<div class="sidebar-header">
		<h2>Image Manager</h2>
		<div class="header-controls">
			<button class="settings-btn" on:click={() => (showSettingsPopup = true)} title="Settings">
				⚙️
			</button>
			<button class="collapse-btn" on:click={() => (collapsed = !collapsed)} title="Toggle sidebar">
				{collapsed ? '>' : '<'}
			</button>
		</div>
	</div>
	
	<!-- Removed Key Section as liked/unliked fields don't exist -->

	<!-- Upload Section -->
	<section class="sidebar-section">
		<h3>Upload</h3>
		<div class="upload-controls">
			<button 
				class="upload-btn" 
				on:click={triggerFileUpload} 
				disabled={uploading}
				title="Upload new image"
			>
				{uploading ? '⏳ Uploading...' : '📁 Upload Image'}
			</button>
			<button class="sync-btn" on:click={fetchImageLists} title="Refresh lists">
				🔄 Refresh
			</button>
		</div>
		
		<!-- Hidden file input for image uploads -->
		<input 
			type="file" 
			bind:this={fileInput}
			on:change={handleFileUpload}
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
	</section>

	<!-- Search Section -->
	<section class="sidebar-section">
		<h3>Search</h3>
		<div class="search-controls">
			<div class="search-input-group">
				<input
					type="text"
					placeholder="Search images..."
					bind:value={searchQuery}
					disabled={filterForEmpty}
					class="search-input"
				/>
				<button 
					class="clear-search-btn"
					on:click={() => (searchQuery = '')}
					class:visible={searchQuery.length > 0}
					title="Clear search"
				>
					×
				</button>
			</div>
			<select class="field-select" bind:value={selectedField}>
				{#each schemaFields as field}
					<option value={field}>{field}</option>
				{/each}
			</select>
			<div class="search-checkbox">
				<label>
					<input type="checkbox" bind:checked={filterForEmpty} />
					<span class="checkbox-label">Filter for empty</span>
				</label>
			</div>
		</div>
	</section>

	<!-- Filters Section -->
	<section class="sidebar-section">
		<h3>Filters</h3>
		<div class="filter-controls">
			<div class="view-toggle">
				<button class:active={view === 'linked'} on:click={() => (view = 'linked')}>
					Linked
				</button>
				<button class:active={view === 'unlinked'} on:click={() => (view = 'unlinked')}>
					Unlinked
				</button>
			</div>
			<button 
				class="advanced-filters-btn"
				on:click={() => (showFiltersPopup = true)}
			>
				🔍 Advanced Filters
			</button>
		</div>
	</section>

	<!-- Image List -->
	<section class="sidebar-section image-list-section">
		<h3>Images ({displayedFilenames.length})</h3>
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
							<li 
								class="image-item"
								on:mouseenter={(e) => handleImageMouseEnter(e, filename)}
								on:mouseleave={handleImageMouseLeave}
								on:mousemove={handleImageMouseMove}
							>
								<span class="image-name">{getDisplayName(filename)}</span>
							</li>
						</a>
					{/each}
				{:else}
					<li class="no-images">No {view} images found.</li>
				{/if}
			{/if}
		</ul>
	</section>
</div>

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
			on:error={() => {
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
	.sidebar {
		border-right: 1px solid #e0e0e0;
		height: 100vh;
		background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
		display: flex;
		flex-direction: column;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		overflow: hidden;
		box-shadow: 2px 0 20px rgba(0, 0, 0, 0.08);
		backdrop-filter: blur(10px);
	}

	.sidebar.collapsed {
		width: 0;
	}

	.sidebar.collapsed > *:not(.sidebar-header) {
		visibility: hidden;
	}
	
	.sidebar.collapsed .sidebar-header > *:not(.collapse-btn) {
		visibility: hidden;
	}

	.sidebar-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 1rem;
		background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
		color: white;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
	}
	
	.header-controls {
		display: flex;
		gap: 0.5rem;
		align-items: center;
	}

	.sidebar-header h2 {
		margin: 0;
		font-size: 1.2rem;
		font-weight: 600;
	}

	.settings-btn,
	.collapse-btn {
		background: rgba(255, 255, 255, 0.2);
		border: 1px solid rgba(255, 255, 255, 0.3);
		color: white;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		line-height: 1;
		border-radius: 4px;
		min-width: 2rem;
		flex-shrink: 0;
		transition: all 0.2s ease;
	}

	.settings-btn:hover,
	.collapse-btn:hover {
		background: rgba(255, 255, 255, 0.3);
	}

	.sidebar-section {
		padding: 1rem;
		border-bottom: 1px solid #e0e0e0;
	}

	.sidebar-section h3 {
		margin: 0 0 0.75rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #333;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	/* Removed key-btn styles as liked/unliked functionality was removed */

	.upload-controls {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

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

	.search-input {
		width: 100%;
		padding: 0.75rem 2.5rem 0.75rem 0.75rem;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		font-size: 0.9rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		background: white;
	}

	.search-input:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
	}

	.search-input:disabled {
		background: #f8f9fa;
		color: #6c757d;
		cursor: not-allowed;
	}

	.clear-search-btn {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		color: #6c757d;
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		transition: all 0.2s ease;
		pointer-events: none;
	}

	.clear-search-btn.visible {
		opacity: 1;
		pointer-events: auto;
	}

	.clear-search-btn:hover {
		background: #f8f9fa;
		color: #333;
	}

	.field-select {
		padding: 0.5rem 0.75rem;
		border: 2px solid #e0e0e0;
		border-radius: 8px;
		font-size: 0.9rem;
		background: white;
		cursor: pointer;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.field-select:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
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

	.search-checkbox input[type="checkbox"] {
		width: 1.1rem;
		height: 1.1rem;
		border: 2px solid #e0e0e0;
		border-radius: 4px;
		background: white;
		cursor: pointer;
		appearance: none;
		position: relative;
		transition: all 0.2s ease;
		margin: 0;
	}

	.search-checkbox input[type="checkbox"]:checked {
		background: #007bff;
		border-color: #007bff;
	}

	.search-checkbox input[type="checkbox"]:checked::after {
		content: '✓';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: white;
		font-size: 0.75rem;
		font-weight: bold;
	}

	.search-checkbox input[type="checkbox"]:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
	}

	.checkbox-label {
		user-select: none;
	}

	.upload-btn {
		padding: 0.75rem;
		border: 2px dashed #007bff;
		background: linear-gradient(135deg, #f8f9ff 0%, #e6f3ff 100%);
		cursor: pointer;
		border-radius: 8px;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		font-size: 0.9rem;
		color: #007bff;
		font-weight: 600;
		position: relative;
		overflow: hidden;
	}

	.upload-btn:hover {
		background: linear-gradient(135deg, #e6f3ff 0%, #cce7ff 100%);
		border-color: #0056b3;
		transform: translateY(-2px);
		box-shadow: 0 6px 20px rgba(0, 123, 255, 0.2);
	}

	.upload-btn:active {
		transform: translateY(0);
		box-shadow: 0 2px 8px rgba(0, 123, 255, 0.15);
	}

	.upload-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.sync-btn {
		padding: 0.5rem 0.75rem;
		border: 1px solid #e0e0e0;
		background: white;
		cursor: pointer;
		border-radius: 6px;
		transition: all 0.2s ease;
		font-size: 0.9rem;
	}

	.sync-btn:hover {
		background: #f8f9fa;
		border-color: #007bff;
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

	.view-toggle button {
		flex: 1;
		padding: 0.5rem;
		border: 1px solid #e0e0e0;
		background: white;
		cursor: pointer;
		border-radius: 6px;
		transition: all 0.2s ease;
		font-size: 0.9rem;
	}

	.view-toggle button:hover {
		background: #f8f9fa;
		border-color: #007bff;
	}

	.view-toggle button.active {
		background: #007bff;
		color: white;
		border-color: #007bff;
	}

	.advanced-filters-btn {
		padding: 0.5rem 0.75rem;
		border: 1px solid #007bff;
		background: white;
		cursor: pointer;
		border-radius: 6px;
		transition: all 0.2s ease;
		font-size: 0.9rem;
		color: #007bff;
		font-weight: 600;
	}

	.advanced-filters-btn:hover {
		background: #007bff;
		color: white;
	}

	.image-list-section {
		flex-grow: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
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

	.image-item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem;
		cursor: pointer;
		border-radius: 8px;
		margin-bottom: 0.25rem;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		background: white;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		border: 1px solid transparent;
		position: relative;
		overflow: hidden;
	}

	.image-item:hover {
		background: #f8f9fa;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		transform: translateY(-2px);
		border-color: #e0e0e0;
	}

	.image-item:active {
		transform: translateY(0);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
	}

	.file-list a.selected .image-item {
		background: #e6f3ff;
		border-left: 4px solid #007bff;
	}

	.image-name {
		font-size: 0.9rem;
		color: #333;
		flex-grow: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
		.sidebar {
			width: 100%;
			position: fixed;
			z-index: 100;
		}
		
		.upload-controls,
		.search-controls,
		.filter-controls {
			flex-direction: row;
			flex-wrap: wrap;
		}
		
		.upload-btn,
		.sync-btn {
			flex: 1;
			min-width: 0;
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