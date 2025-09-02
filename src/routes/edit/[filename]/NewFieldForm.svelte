<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { toast } from 'svelte-sonner';
	import {
		type SuperValidated,
		type Infer,
		superForm,
	} from "sveltekit-superforms";
	import { zodClient } from "sveltekit-superforms/adapters";
	import { newFieldSchema, getDefaultValue, type NewFieldSchema } from "./newfield_schema.js";

	/**
	 * Props for the NewFieldForm component.
	 * @param onFieldAdded - Callback fired when a new field is successfully added
	 * @param onCancel - Callback fired when the form is cancelled
	 */
	interface Props {
		onFieldAdded?: (fieldName: string, fieldType: string, defaultValue: any) => void;
		onCancel?: () => void;
	}

	let { onFieldAdded, onCancel }: Props = $props();

	let saving = $state(false);

	// Initialize the form with default values
	const initialData: Infer<NewFieldSchema> = {
		fieldName: '',
		fieldType: 'string',
		defaultString: '',
		defaultNumber: 0,
		defaultBoolean: false,
	};

	/**
	 * Configure SuperForm for client-side validation and submission handling.
	 * Uses SPA mode for immediate feedback without page reloads.
	 */
	const form = superForm(initialData, {
		SPA: true,
		validators: zodClient(newFieldSchema),
		resetForm: true,
		onSubmit: async ({ cancel }) => {
			saving = true;
			cancel(); // Prevent default form submission, handle manually
			await handleSubmit();
		},
		onResult: ({ result }) => {
			saving = false;
		}
	});

	const { form: formData, enhance } = form;

	/**
	 * Handles form submission by posting to the schema API.
	 * Creates a new field in the schema with the specified type and default value.
	 */
	async function handleSubmit() {
		const data = $formData;
		try {
			const defaultValue = getDefaultValue(data);

			const response = await fetch('/api/schema', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					fieldName: data.fieldName,
					fieldType: data.fieldType,
					defaultValue: defaultValue
				})
			});

			if (response.ok) {
				const result = await response.json();
				toast.success(`Field "${data.fieldName}" added successfully`);
				
				// Reset form to initial state
				form.reset();
				
				// Notify parent component
				onFieldAdded?.(data.fieldName, data.fieldType, defaultValue);
			} else {
				const result = await response.json();
				toast.error(`Error adding field: ${result.message || 'Unknown error'}`);
			}
		} catch (error) {
			console.error('Error adding field:', error);
			toast.error('Error adding field. Please try again.');
		} finally {
			saving = false;
		}
	}

	/**
	 * Handles form cancellation by resetting form state and notifying parent.
	 */
	function handleCancel() {
		form.reset();
		onCancel?.();
	}


</script>

<form method="POST" use:enhance>
	<div class="flex flex-col gap-4">
		<h4 class="font-medium">Create New Field</h4>
		
		<!-- Field Name Input -->
		<Form.Field {form} name="fieldName">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Field Name</Form.Label>
					<Input
						type="text"
						{...props}
						bind:value={$formData.fieldName}
						placeholder="e.g., location, rating, tags"
						class="w-full"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Field Type Selection -->
		<Form.Field {form} name="fieldType">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>Field Type</Form.Label>
					<Select.Root type="single" bind:value={$formData.fieldType}>
						<Select.Trigger class="w-full">
							{$formData.fieldType}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="string">Text (String)</Select.Item>
							<Select.Item value="number">Number</Select.Item>
							<Select.Item value="boolean">True/False (Boolean)</Select.Item>
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<!-- Default Value Inputs (conditional based on field type) -->
		{#if $formData.fieldType === 'string'}
			<Form.Field {form} name="defaultString">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Default Value</Form.Label>
						<Input
							type="text"
							{...props}
							bind:value={$formData.defaultString}
							placeholder="Default text value"
							class="w-full"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{:else if $formData.fieldType === 'number'}
			<Form.Field {form} name="defaultNumber">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Default Value</Form.Label>
						<Input
							type="number"
							{...props}
							bind:value={$formData.defaultNumber}
							placeholder="0"
							class="w-full"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{:else if $formData.fieldType === 'boolean'}
			<Form.Field {form} name="defaultBoolean">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>Default Value</Form.Label>
						<div class="flex items-center gap-2">
							<Checkbox
								{...props}
								bind:checked={$formData.defaultBoolean}
							/>
							<span class="text-sm text-foreground">
								{$formData.defaultBoolean ? 'True' : 'False'}
							</span>
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{/if}

		<!-- Action Buttons -->
		<div class="flex gap-2 justify-end">
			<Button
				type="button"
				variant="outline"
				onclick={handleCancel}
				disabled={saving}
			>
				Cancel
			</Button>
			<Button
				type="submit"
				disabled={saving}
			>
				{saving ? 'Adding...' : 'Add Field'}
			</Button>
		</div>
	</div>
</form>

<style>
	/* Add any component-specific styles here if needed */
</style>
