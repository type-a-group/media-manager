<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { filteredImageList } from '$lib/stores/imageList'; 
	import { onMount, onDestroy } from 'svelte';

	let { filename = null } = $props<{ filename?: string | null }>();

	let metadata = $state<Record<string, any> | null>(null);
	let schema = $state<Record<string, any> | null>(null);
	let imageUrl = $state<string | null>(null);
	let saving = $state(false);
	let saveMessage = $state('');

	let showNewFieldForm = $state(false);
	let newFieldName = $state('');
	let newFieldType = $state('string');
	let newFieldDefaultString = $state('');
	let newFieldDefaultNumber = $state(0);
	let newFieldDefaultBoolean = $state(false);

	let imageLists = $state<{
		inBoth: string[];
		inAssetsOnly: string[];
	}>({
		inBoth: [],
		inAssetsOnly: []
	});

	let currentList = $state<string[]>([]);
	let currentIndex = $state(-1);
	
	// Filtered list from svelte store
	let filteredList: string[] = [];
	let unsubscribe: () => void;
	
	onMount(() => {
		unsubscribe = filteredImageList.subscribe((list) => {
			filteredList = list;
			updateCurrentList(); // Update when filtered list changes
		});
	});
	
	onDestroy(() => {
		unsubscribe && unsubscribe();
	});

	// Clean function to update current list and index
	function updateCurrentList() {
		const view = $page.url.searchParams.get('view') || 'linked';
		
		// Use filtered list if available, otherwise fall back to the appropriate list
		if (filteredList && filteredList.length > 0) {
			currentList = filteredList;
		} else {
			currentList = view === 'unlinked' ? imageLists.inAssetsOnly : imageLists.inBoth;
		}
		
		// Update index based on current filename
		currentIndex = filename ? currentList.indexOf(filename) : -1;
	}

	async function fetchImageLists() {
		const response = await fetch('/api/images/compare');
		if (response.ok) {
			imageLists = await response.json();
		}
	}

	async function fetchSchema() {
		const response = await fetch('/api/schema');
		if (response.ok) {
			schema = await response.json();
		}
	}

	async function fetchMetadata(name: string) {
		const response = await fetch(`/api/images/metadata/${name}`);
		if (response.ok) {
			metadata = await response.json();
			imageUrl = `/api/images/${name}`;
		} else {
			metadata = null;
			imageUrl = null;
		}
	}

	// Fetch lists and schema on mount
	$effect(() => {
		fetchImageLists();
		fetchSchema();
	});

	// Fetch metadata when filename changes
	$effect(() => {
		if (filename) {
			fetchMetadata(filename);
			saveMessage = '';
			updateCurrentList(); // Update when filename changes
		} else {
			metadata = null;
			imageUrl = null;
		}
	});

	// Update when imageLists changes
	$effect(() => {
		if (imageLists.inBoth.length > 0 || imageLists.inAssetsOnly.length > 0) {
			updateCurrentList();
		}
	});

	function navigate(direction: 'prev' | 'next') {
		if (currentIndex === -1) return;
		const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
		if (newIndex >= 0 && newIndex < currentList.length) {
			const newFilename = currentList[newIndex];
			const view = $page.url.searchParams.get('view') || 'linked';
			goto(`/edit/${newFilename}?view=${view}`);
		}
	}

	async function handleSubmit() {
		if (!filename || !metadata) return;
		saving = true;
		saveMessage = '';

		// Ensure the 'default' property is not sent when saving a real image
		const dataToSend = { ...metadata };
		delete dataToSend.default;

		const response = await fetch(`/api/images/metadata/${filename}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(dataToSend)
		});

		saving = false;
		if (response.ok) {
			saveMessage = 'Saved successfully!';
		} else {
			saveMessage = 'Error saving metadata.';
		}
		setTimeout(() => (saveMessage = ''), 3000); // Clear message after 3 seconds
	}

	async function handleDeleteField(fieldName: string) {
		if (confirm(`Are you sure you want to delete the "${fieldName}" field? This will remove it from all images.`)) {
			const response = await fetch('/api/schema', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fieldName })
			});

			if (response.ok) {
				const result = await response.json();
				schema = result.schema;
				if (metadata) {
					const newMeta = { ...metadata };
					delete newMeta[fieldName];
					metadata = newMeta;
				}
			} else {
				const result = await response.json();
				alert(`Error deleting field: ${result.message}`);
			}
		}
	}

	async function handleAddNewField() {
		// Basic validation
		if (!newFieldName.trim()) {
			alert('Field name is required.');
			return;
		}

		let defaultValue: string | number | boolean;
		switch (newFieldType) {
			case 'boolean':
				defaultValue = newFieldDefaultBoolean;
				break;
			case 'number':
				defaultValue = newFieldDefaultNumber;
				break;
			default:
				defaultValue = newFieldDefaultString;
		}

		const response = await fetch('/api/schema', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				fieldName: newFieldName,
				fieldType: newFieldType,
				defaultValue: defaultValue
			})
		});

		if (response.ok) {
			const result = await response.json();
			schema = result.schema;

			if (metadata) {
				metadata[newFieldName] = defaultValue;
			}

			// Reset form, hide it
			showNewFieldForm = false;
			newFieldName = '';
			newFieldType = 'string';
			newFieldDefaultString = '';
			newFieldDefaultNumber = 0;
			newFieldDefaultBoolean = false;
		} else {
			const result = await response.json();
			alert(`Error adding field: ${result.message}`);
		}
	}

	function formatLastModified(timestamp: string): string {
		if (!timestamp) return '';
		
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMinutes = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMinutes / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMinutes < 1) {
			return 'Just now';
		} else if (diffMinutes < 60) {
			return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
		} else if (diffHours < 24) {
			return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
		} else if (diffDays < 7) {
			return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
		} else {
			return `on ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
		}
	}
</script>

<div class="edit-container">
	{#if filename && metadata}
		<div class="image-column">
			{#if imageUrl}
				<img src={imageUrl} alt={metadata.image_name} class="preview-image" />
			{/if}
		</div>
		<div class="form-column">
			<h2>{filename}</h2>
			<form on:submit|preventDefault={handleSubmit}>
				{#if schema}
					<!-- File name field (read-only) -->
					{#if schema.file_name}
						<label class="dynamic-label">
							<span>file_name</span>
							<div class="input-wrapper">
								<input type="text" value={metadata.file_name} readonly />
							</div>
						</label>
					{/if}
					
					<!-- Image name field (editable) -->
					{#if schema.image_name}
						<label class="dynamic-label">
							<span>image_name</span>
							<div class="input-wrapper">
								<input type="text" bind:value={metadata.image_name} placeholder="Custom display name" />
							</div>
						</label>
					{/if}
					
					<!-- Other dynamic fields -->
					{#each Object.entries(schema) as [fieldName, fieldProps]}
						{#if fieldName !== 'image_name' && fieldName !== 'file_name' && fieldName !== 'last_modified' && fieldName !== 'default'}
							<label class="dynamic-label">
								<span>{fieldName}</span>
								<div class="input-wrapper">
									{#if fieldProps.type === 'boolean'}
										<input type="checkbox" bind:checked={metadata[fieldName]} />
									{:else if fieldProps.type === 'number'}
										<input type="number" bind:value={metadata[fieldName]} />
									{:else}
										<input type="text" bind:value={metadata[fieldName]} />
									{/if}
									{#if fieldProps.removable}
										<button
											type="button"
											class="delete-field-btn"
											on:click={() => handleDeleteField(fieldName)}
										>
											🗑️
										</button>
									{/if}
								</div>
							</label>
						{/if}
					{/each}
				{/if}
				<div class="form-actions">
					<button type="submit" disabled={saving}>
						{saving ? 'Saving...' : 'Save'}
					</button>
					<button 
						type="button" 
						on:click={() => navigate('prev')} 
						disabled={currentIndex <= 0}
					>
						&larr; Previous
					</button>
					<button
						type="button"
						on:click={() => navigate('next')}
						disabled={currentIndex === -1 || currentIndex >= currentList.length - 1}
					>
						Next &rarr;
					</button>
					<button type="button" on:click={() => (showNewFieldForm = !showNewFieldForm)}>
						{showNewFieldForm ? 'Cancel' : 'Create New Field'}
					</button>
					{#if saveMessage}
						<span class="save-message">{saveMessage}</span>
					{/if}
				</div>
			</form>

			{#if showNewFieldForm}
				<div class="new-field-form">
					<h3>Create New Field</h3>
					<label>
						<span>Field Name</span>
						<input type="text" bind:value={newFieldName} />
					</label>
					<label>
						<span>Field Type</span>
						<select bind:value={newFieldType}>
							<option value="string">String</option>
							<option value="number">Number</option>
							<option value="boolean">Boolean</option>
						</select>
					</label>
					<label>
						<span>Default Value</span>
						{#if newFieldType === 'boolean'}
							<input type="checkbox" bind:checked={newFieldDefaultBoolean} />
						{:else if newFieldType === 'number'}
							<input type="number" bind:value={newFieldDefaultNumber} />
						{:else}
							<input type="text" bind:value={newFieldDefaultString} />
						{/if}
					</label>
					<button on:click={handleAddNewField}>Add Field</button>
				</div>
			{/if}

			{#if metadata && metadata.last_modified}
				<div class="last-modified">
					Last modified {formatLastModified(metadata.last_modified)}
				</div>
			{/if}

			<!-- <div style="font-size: 0.8em; color: #888; margin-top: 0.5rem;">
				Debug: currentIndex: {currentIndex}, listLength: {currentList.length}, filename: {filename}
			</div> -->
		</div>
	{:else if filename}
		<p>Loading metadata for {filename}...</p>
	{:else}
		<p>Select an image from the sidebar to see its details.</p>
	{/if}
</div>

<style>
	.edit-container {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
		padding: 1rem;
		align-items: center;
	}

	.image-column {
		flex: 1 1 50%;
		height: 75vh;
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 400px;
	}

	.form-column {
		flex: 1 1 300px;
		display: flex;
		flex-direction: column;
		justify-content: center;
	}

	.preview-image {
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: 8px;
	}

	h2 {
		margin-top: 0;
		font-size: 1.2rem;
		word-break: break-all;
		font-weight: normal;
		color: #555;
	}

	.dynamic-label {
		display: grid;
		grid-template-columns: 100px 1fr;
		align-items: center;
	}

	.input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.input-wrapper input {
		flex: 1;
		min-width: 0;
	}

	.input-wrapper input[type='checkbox'] {
		flex: 0;
		width: 20px;
		height: 20px;
	}

	.delete-field-btn {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
		font-size: 1.2rem;
	}

	form {
		display: grid;
		gap: 1rem;
	}
	label {
		display: grid;
		grid-template-columns: 100px 1fr;
		align-items: center;
	}
	input {
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
	}
	input[readonly] {
		background-color: #f5f5f5;
		color: #666;
		cursor: not-allowed;
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
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button[type='submit'] {
		background: #007bff;
		color: white;
		border-color: #007bff;
	}
	button[type='submit']:hover {
		background: #0056b3;
	}
	.form-actions {
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.save-message {
		font-style: italic;
	}

	.new-field-form {
		margin-top: 2rem;
		padding: 1rem;
		border: 1px solid #ccc;
		border-radius: 8px;
		display: grid;
		gap: 1rem;
	}

	.new-field-form button {
		width: 100%;
	}

	.last-modified {
		font-size: 0.8rem;
		color: #666;
		text-align: center;
		margin-top: 1rem;
		font-style: italic;
	}
</style>