<script lang="ts">
	import { page } from '$app/stores';
	import { ChevronLeft, ChevronRight, Info } from 'lucide-svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { goto } from '$app/navigation';
	import { filteredImageList } from '$lib/stores/imageList';
	import { settingsStore } from '$lib/stores/settings';
	import { onMount, onDestroy } from 'svelte';
	import MetadataPopup from './MetadataPopup.svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';

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
		<div class="flex flex-row gap-4 w-full">
		<div class="flex-1/2 max-w-1/2">
			<Card.Root>
				<Card.Content>
				{#if imageUrl}
					<img src={imageUrl} alt={properties?.image_name || filename}/>
				{/if}
				</Card.Content>
			</Card.Root>
		</div>
		<div class="flex-1/2 max-w-1/2 flex flex-col gap-2">
			<Card.Root>
				<Card.Header>
					<Card.Title>
						<div class="flex flex-row gap-2 items-center h-full w-full justify-between">
							{filename}
							<Button variant="outline" type="button" onclick={() => (showMetadataPopup = true)} size="icon">
								<Info />
							</Button>
						</div>
					</Card.Title>
				</Card.Header>
			<Card.Content>
			<form onsubmit={handleSubmit} class="flex flex-col gap-2">
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
							{#if fieldProps.type === 'boolean'}
								<div class="flex flex-row gap-2 items-center h-full w-full justify-between">
									<div class="flex flex-row gap-2 items-center h-full w-full">
										<Label for={fieldName}>{fieldName === 'image_name' ? 'Image Name' : fieldName}</Label>
										<Checkbox
											class="form-checkbox"
											checked={formValues[fieldName]}
											onchange={(e) => updateFormValue(fieldName, (e.target as HTMLInputElement).checked)}
											id={fieldName}
										/>
									</div>
									<Button
										variant="outline"
										size="icon"
										onclick={() => handleDeleteField(fieldName)}
										disabled={!fieldProps.removable || fieldName === 'image_name'}
									>
										️x
									</Button>
								</div>
							{:else if fieldProps.type === 'number'}
								<div>
									<Label for={fieldName}>{fieldName === 'image_name' ? 'Image Name' : fieldName}</Label>
									<div class="flex flex-row gap-2 items-center h-full w-full">
										<Input
											type="number"
											class="w-full"
											value={formValues[fieldName]}
											oninput={(e) => updateFormValue(fieldName, Number((e.target as HTMLInputElement).value))}
											id={fieldName}
										/>
										<Button
											variant="outline"
											size="icon"
											onclick={() => handleDeleteField(fieldName)}
											disabled={!fieldProps.removable || fieldName === 'image_name'}
										>
											️x
										</Button>
									</div>
								</div>
							{:else}
								<div>
									<Label for={fieldName}>{fieldName === 'image_name' ? 'Image Name' : fieldName}</Label>
									<div class="flex flex-row gap-2 items-center h-full w-full">
									<Input
										type="text"
										class=""
										value={formValues[fieldName]}
										oninput={(e) => updateFormValue(fieldName, (e.target as HTMLInputElement).value)}
										placeholder={fieldName === 'image_name' ? 'Custom display name' : ''}
										id={fieldName}
									/>
									<Button
										variant="outline"
										size="icon"
										onclick={() => handleDeleteField(fieldName)}
										disabled={!fieldProps.removable || fieldName === 'image_name'}
									>
										️x
									</Button>
									</div>
								</div>
							{/if}
						{/if}
					{/each}
				{/if}
				<div class="flex flex-row gap-2 items-center h-full w-full justify-center">
					<Button
						variant="secondary"
						size="icon"
						onclick={() => navigate('prev')}
						disabled={currentList.length === 0 || currentIndex <= 0}
					>
						<ChevronLeft />
					</Button>
					<Button variant="default" type="submit" disabled={saving}>
						{saving ? 'Saving...' : properties?.image_name ? 'Save' : 'Save & Link Image'}
					</Button>
					<Button
						variant="secondary"
						size="icon"
						onclick={() => navigate('next')}
						disabled={
							currentList.length === 0 ||
							currentIndex === -1 ||
							currentIndex >= currentList.length - 1
						}
					>
						<ChevronRight />
					</Button>
				</div>
				{#if saveMessage}
					<div class="save-message">{saveMessage}</div>
				{/if}
			</form>
			</Card.Content>
			</Card.Root>

			{#if properties?.last_modified}
				<Card.Root>
					<Card.Content>
						Last modified {formatLastModified(properties?.last_modified)}
						<Popover.Root bind:open={showNewFieldForm}>
							<Popover.Trigger class={buttonVariants({ variant: 'outline' })}>
								<!-- <Button type="button" onclick={() => (showNewFieldForm = !showNewFieldForm)}>
									{showNewFieldForm ? 'Cancel' : 'Create New Field'}
								</Button> -->
								Create New Field
							</Popover.Trigger>
							<Popover.Content class="w-60">
								<div class="flex flex-col gap-2">
									<h4>Create New Field</h4>
									<Label>Field Name</Label>
									<Input type="text" bind:value={newFieldName} />
									<Label>Field Type</Label>
										<Select.Root type="single" bind:value={newFieldType}>
											<Select.Trigger class="w-full">
												{newFieldType}
											</Select.Trigger>
											<Select.Content>
												<Select.Item value="string">String</Select.Item>
												<Select.Item value="number">Number</Select.Item>
												<Select.Item value="boolean">Boolean</Select.Item>
											</Select.Content>
										</Select.Root>
									{#if newFieldType === 'boolean'}
										<div class="flex flex-row gap-2">
											<Label>Default Value: </Label>
											<Checkbox bind:checked={newFieldDefaultBoolean} class="form-checkbox" />
										</div>
									{:else if newFieldType === 'number'}
										<Label>Default Value: </Label>
										<Input type="number" bind:value={newFieldDefaultNumber} class="form-input" />
									{:else}
										<Label>Default Value: </Label>
										<Input type="text" bind:value={newFieldDefaultString} class="form-input" />
									{/if}
									<Button onclick={handleAddNewField}>Add Field</Button>
								</div>
							</Popover.Content>
						</Popover.Root>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
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

		.preview-image {
			max-height: calc(60vh - 4rem);
		}
	}
</style>