<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import EntityRail from '$lib/components/rail/EntityRail.svelte';
	import EntityRowMenu from '$lib/components/entity-settings/EntityRowMenu.svelte';
	import SearchBox from '$lib/components/SearchBox.svelte';
	import SearchFieldSelect from '$lib/components/SearchFieldSelect.svelte';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import { Plus } from 'lucide-svelte';
	import type { MediaTypeSummary } from '$lib/api/client.js';

	/**
	 * The Records Explorer's persistent type rail — the cross-cutting navigator for the records
	 * sub-app, composed on the shared {@link EntityRail} shell (collapse + header + footer unified with
	 * the Files sidebar). Lists every `json` record type and switches the active type on click
	 * (**navigate** mode, single-select). Each row carries the shared ⋮ menu (Settings… / Delete). The
	 * reserved `globals` singleton is not listed here — it has its own sub-app at `/globals`.
	 *
	 * @param types - Every record type (from `apiListMediaTypes`).
	 * @param activeTypeId - The currently open type (highlighted).
	 * @param collapsed - Icon-only when true (state persisted by the host).
	 * @param onSelect - Switch the active type.
	 * @param onToggleCollapse - Flip collapsed (host persists it).
	 * @param onNewType - Open the host's new-type dialog.
	 * @param onOpenSettings - Open the unified settings dialog for a type.
	 * @param onDeleteType - Open the host's delete confirmation for a type.
	 * @param query - Bindable record search text (lives in the rail, mirroring the Files hub).
	 * @param searchField - Bindable field to scope the search to (`''` = All fields).
	 * @param searchFields - The active type's user fields offered by the search-field picker.
	 */
	let {
		types,
		activeTypeId,
		collapsed,
		onSelect,
		onToggleCollapse,
		onNewType,
		onOpenSettings,
		onDeleteType,
		query = $bindable(''),
		searchField = $bindable(''),
		searchFields = []
	}: {
		types: MediaTypeSummary[];
		activeTypeId: string | null;
		collapsed: boolean;
		onSelect: (id: string) => void;
		onToggleCollapse: () => void;
		onNewType: () => void;
		onOpenSettings: (id: string) => void;
		onDeleteType: (id: string) => void;
		query?: string;
		searchField?: string;
		searchFields?: { key: string; label: string }[];
	} = $props();
</script>

<EntityRail current="records" {collapsed} {onToggleCollapse}>
	{#snippet belowHeader()}
		<div class="flex flex-col gap-2">
			<SearchBox bind:value={query} placeholder="Search records…" />
			<SearchFieldSelect
				fields={searchFields}
				bind:value={searchField}
				allLabel="All fields"
				disabled={searchFields.length === 0}
			/>
		</div>
	{/snippet}

	{#snippet body()}
		<div class="mb-1 flex items-center justify-between px-2">
			<span class="text-xs font-medium uppercase text-muted-foreground">Record types</span>
			<Button variant="ghost" size="sm" class="h-6 px-1 text-xs" onclick={onNewType}>
				<Plus class="size-3" /> New
			</Button>
		</div>
		{#each types as t (t.id)}
			<div
				class="group flex items-center gap-1 rounded-md hover:bg-muted {t.id === activeTypeId
					? 'bg-secondary'
					: ''}"
			>
				<Button
					variant="ghost"
					size="sm"
					class="min-w-0 flex-1 justify-start gap-2 hover:bg-transparent"
					onclick={() => onSelect(t.id)}
				>
					<EntityIcon name={t.icon} fallback="file-text" class="size-4 shrink-0" />
					<span class="truncate">{t.displayName}</span>
				</Button>
				<span
					class="opacity-0 transition-opacity group-hover:opacity-100 {t.id === activeTypeId
						? 'opacity-100'
						: ''}"
				>
					<EntityRowMenu
						noun="record type"
						onSettings={() => onOpenSettings(t.id)}
						onDelete={() => onDeleteType(t.id)}
					/>
				</span>
			</div>
		{/each}
	{/snippet}

	{#snippet collapsedBody()}
		<div class="flex flex-col items-center gap-0.5">
			{#each types as t (t.id)}
				<Tooltip.Provider delayDuration={300}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant={t.id === activeTypeId ? 'secondary' : 'ghost'}
									size="icon"
									onclick={() => onSelect(t.id)}
								>
									<EntityIcon name={t.icon} fallback="file-text" class="size-4" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{t.displayName}</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{/each}
			<Tooltip.Provider delayDuration={300}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="icon" class="mt-1" onclick={onNewType}>
								<Plus class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right">New record type</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		</div>
	{/snippet}
</EntityRail>
