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
	import DeleteButton from '$lib/components/DeleteButton.svelte';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { toast } from 'svelte-sonner';
	import {
			type SuperValidated,
			type Infer,
		} from "sveltekit-superforms";
	import { fetchUISchema, type FormSchema } from "./imageform_schema.js";
	import ImageForm from './ImageForm.svelte';
	import NewFieldForm from './NewFieldForm.svelte';

	// let filename = $derived($page.params.filename);
	let properties = $state<Record<string, any> | null>(null);
	// let schema = $state<Record<string, any> | null>(null);
	let schema = $state<Record<string, any> | null>(null);
	let imageUrl = $state<string | null>(null);
	let saving = $state(false);

	let { data }: { data: { form: SuperValidated<Infer<FormSchema>>, filename: string } } = $props();
	let filename = $derived(data.filename);

	let showNewFieldForm = $state(false);
	
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

	/**
	 * Handles successful field addition by updating the local schema and properties.
	 * Called when the NewFieldForm component successfully creates a new field.
	 * 
	 * @param fieldName - The name of the newly created field
	 * @param fieldType - The type of the newly created field
	 * @param defaultValue - The default value for the newly created field
	 */
	async function handleFieldAdded(fieldName: string, fieldType: string, defaultValue: any) {
		try {
			// Refresh the schema from the server to get the latest changes
			const updatedSchema = await fetchUISchema();
			schema = updatedSchema;

			// Add the new field to current properties if they exist
			if (properties) {
				properties[fieldName] = defaultValue;
			}

			// Hide the form
			showNewFieldForm = false;
		} catch (error) {
			console.error('Error refreshing schema after field addition:', error);
			toast.error('Field added but failed to refresh interface. Please reload the page.');
		}
	}

	/**
	 * Handles form cancellation by hiding the new field form.
	 */
	function handleFieldFormCancel() {
		showNewFieldForm = false;
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

	/**
	 * Delete the current image and its properties, then navigate to a neighbor.
	 * Chooses next item if available; otherwise previous; otherwise home.
	 */
	async function handleUnlinkImage() {
		if (!filename) return;

		const current = filename;
		const nextCandidate = (() => {
			if (currentList.length === 0 || currentIndex === -1) return null as string | null;
			if (currentIndex < currentList.length - 1) return currentList[currentIndex + 1];
			if (currentIndex > 0) return currentList[currentIndex - 1];
			return null as string | null;
		})();

		try {
			const res = await fetch(`/api/images/${current}`, { method: 'DELETE' });
			if (!res.ok) {
				toast("Failed to unlink image");
				return;
			}
			toast("Image unlinked");
			await fetchImageLists();
			const view = $page.url.searchParams.get('view') || 'linked';
			if (nextCandidate) {
				goto(`/edit/${nextCandidate}?view=${view}`);
			} else {
				goto(`/?view=${view}`);
			}
		} catch (e) {
			console.error('Delete failed', e);
			toast("Unlink failed");
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
					<div class="ml-auto inline-flex">
						<DeleteButton
							title="Unlink Image"
							description="This will remove this image's properties only. The file remains on disk."
							actionText="Unlink"
							tooltip="Unlink this image (keep file)"
							onDelete={handleUnlinkImage}
						/>
					</div>
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
									<Popover.Content class="w-80">
										<NewFieldForm 
											onFieldAdded={handleFieldAdded}
											onCancel={handleFieldFormCancel}
										/>
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