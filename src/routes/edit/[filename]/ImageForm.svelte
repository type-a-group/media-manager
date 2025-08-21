<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { settingsStore } from '$lib/stores/settings';
	import { toast } from 'svelte-sonner';
	import DeleteButton from '$lib/components/DeleteButton.svelte';
	import * as Form from '$lib/components/ui/form/index.js';
	import {
			type SuperValidated,
			type Infer,
			superForm,
		} from "sveltekit-superforms";
	import { fetchSchema, fetchUISchema, type FormSchema } from "./imageform_schema.js";
	// import { goto } from '$app/navigation';

	let uiSchema = $state<Record<string, any> | null>(null);
	// let imageUrl = $state<string | null>(null);
	let saving = $state(false);
	
	let { data }: { data: { form: SuperValidated<Infer<FormSchema>>, filename: string } } =
    $props();
    let filename = $derived(data.filename);

	// Initialize superForm during component setup to satisfy Svelte lifecycle rules
	const form = superForm(data.form, {
		SPA: true,
		validators: false,
		resetForm: false,
		onResult: async ({ result, formElement, cancel }) => {
			console.log('[superForm onResult]', { result, formElement, cancel });
			if (result && (result.type === 'success' || (result.status && result.status < 400))) {
				toast.success('Saved successfully');
				console.log('[superForm] saved form data', $formData);
				try {
					// Persist directly as a fallback to ensure data is saved when actions are not invoked
					await handleSubmit();
					const rb = await fetch(`/api/images/properties/${filename}`);
					console.log('[readback GET status]', rb.status);
					const rbJson = await rb.json();
					console.log('[readback GET json]', rbJson);
				} catch (e) {
					console.error('[readback GET failed]', e);
				}
			} else {
				toast.error('Error saving properties.');
			}
		}
	});
	const { form: formData, enhance } = form;

	$effect(() => {
		(async () => {
			try {
				uiSchema = await fetchUISchema();
			} catch (e) {
				console.error(e);
				toast.error('Failed to initialize form');
			}
		})();
	});
	
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
		// Otherwise, update existing properties
		// if (!filename) return;
		saving = true;
        
        // Build payload from current form data value
        const properties: Record<string, any> = {};
        for (const [key, value] of Object.entries($formData)) {
            if (key !== 'file_name' && key !== 'last_modified' && key !== 'default') {
                properties[key] = value;
            }
        }

		const response = await fetch(`/api/images/properties/${filename}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(properties)
		});

		saving = false;
		if (response.ok) {
			toast("Saved successfully");
		} else {
			toast("Error saving properties.");
		}
	}

	async function handleDeleteField(fieldName: string) {
		const response = await fetch('/api/schema', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ fieldName })
		});

		if (response.ok) {
			toast.success(`Field deleted successfully`);
		} else {
			const result = await response.json();
			toast.error(`Error deleting field: ${result.message}`);
		}
	}
</script>

    <!-- <form onsubmit={handleSubmit} class="flex flex-col gap-2"> -->
<form method="POST" use:enhance action="?/default">
    {#if uiSchema}
        <!-- Dynamic fields -->
        {#each Object.entries(uiSchema) as [fieldName, fieldProps]}
            {#if fieldName !== 'file_name' && fieldName !== 'last_modified' && fieldName !== 'default'}
                <Form.Field {form} name={fieldName as never}>
                    <Form.Control>
                        {#snippet children({ props })}
                            {#if fieldProps.type === 'boolean'}
                                <div class="flex flex-row gap-2 items-center h-full w-full justify-between">
                                    <div class="flex flex-row gap-2 items-center h-full w-full">
                                        <Form.Label>{fieldName === 'image_name' ? 'Image Name' : fieldName}</Form.Label>
                                        <Checkbox
                                            class="form-checkbox"
                                            {...props}
                                            bind:checked={$formData[fieldName as never]}
                                        />
                                    </div>
                                    <DeleteButton
                                        title="Delete Field"
                                        description={`Are you sure you want to delete the "${fieldName}" field? This will remove it from all images.`}
                                        onDelete={() => handleDeleteField(fieldName)}
                                    />
                                </div>
                            {:else if fieldProps.type === 'number'}
                                <div>
                                    <Form.Label>{fieldName === 'image_name' ? 'Image Name' : fieldName}</Form.Label>
                                    <div class="flex flex-row gap-2 items-center h-full w-full">
                                        <Input
                                            type="number"
                                            class="w-full"
                                            {...props}
                                            bind:value={$formData[fieldName as never]}
                                        />
                                        <DeleteButton
                                            title="Delete Field"
                                            description={`Are you sure you want to delete the "${fieldName}" field? This will remove it from all images.`}
                                            onDelete={() => handleDeleteField(fieldName)}
                                        />
                                    </div>
                                </div>
                            {:else}
                                <div>
                                    <Form.Label>{fieldName === 'image_name' ? 'Image Name' : fieldName}</Form.Label>
                                    <div class="flex flex-row gap-2 items-center h-full w-full">
                                    <Input
                                        type="text"
                                        class=""
                                        {...props}
                                        bind:value={$formData[fieldName as never]}
                                        placeholder={fieldName === 'image_name' ? 'Custom display name' : ''}
                                    />
                                    <DeleteButton
                                        title="Delete Field"
                                        description={`Are you sure you want to delete the "${fieldName}" field? This will remove it from all images.`}
                                        onDelete={() => handleDeleteField(fieldName)}
                                    />
                                    </div>
                                </div>
                            {/if}
                        {/snippet}
                    </Form.Control>
                </Form.Field>
            {/if}
        {/each}
    {/if}
    <div class="flex flex-row gap-2 items-center h-full w-full justify-center">
        <Button variant="default" type="submit" disabled={saving}>
            Submit
        </Button>
    </div>
</form>

<style>
</style>