<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';

	import { fieldLabel } from '$lib/core/fieldKeys.js';
	import type { ClassConfig } from '$lib/core/types.js';
	import { apiGetClass, apiUpdateClassConfig } from '$lib/api/files.js';

	/**
	 * Class settings dialog: edit a class's config — display name, the field shown as each row's
	 * label (`displayField`), the catalog group-by field (`gridGroupByField`), and grid size — via
	 * `apiUpdateClassConfig`.
	 *
	 * @param classId - The class being configured.
	 * @param open - Bindable dialog open state.
	 * @param onchanged - Called after a successful save (refresh sidebar names/counts).
	 */
	let {
		classId,
		open = $bindable(false),
		onchanged
	}: {
		classId: string;
		open?: boolean;
		onchanged?: () => void;
	} = $props();

	const GRID_SIZES = ['small', 'medium', 'large'] as const;

	let loading = $state(false);
	let saving = $state(false);
	let schemaKeys = $state<string[]>([]);
	let displayName = $state('');
	let displayField = $state('');
	let gridGroupByField = $state('');
	let gridSize = $state<'small' | 'medium' | 'large'>('medium');

	async function load() {
		loading = true;
		try {
			const detail = await apiGetClass(classId);
			schemaKeys = Object.keys(detail.schema).sort((a, b) => a.localeCompare(b));
			displayName = detail.config.displayName ?? '';
			displayField = detail.config.displayField ?? '';
			gridGroupByField = detail.config.gridGroupByField ?? '';
			gridSize = detail.config.gridSize ?? 'medium';
		} catch (e) {
			console.error(e);
			toast.error('Failed to load class settings');
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && classId) load();
	});

	async function save() {
		const name = displayName.trim();
		if (!name) return toast.error('Display name is required');
		saving = true;
		try {
			const patch: Partial<ClassConfig> = {
				displayName: name,
				displayField: displayField || undefined,
				gridGroupByField: gridGroupByField || undefined,
				gridSize
			};
			await apiUpdateClassConfig(classId, patch);
			toast.success('Settings saved');
			open = false;
			onchanged?.();
		} catch (e) {
			console.error(e);
			toast.error('Failed to save settings');
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Title>Class settings</Dialog.Title>
		<Dialog.Description
			>Rename the class and choose how its catalog view renders.</Dialog.Description
		>

		{#if loading}
			<p class="py-4 italic text-muted-foreground">Loading…</p>
		{:else}
			<div class="flex flex-col gap-4 py-4">
				<div class="flex flex-col gap-2">
					<Label for="class-display-name">Display name</Label>
					<Input
						id="class-display-name"
						type="text"
						bind:value={displayName}
						placeholder="Class name"
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label>Display field (row label)</Label>
					<Select.Root type="single" value={displayField} onValueChange={(v) => (displayField = v)}>
						<Select.Trigger
							>{displayField ? fieldLabel(displayField) : 'Filename (default)'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="">Filename (default)</Select.Item>
							{#each schemaKeys as k (k)}
								<Select.Item value={k}>{fieldLabel(k)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label>Group by</Label>
					<Select.Root
						type="single"
						value={gridGroupByField}
						onValueChange={(v) => (gridGroupByField = v)}
					>
						<Select.Trigger
							>{gridGroupByField ? fieldLabel(gridGroupByField) : 'None'}</Select.Trigger
						>
						<Select.Content>
							<Select.Item value="">None</Select.Item>
							{#each schemaKeys as k (k)}
								<Select.Item value={k}>{fieldLabel(k)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label>Grid size</Label>
					<Select.Root
						type="single"
						value={gridSize}
						onValueChange={(v) => (gridSize = v as typeof gridSize)}
					>
						<Select.Trigger class="w-40">{gridSize}</Select.Trigger>
						<Select.Content>
							{#each GRID_SIZES as s (s)}
								<Select.Item value={s}>{s}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={save} disabled={saving || loading}>Save</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
