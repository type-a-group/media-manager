<script lang="ts">
	import { page } from '$app/stores';
	import { ChevronLeft, ChevronRight } from 'lucide-svelte';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { goto } from '$app/navigation';
	import { filteredImageList } from '$lib/stores/imageList';
	import { onMount, onDestroy } from 'svelte';
	import MetadataButton from '$lib/components/MetadataButton.svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { toast } from 'svelte-sonner';
	import {
			type SuperValidated,
			type Infer,
		} from "sveltekit-superforms";
	import { fetchUISchema, type FormSchema } from "./imageform_schema.js";
	import ImageForm from './ImageForm.svelte';

	// let filename = $derived($page.params.filename);
	let properties = $state<Record<string, any> | null>(null);
	// let schema = $state<Record<string, any> | null>(null);
	let schema = $state<Record<string, any> | null>(null);
	let imageUrl = $state<string | null>(null);
	let saving = $state(false);

	let { data }: { data: { form: SuperValidated<Infer<FormSchema>>, filename: string } } = $props();
	let filename = $derived(data.filename);

	let showNewFieldForm = $state(false);
	let newFieldName = $state('');
	let newFieldType = $state('string');
	let newFieldDefaultString = $state('');
	let newFieldDefaultNumber = $state(0);
	let newFieldDefaultBoolean = $state(false);
	
	let showMetadataPopup = $state(false);

	// let { data }: { data: { form: SuperValidated<Infer<FormSchema>> } } =
    // $props();
 
	// const form = superForm(data.form, {
	// 	validators: schema ? zodClient(schema) : undefined,
	// });
	
	// const { form: formData, enhance } = form;

	// State for creating new properties on unlinked images
	let newProperties = $state<Record<string, any>>({});

	// Reactive computed values for form bindings
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

	// async function fetchSchema() {
	// 	const response = await fetch('/api/schema');
	// 	if (response.ok) {
	// 		schema = await response.json();
	// 	}
	// }

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
	});
	
	// Fetch schema when filename changes
	$effect(() => {
		if (filename) {
			fetchUISchema().then(result => {
				schema = result;
			});
		}
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

<div class="flex flex-wrap gap-4 p-4 items-start min-h-screen">
	{#if filename}
		<div class="flex flex-col gap-4 w-full sm:flex-row min-h-screen">
			<!-- image div -->
			<div class="flex-1/2">
				<Card.Root>
					<Card.Content>
					{#if imageUrl}
						<img src={imageUrl} alt={properties?.image_name || filename}/>
					{/if}
					</Card.Content>
				</Card.Root>
			</div>
			<!-- edit panel div -->
			<div class="flex-1/2 flex flex-col gap-2">
				<Card.Root>
					<Card.Header>
						<Card.Title>
							<div class="flex flex-row items-center h-full gap-2 justify-between w-full">
								<p class="text-sm text-gray-500 flex-1 break-all min-w-0">{filename}</p>
								<MetadataButton {filename} />
							</div>
						</Card.Title>
					</Card.Header>
				<Card.Content>
					<ImageForm {data} />
					<Button
						variant="secondary"
						size="icon"
						onclick={() => navigate('prev')}
						disabled={currentList.length === 0 || currentIndex <= 0}
					>
						<ChevronLeft />
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
				</Card.Content>
				</Card.Root>
				{#if properties?.last_modified}
					<Card.Root>
						<Card.Content>
							<div class="flex flex-col items-center h-full gap-2 justify-between w-full">
								Last modified {formatLastModified(properties?.last_modified)}
								<Popover.Root bind:open={showNewFieldForm}>
									<Popover.Trigger class={buttonVariants({ variant: 'outline' })}>
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
							</div>
						</Card.Content>
					</Card.Root>
				{/if}
			</div>
		</div>
	{:else}
		<p>Select an image from the sidebar to see its details.</p>
	{/if}
</div>
<style>
</style>