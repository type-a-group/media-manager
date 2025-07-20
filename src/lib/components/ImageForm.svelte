<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { filteredImageList } from '$lib/stores/imageList';
	import { settingsStore } from '$lib/stores/settings';
	import { onMount, onDestroy } from 'svelte';
	import MetadataPopup from './MetadataPopup.svelte';

	let { filename = null } = $props<{ filename?: string | null }>();

	let properties = $state<Record<string, any> | null>(null);
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
	
	let showMetadataPopup = $state(false);

	// State for creating new properties on unlinked images
	let newProperties = $state<Record<string, any>>({});

	// Reactive computed values for form bindings
	let formValues = $derived.by(() => {
		if (!schema) return {};
		
		const values: Record<string, any> = {};
		
		// Handle all fields uniformly
		Object.entries(schema).forEach(([fieldName, fieldProps]: [string, any]) => {
			if (fieldName !== 'file_name' && fieldName !== 'last_modified' && fieldName !== 'default') {
				if (properties) {
					values[fieldName] =
						properties[fieldName] !== undefined
							? properties[fieldName]
							: fieldProps.defaultValue;
				} else {
					values[fieldName] =
						newProperties[fieldName] !== undefined
							? newProperties[fieldName]
							: fieldProps.defaultValue;
				}
			}
		});
		
		return values;
	});

	// Function to update form values
	function updateFormValue(fieldName: string, value: any) {
		if (properties) {
			// Update existing properties
			properties = { ...properties, [fieldName]: value };
		} else {
			// Update new properties for unlinked image
			newProperties = { ...newProperties, [fieldName]: value };
		}
	}

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

	async function fetchProperties(name: string) {
		const response = await fetch(`/api/images/properties/${name}`);
		if (response.ok) {
			properties = await response.json();
			imageUrl = `/api/images/${name}`;
		} else {
			properties = null;
			imageUrl = `/api/images/${name}`; // Still show the image even if no JSON properties
		}
	}

	// Fetch lists and schema on mount
	$effect(() => {
		fetchImageLists();
		fetchSchema();
	});

	// Initialize newProperties with default values when schema changes
	$effect(() => {
		if (schema) {
			const initialProps: Record<string, any> = {};
			Object.entries(schema).forEach(([fieldName, fieldProps]: [string, any]) => {
				if (
					fieldName !== 'file_name' &&
					fieldName !== 'image_name' &&
					fieldName !== 'last_modified' &&
					fieldName !== 'default'
				) {
					initialProps[fieldName] = fieldProps.defaultValue || '';
				}
			});
			newProperties = initialProps;
		}
	});

	// Fetch properties when filename changes
	$effect(() => {
		if (filename) {
			fetchProperties(filename);
			saveMessage = '';
			updateCurrentList(); // Update when filename changes
		} else {
			properties = null;
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
		// Don't navigate if there are no search results (empty filtered list)
		if (currentList.length === 0) return;
		if (currentIndex === -1) return;
		const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
		if (newIndex >= 0 && newIndex < currentList.length) {
			const newFilename = currentList[newIndex];
			const view = $page.url.searchParams.get('view') || 'linked';
			goto(`/edit/${newFilename}?view=${view}`);
		}
	}
	
	/**
	 * Find the next unlinked image in the unlinked list
	 * @param excludeCurrentImage - Whether to exclude the current image from consideration
	 * @returns The filename of the next unlinked image, or null if none found
	 */
	function findNextUnlinkedImage(excludeCurrentImage: boolean = false): string | null {
		// Always use the full unlinked list, regardless of current view
		let unlinkedList = imageLists.inAssetsOnly;
		
		// If we're excluding the current image (e.g., because it's about to be linked),
		// filter it out from the list
		if (excludeCurrentImage && filename) {
			unlinkedList = unlinkedList.filter(img => img !== filename);
		}
		
		if (unlinkedList.length === 0) return null;
		
		// Find current image index in unlinked list
		const currentUnlinkedIndex = unlinkedList.indexOf(filename || '');
		
		// If current image is not in unlinked list, or it's the last one, return the first unlinked image
		if (currentUnlinkedIndex === -1 || currentUnlinkedIndex >= unlinkedList.length - 1) {
			return unlinkedList[0] || null;
		}
		
		// Return the next unlinked image
		return unlinkedList[currentUnlinkedIndex + 1] || null;
	}

	async function handleSubmit() {
		// If this is an unlinked image (no properties), create new properties
		if (!properties) {
			return handleCreateProperties();
		}
		
		// Otherwise, update existing properties
		if (!filename) return;
		saving = true;
		saveMessage = '';

		// Ensure the 'default' property is not sent when saving a real image
		const dataToSend = { ...properties };
		delete dataToSend.default;

		const response = await fetch(`/api/images/properties/${filename}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(dataToSend)
		});

		saving = false;
		if (response.ok) {
			saveMessage = 'Saved successfully!';
		} else {
			saveMessage = 'Error saving properties.';
		}
		setTimeout(() => (saveMessage = ''), 3000); // Clear message after 3 seconds
	}

	async function handleCreateProperties() {
		if (!filename) return;
		saving = true;
		saveMessage = '';

		// Check if auto-advance is enabled and get the next unlinked image BEFORE saving
		// This is important because after saving, the current image will no longer be unlinked
		const settings = settingsStore.getCurrentSettings();
		const shouldAutoAdvance = settings.autoAdvanceToNextUnlinked;
		const nextUnlinkedImage = shouldAutoAdvance ? findNextUnlinkedImage(true) : null;

		// Prepare properties data for new image
		const propertiesToSave = {
			file_name: filename,
			image_name: newProperties.image_name || filename,
			...newProperties
		};

		const response = await fetch(`/api/images/properties/${filename}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(propertiesToSave)
		});

		saving = false;
		if (response.ok) {
			const result = await response.json();
			properties = result.properties; // The newly created properties
			saveMessage = 'Properties created successfully!';
			
			// Reset the form
			newProperties = {};
			
			// Handle auto-advance BEFORE refreshing image lists to avoid state conflicts
			if (shouldAutoAdvance && nextUnlinkedImage && nextUnlinkedImage !== filename) {
				// Use setTimeout to ensure navigation happens after current execution context
				// setTimeout(() => {
				// 	goto(`/edit/${nextUnlinkedImage}?view=unlinked`);
				// }, 100);
				goto(`/edit/${nextUnlinkedImage}?view=unlinked`);
			}
			
			// Refresh the image lists to move this image to linked
			await fetchImageLists();
		} else {
			saveMessage = 'Error creating properties.';
		}
		setTimeout(() => (saveMessage = ''), 3000); // Clear message after 3 seconds
	}

	async function handleDeleteField(fieldName: string) {
		if (
			confirm(`Are you sure you want to delete the "${fieldName}" field? This will remove it from all images.`)
		) {
			const response = await fetch('/api/schema', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ fieldName })
			});

			if (response.ok) {
				const result = await response.json();
				schema = result.schema;
				if (properties) {
					const newProps = { ...properties };
					delete newProps[fieldName];
					properties = newProps;
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

			if (properties) {
				properties[newFieldName] = defaultValue;
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
			return `on ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], {
				hour: '2-digit',
				minute: '2-digit'
			})}`;
		}
	}
</script>

<div class="edit-container">
	{#if filename}
		<div class="image-column">
			{#if imageUrl}
				<img src={imageUrl} alt={properties?.image_name || filename} class="preview-image" />
			{/if}
		</div>
		<div class="form-column">
			<h2 class="panel-header">
				<span class="filename-text">{filename}</span>
			</h2>
			
			<form class="card" onsubmit={handleSubmit}>
				{#if schema}
					{#if !properties}
						<p class="unlinked-message">
							This image is not linked to properties. Add properties to include it in the
							database.
						</p>
					{/if}
					<!-- Dynamic fields -->
					{#each Object.entries(schema) as [fieldName, fieldProps]}
						{#if fieldName !== 'file_name' && fieldName !== 'last_modified' && fieldName !== 'default'}
							<label>
								<span>{fieldName === 'image_name' ? 'Image Name' : fieldName}</span>
								<div class="input-wrapper">
									{#if fieldProps.type === 'boolean'}
										<input
											type="checkbox"
											class="form-checkbox"
											checked={formValues[fieldName]}
											onchange={(e) =>
												updateFormValue(fieldName, (e.target as HTMLInputElement).checked)}
										/>
									{:else if fieldProps.type === 'number'}
										<input
											type="number"
											class="form-input"
											value={formValues[fieldName]}
											oninput={(e) =>
												updateFormValue(fieldName, Number((e.target as HTMLInputElement).value))}
										/>
									{:else}
										<input
											type="text"
											class="form-input"
											value={formValues[fieldName]}
											oninput={(e) =>
												updateFormValue(fieldName, (e.target as HTMLInputElement).value)}
											placeholder={fieldName === 'image_name' ? 'Custom display name' : ''}
										/>
									{/if}
									{#if fieldProps.removable && fieldName !== 'image_name'}
										<button
											type="button"
											class="delete-field-btn"
											onclick={() => handleDeleteField(fieldName)}
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
					<div class="action-row">
						<button type="button" onclick={() => (showNewFieldForm = !showNewFieldForm)}>
							{showNewFieldForm ? 'Cancel' : 'Create New Field'}
						</button>
						<button type="submit" disabled={saving}>
							{saving ? 'Saving...' : properties?.image_name ? 'Save' : 'Save & Link Image'}
						</button>
					</div>
					<div class="action-row">
						<button
							type="button"
							onclick={() => navigate('prev')}
							disabled={currentList.length === 0 || currentIndex <= 0}
						>
							&larr; Previous
						</button>
						<button type="button" onclick={() => (showMetadataPopup = true)} class="metadata-btn">
							Metadata
						</button>
						<button
							type="button"
							onclick={() => navigate('next')}
							disabled={
								currentList.length === 0 ||
								currentIndex === -1 ||
								currentIndex >= currentList.length - 1
							}
						>
							Next &rarr;
						</button>
					</div>
					{#if saveMessage}
						<div class="save-message">{saveMessage}</div>
					{/if}
				</div>
			</form>

			{#if showNewFieldForm}
				<div class="card">
					<h3 class="panel-header small">Create New Field</h3>
					<label>
						<span>Field Name</span>
						<div class="input-wrapper">
							<input type="text" bind:value={newFieldName} class="form-input" />
						</div>
					</label>
					<label>
						<span>Field Type</span>
						<div class="input-wrapper">
							<select bind:value={newFieldType} class="form-select">
								<option value="string">String</option>
								<option value="number">Number</option>
								<option value="boolean">Boolean</option>
							</select>
						</div>
					</label>
					<label>
						<span>Default Value</span>
						<div class="input-wrapper">
							{#if newFieldType === 'boolean'}
								<input type="checkbox" bind:checked={newFieldDefaultBoolean} class="form-checkbox" />
							{:else if newFieldType === 'number'}
								<input type="number" bind:value={newFieldDefaultNumber} class="form-input" />
							{:else}
								<input type="text" bind:value={newFieldDefaultString} class="form-input" />
							{/if}
						</div>
					</label>
					<div class="action-row">
						<button onclick={() => (showNewFieldForm = !showNewFieldForm)}>
							Cancel
						</button>
						<button onclick={handleAddNewField}>Add Field</button>
					</div>
				</div>
			{/if}

			{#if properties?.last_modified}
				<div class="last-modified">
					Last modified {formatLastModified(properties?.last_modified)}
				</div>
			{/if}
			<!-- <div style="font-size: 0.8em; color: #888; margin-top: 0.5rem;">
				Debug: currentIndex: {currentIndex}, listLength: {currentList.length}, filename: {filename}
			</div> -->
		</div>
	{:else}
		<p>Select an image from the sidebar to see its details.</p>
	{/if}
</div>

<!-- Metadata Popup -->
<MetadataPopup 
	bind:isOpen={showMetadataPopup}
	{filename}
	onClose={() => (showMetadataPopup = false)}
/>

<style>

	/* Generic card layout shared across form & new-field-form */
	.card {
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		border: 1px solid #e9ecef;
	}

	.edit-container {
		display: flex;
		flex-wrap: wrap;
		gap: 2rem;
		padding: 2rem;
		align-items: flex-start;
		background: #f8f9fa;
		min-height: 100vh;
	}

	.image-column {
		flex: 1 1 50%;
		min-width: 400px;
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		padding: 1.5rem;
		top: 2rem;
		height: fit-content;
		max-height: 90vh;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #e9ecef;
		overflow: auto;
	}

	.form-column {
		flex: 1 1 400px;
		max-width: 500px;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		min-width: 0;
	}

	.preview-image {
		max-width: calc(100% - 2rem);
		max-height: calc(85vh - 4rem);
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 12px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
		transition: transform 0.3s ease;
		display: block;
	}

	.preview-image:hover {
		transform: scale(1.02);
	}

	/* Unified header style */
	.panel-header {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
		color: #2c3e50;
		padding: 1.5rem;
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		border: 1px solid #e9ecef;
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
		max-width: 100%;
		min-width: 0;
		overflow: hidden;
	}

	/* Focus state for better accessibility */
	.panel-header:focus-within {
		outline: 2px solid #007bff;
		outline-offset: 2px;
	}

	.panel-header::before {
		content: '🖼️';
		font-size: 1.2rem;
		opacity: 0.8;
		flex-shrink: 0;
	}

	/* Smaller variant for sub-headers */
	.panel-header.small {
		font-size: 1.2rem;
		padding: 1rem;
		color: #495057;
	}

	/* Remove emoji for small headers */
	.panel-header.small::before {
		content: '';
	}

	.filename-text {
		overflow-x: auto;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
		scrollbar-width: none;
		-ms-overflow-style: none;
		cursor: text;
		user-select: text;
		padding-right: 1rem;
	}

	.filename-text::-webkit-scrollbar {
		display: none;
	}

	.filename-text:hover {
		color: #007bff;
	}

	/* If a <form> happens to be a .card, keep full-width responsive behaviour */
	form.card {
		width: 100%;
	}

	.input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.form-input {
		flex: 1;
	}

	.form-input:focus {
		transform: translateY(-1px);
	}

	.form-checkbox {
		width: 1.5rem;
		height: 1.5rem;
		border: 2px solid #e0e0e0;
		border-radius: 4px;
		background: white;
		cursor: pointer;
		appearance: none;
		position: relative;
		transition: all 0.2s ease;
		margin: 0;
		flex-shrink: 0;
	}
		
	
	.form-checkbox:checked {
		background: #007bff;
		border-color: #007bff;
	}
	
	.form-checkbox:checked::after {
		content: '✓';
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		color: white;
		font-size: 1rem;
		font-weight: bold;
	}
	
	.form-checkbox:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
	}
	
	.form-checkbox:hover {
		border-color: #007bff;
	}

	.delete-field-btn {
		background: #dc3545;
		border: none;
		cursor: pointer;
		padding: 0.5rem;
		font-size: 1rem;
		border-radius: 6px;
		transition: all 0.2s ease;
		color: white;
		width: 36px;
		height: 36px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.delete-field-btn:hover {
		background: #c82333;
		transform: scale(1.1);
	}

	.form-actions {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding-top: 1rem;
		border-top: 1px solid #e9ecef;
	}

	.action-row {
		display: flex;
		gap: 1rem;
		align-items: center;
		justify-content: center;
	}

	button {
		padding: 0.75rem 1.5rem;
		border: 2px solid #e9ecef;
		background: white;
		cursor: pointer;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		position: relative;
		overflow: hidden;
	}

	button:hover:not(:disabled) {
		background: #f8f9fa;
		border-color: #007bff;
		transform: translateY(-2px);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	button:active:not(:disabled) {
		transform: translateY(0);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
	}

	button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
		background: #f8f9fa;
		color: #6c757d;
	}

	button[type='submit'] {
		background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
		color: white;
		border-color: #007bff;
	}

	button[type='submit']:hover:not(:disabled) {
		background: linear-gradient(135deg, #0056b3 0%, #004085 100%);
		border-color: #0056b3;
	}

	.metadata-btn {
		background: linear-gradient(135deg, #17a2b8 0%, #138496 100%);
		color: white;
		border-color: #17a2b8;
	}

	.metadata-btn:hover:not(:disabled) {
		background: linear-gradient(135deg, #138496 0%, #117a8b 100%);
		border-color: #138496;
	}

	.save-message {
		font-style: italic;
		color: #28a745;
		font-weight: 600;
		padding: 0.5rem 1rem;
		background: #d4edda;
		border: 1px solid #c3e6cb;
		border-radius: 6px;
		animation: slideIn 0.3s ease;
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	h3 {
		margin: 0;
		color: #495057;
		font-size: 1.2rem;
		font-weight: 600;
	}

	label {
		display: flex;
		text-transform: capitalize;
		flex-direction: column;
		gap: 0.5rem;
	}

	.form-input,
	.form-select {
		padding: 0.75rem 1rem;
		border: 2px solid #e9ecef;
		border-radius: 8px;
		font-size: 1rem;
		transition: all 0.3s ease;
		background: white;
	}

	.form-input:focus,
	.form-select:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
	}

	.form-input:hover:not(:focus),
	.form-select:hover:not(:focus) {
		border-color: #007bff;
	}

	.last-modified {
		background: white;
		border-radius: 12px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
		padding: 1rem;
		font-size: 0.9rem;
		color: #6c757d;
		text-align: center;
		font-style: italic;
		border: 1px solid #e9ecef;
		position: relative;
	}

	.last-modified::before {
		content: '⏰';
		margin-right: 0.5rem;
	}

	.unlinked-message {
		color: #856404;
		margin-bottom: 2rem;
		font-style: italic;
		font-size: 1.1rem;
		line-height: 1.5;
	}

	/* Responsive adjustments */
	@media (max-width: 768px) {
		.edit-container {
			flex-direction: column;
			padding: 1rem;
		}

		.image-column {
			min-width: 0;
			position: static;
			max-height: 60vh;
			height: auto;
		}

		.preview-image {
			max-height: calc(60vh - 4rem);
		}

		.form-column {
			flex: 1 1 auto;
		}

		.action-row {
			flex-direction: column;
			align-items: stretch;
		}

		.action-row button {
			width: 100%;
		}

		.panel-header {
			font-size: 1.2rem;
			padding: 1rem;
		}
	}

	/* Loading states - only show spinner for buttons that are actually saving */
	button[type="submit"]:disabled {
		position: relative;
	}

	button[type='submit']:disabled::after {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 16px;
		height: 16px;
		margin-top: -8px;
		margin-left: -8px;
		border: 2px solid transparent;
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}
</style>