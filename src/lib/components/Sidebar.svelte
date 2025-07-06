<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { filteredImageList } from '$lib/stores/imageList';	

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

	// This will hold the filenames actually displayed in the sidebar
	let displayedFilenames = $state<string[]>([]);
	
	// Map filename to metadata for display names
	let imageMetadata = $state<Map<string, any>>(new Map());
	
	// Upload-related state variables
	let fileInput: HTMLInputElement | undefined; // Reference to hidden file input
	let uploading = $state(false); // Track upload status
	let uploadMessage = $state(''); // Status messages for uploads

	async function fetchSchema() {
		const response = await fetch('/api/schema');
		if (response.ok) {
			const schema = await response.json();
			schemaFields = Object.keys(schema);
			if (schemaFields.length > 0) {
				selectedField = schemaFields[0];
			}
		}
	}

	async function fetchMetadataForImages(filenames: string[]) {
		const metadataMap = new Map();
		await Promise.all(filenames.map(async (filename) => {
			try {
				const response = await fetch(`/api/images/metadata/${filename}`);
				if (response.ok) {
					const metadata = await response.json();
					metadataMap.set(filename, metadata);
				}
			} catch (error) {
				console.error(`Failed to fetch metadata for ${filename}:`, error);
			}
		}));
		imageMetadata = metadataMap;
	}

	function getDisplayName(filename: string): string {
		const metadata = imageMetadata.get(filename);
		if (metadata && metadata.image_name && metadata.image_name.trim() !== '') {
			return metadata.image_name;
		}
		return metadata?.file_name || filename;
	}

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

		const response = await fetch(`/api/images/compare?${params.toString()}`);
		if (response.ok) {
			const data = await response.json();
			imageLists = {
				inBoth: data.inBoth || [],
				inAssetsOnly: data.inAssetsOnly || []
			};
			updateDisplayedFilenames();
		}
		loading = false;
	}

	function updateDisplayedFilenames() {
		// Always reflect the current view and any search/filter
		if (view === 'linked') {
			displayedFilenames = imageLists.inBoth;
		} else {
			displayedFilenames = imageLists.inAssetsOnly;
		}
		// Set the store to match the displayed list
		filteredImageList.set(displayedFilenames);
		// Fetch metadata for display names
		fetchMetadataForImages(displayedFilenames);
	}

	// When view changes, update displayedFilenames and store
	$effect(() => {
		updateDisplayedFilenames();
	});

	onMount(fetchSchema);

	$effect(() => {
		// This will re-run whenever searchQuery, selectedField, or filterForEmpty changes
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
</script>

<div class="sidebar" class:collapsed>
	<div class="controls">
		<button class:active={view === 'linked'} on:click={() => (view = 'linked')}>
			Linked
		</button>
		<button class:active={view === 'unlinked'} on:click={() => (view = 'unlinked')}>
			Unlinked
		</button>
		<button class="sync-btn" on:click={fetchImageLists} title="Refresh lists">
			🔄
		</button>
		<button 
			class="upload-btn" 
			on:click={triggerFileUpload} 
			disabled={uploading}
			title="Upload new image"
		>
			📁
		</button>
		<button class="collapse-btn" on:click={() => (collapsed = !collapsed)} title="Toggle sidebar">
			{collapsed ? '>' : '<'}
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
	<fieldset class="filter-controls">
		<legend>Filters</legend>
		<div class="form-group">
			<label for="search-input">Search</label>
			<input
				id="search-input"
				type="text"
				placeholder="Search..."
				bind:value={searchQuery}
				disabled={filterForEmpty}
			/>
		</div>
		<div class="form-group">
			<label for="field-select">Field</label>
			<select id="field-select" bind:value={selectedField}>
				{#each schemaFields as field}
					<option value={field}>{field}</option>
				{/each}
			</select>
		</div>
		<div class="form-group-checkbox">
			<label for="empty-checkbox">
				<input id="empty-checkbox" type="checkbox" bind:checked={filterForEmpty} />
				Filter for empty
			</label>
		</div>
	</fieldset>
	<ul class="file-list">
		{#if loading}
			<li>Loading...</li>
		{:else}
			{#if displayedFilenames.length > 0}
				{#each displayedFilenames as filename (filename)}
					<a
						href="/edit/{filename}?view={view}"
						class:selected={$page.params.filename === filename}
					>
						<li>{getDisplayName(filename)}</li>
					</a>
				{/each}
			{:else}
				<li>No {view} images found.</li>
			{/if}
		{/if}
	</ul>
</div>

<style>
	.sidebar {
		border-right: 1px solid #ccc;
		padding: 1rem;
		height: 100vh;
		background: #f7f7f7;
		display: flex;
		flex-direction: column;
		transition: width 0.3s ease-in-out;
		overflow: hidden;
	}

	.sidebar.collapsed {
		padding: 0;
	}

	.sidebar.collapsed > *:not(.controls) {
		visibility: hidden;
	}
	
	.sidebar.collapsed .controls > *:not(.collapse-btn) {
		visibility: hidden;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
		align-items: center;
		flex-wrap: wrap;
		min-height: 2.5rem;
	}
	button {
		padding: 0.5rem 1rem;
		border: 1px solid #ccc;
		background: white;
		cursor: pointer;
		border-radius: 4px;
		transition: all 0.2s ease-in-out;
	}
	button:hover {
		background: #eee;
	}
	button.active {
		background: #007bff;
		color: white;
		border-color: #007bff;
	}
	button.active:hover {
		background: #0056b3;
	}
	.collapse-btn {
		margin-left: auto;
		background: #f0f0f0;
		border: 1px solid #ccc;
		font-size: 1.2rem;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		line-height: 1;
		border-radius: 4px;
		min-width: 2rem;
		flex-shrink: 0;
	}
	.collapse-btn:hover {
		background: #e0e0e0;
	}
	.sync-btn {
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
	}
	.upload-btn {
		background: none;
		border: none;
		font-size: 1.5rem;
		cursor: pointer;
		padding: 0;
		line-height: 1;
		transition: opacity 0.2s ease-in-out;
	}
	.upload-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
	.file-list li {
		padding: 0.5rem;
		cursor: pointer;
		border-radius: 4px;
	}
	.file-list li:hover {
		background: #eee;
	}
	.file-list a.selected li {
		background: #cce5ff;
	}
	.filter-controls {
		border: 1px solid #ccc;
		border-radius: 4px;
		padding: 0.5rem;
		margin-bottom: 1rem;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
		align-items: center;
	}
	.filter-controls legend {
		padding: 0 0.5rem;
		font-size: 0.9rem;
		color: #555;
	}
	.form-group {
		display: contents;
	}
	.form-group-checkbox {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.filter-controls label {
		font-size: 0.9rem;
		white-space: nowrap;
	}
	.filter-controls input[type='text'],
	.filter-controls select {
		width: 100%;
		padding: 0.25rem;
	}
	.form-group-checkbox label {
		cursor: pointer;
		display: flex;
		align-items: center;
	}
	.upload-message {
		background: #f0f8ff;
		border: 1px solid #cce5ff;
		border-radius: 4px;
		padding: 0.5rem;
		margin-bottom: 1rem;
		font-size: 0.9rem;
		text-align: center;
	}
</style>