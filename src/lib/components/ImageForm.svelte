<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { filteredImageList } from '$lib/stores/imageList'; 
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
	let newImageName = $state('');
	let newProperties = $state<Record<string, any>>({});

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
				if (fieldName !== 'file_name' && fieldName !== 'image_name' && fieldName !== 'last_modified' && fieldName !== 'default') {
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

	async function handleSubmit() {
		if (!filename || !properties) return;
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

		// Prepare properties data for new image
		const propertiesToSave = {
			file_name: filename,
			image_name: newImageName || filename,
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
			newImageName = '';
			newProperties = {};
			
			// Refresh the image lists to move this image to linked
			await fetchImageLists();
		} else {
			saveMessage = 'Error creating properties.';
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
			return `on ${date.toLocaleDateString()} at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
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
			<h2>
				<span class="filename-text">{filename}</span>
			</h2>
			
			{#if properties}
				<!-- Show the full form for linked images -->
				<form on:submit|preventDefault={handleSubmit}>
					{#if schema}
						<!-- File name field (read-only) -->
						{#if schema.file_name}
							<label class="dynamic-label">
								<span>file_name</span>
								<div class="input-wrapper">
									<input type="text" value={properties.file_name} readonly />
								</div>
							</label>
						{/if}
						
						<!-- Image name field (editable) -->
						{#if schema.image_name}
							<label class="dynamic-label">
								<span>image_name</span>
								<div class="input-wrapper">
									<input type="text" bind:value={properties.image_name} placeholder="Custom display name" />
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
										<input type="checkbox" bind:checked={properties[fieldName]} />
									{:else if fieldProps.type === 'number'}
										<input type="number" bind:value={properties[fieldName]} />
									{:else}
										<input type="text" bind:value={properties[fieldName]} />
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
						<div class="action-row primary-actions">
							<button type="button" on:click={() => (showNewFieldForm = !showNewFieldForm)}>
								{showNewFieldForm ? 'Cancel' : 'Create New Field'}
							</button>
							<button type="submit" disabled={saving}>
								{saving ? 'Saving...' : 'Save'}
							</button>
						</div>
						<div class="action-row navigation-actions">
							<button 
								type="button" 
								on:click={() => navigate('prev')} 
								disabled={currentList.length === 0 || currentIndex <= 0}
							>
								&larr; Previous
							</button>
							<button type="button" on:click={() => (showMetadataPopup = true)} class="metadata-btn">
								Metadata
							</button>
							<button
								type="button"
								on:click={() => navigate('next')}
								disabled={currentList.length === 0 || currentIndex === -1 || currentIndex >= currentList.length - 1}
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

				{#if properties.last_modified}
					<div class="last-modified">
						Last modified {formatLastModified(properties.last_modified)}
					</div>
				{/if}
			{:else}
				<!-- Show properties form for unlinked images -->
				<div class="unlinked-info">
					<p class="unlinked-message">
						This image is not linked to properties. Add properties to include it in the database.
					</p>
					<form on:submit|preventDefault={handleCreateProperties}>
						{#if schema}
							<!-- File name field (auto-filled) -->
							{#if schema.file_name}
								<label class="dynamic-label">
									<span>file_name</span>
									<div class="input-wrapper">
										<input type="text" value={filename} readonly />
									</div>
								</label>
							{/if}
							
							<!-- Image name field (editable) -->
							{#if schema.image_name}
								<label class="dynamic-label">
									<span>image_name</span>
									<div class="input-wrapper">
										<input type="text" bind:value={newImageName} placeholder="Custom display name" />
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
												<input type="checkbox" bind:checked={newProperties[fieldName]} />
											{:else if fieldProps.type === 'number'}
												<input type="number" bind:value={newProperties[fieldName]} />
											{:else}
												<input type="text" bind:value={newProperties[fieldName]} />
											{/if}
										</div>
									</label>
								{/if}
							{/each}
						{/if}
						<div class="form-actions">
							<div class="action-row primary-actions">
								<button type="submit" disabled={saving}>
									{saving ? 'Saving...' : 'Save & Link Image'}
								</button>
							</div>
							<div class="action-row navigation-actions">
								<button 
									type="button" 
									on:click={() => navigate('prev')} 
									disabled={currentList.length === 0 || currentIndex <= 0}
								>
									&larr; Previous
								</button>
								<button type="button" on:click={() => (showMetadataPopup = true)} class="metadata-btn">
									View File Metadata
								</button>
								<button
									type="button"
									on:click={() => navigate('next')}
									disabled={currentList.length === 0 || currentIndex === -1 || currentIndex >= currentList.length - 1}
								>
									Next &rarr;
								</button>
							</div>
							{#if saveMessage}
								<div class="save-message">{saveMessage}</div>
							{/if}
						</div>
					</form>
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
		position: sticky;
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

	h2 {
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
	h2:focus-within {
		outline: 2px solid #007bff;
		outline-offset: 2px;
	}

	h2::before {
		content: "🖼️";
		font-size: 1.2rem;
		opacity: 0.8;
		flex-shrink: 0;
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

	form {
		background: white;
		border-radius: 16px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		padding: 2rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		border: 1px solid #e9ecef;
	}

	.dynamic-label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dynamic-label > span {
		font-weight: 600;
		color: #495057;
		font-size: 0.9rem;
		text-transform: capitalize;
		letter-spacing: 0.5px;
	}

	.input-wrapper {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.input-wrapper input,
	.input-wrapper select {
		flex: 1;
		min-width: 0;
		padding: 0.75rem 1rem;
		border: 2px solid #e9ecef;
		border-radius: 8px;
		font-size: 1rem;
		transition: all 0.3s ease;
		background: white;
	}

	.input-wrapper input:focus,
	.input-wrapper select:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
		transform: translateY(-1px);
	}

	.input-wrapper input:hover:not(:focus),
	.input-wrapper select:hover:not(:focus) {
		border-color: #007bff;
	}

	.input-wrapper input[type='checkbox'] {
		flex: 0;
		width: 20px;
		height: 20px;
		cursor: pointer;
		accent-color: #007bff;
	}

	.input-wrapper input[readonly] {
		background: #f8f9fa;
		color: #6c757d;
		cursor: not-allowed;
		border-color: #dee2e6;
	}

	.input-wrapper input[readonly]:hover {
		border-color: #dee2e6;
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

	.primary-actions {
		justify-content: flex-end;
	}

	.navigation-actions {
		justify-content: space-between;
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

	.new-field-form {
		margin-top: 1rem;
		padding: 2rem;
		background: #f8f9fa;
		border: 2px solid #e9ecef;
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
		position: relative;
	}

	.new-field-form::before {
		content: "✨";
		position: absolute;
		top: -10px;
		right: 20px;
		font-size: 1.5rem;
		background: #f8f9fa;
		padding: 0 0.5rem;
	}

	.new-field-form h3 {
		margin: 0;
		color: #495057;
		font-size: 1.2rem;
		font-weight: 600;
	}

	.new-field-form label {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.new-field-form label span {
		font-weight: 600;
		color: #495057;
		font-size: 0.9rem;
	}

	.new-field-form input,
	.new-field-form select {
		padding: 0.75rem 1rem;
		border: 2px solid #e9ecef;
		border-radius: 8px;
		font-size: 1rem;
		transition: all 0.3s ease;
		background: white;
	}

	.new-field-form input:focus,
	.new-field-form select:focus {
		outline: none;
		border-color: #007bff;
		box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
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
		content: "⏰";
		margin-right: 0.5rem;
	}

	.unlinked-info {
		padding: 2.5rem;
		background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
		border: 2px solid #ffeaa7;
		border-radius: 16px;
		text-align: center;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
		position: relative;
		overflow: hidden;
	}

	.unlinked-info::before {
		content: "🔗";
		position: absolute;
		top: 1rem;
		right: 1rem;
		font-size: 1.5rem;
		opacity: 0.6;
	}

	.unlinked-message {
		color: #856404;
		margin-bottom: 2rem;
		font-style: italic;
		font-size: 1.1rem;
		line-height: 1.5;
	}

	.unlinked-info form {
		background: white;
		border-radius: 12px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		margin-top: 1.5rem;
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

		.primary-actions,
		.navigation-actions {
			justify-content: stretch;
		}

		.action-row button {
			width: 100%;
		}

		h2 {
			font-size: 1.2rem;
			padding: 1rem;
		}
	}

	/* Loading states - only show spinner for buttons that are actually saving */
	button[type="submit"]:disabled {
		position: relative;
	}

	button[type="submit"]:disabled::after {
		content: "";
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