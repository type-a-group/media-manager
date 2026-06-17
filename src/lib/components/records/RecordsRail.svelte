<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import SettingsButton from '$lib/components/SettingsButton.svelte';
	import { Home, FileText, Plus, PanelLeftClose, PanelLeftOpen } from 'lucide-svelte';
	import type { MediaTypeSummary } from '$lib/api/client.js';

	/**
	 * The Records Explorer's persistent type rail — the cross-cutting navigator for the records
	 * sub-app. Lists every `json` record type and switches the Explorer's active type on click; it is
	 * **records-only** (no "All Files" / "All Records" entry) because records aren't attached to blobs.
	 * Collapses to an icon-only strip (state persisted by the shell). Pure presentational: the host
	 * (`/media/+page.svelte`) owns the type list, active id, and the new-type dialog.
	 *
	 * @param types - Every record type (from `apiListMediaTypes`).
	 * @param activeTypeId - The currently open type (highlighted).
	 * @param collapsed - Icon-only when true.
	 * @param onSelect - Switch the active type.
	 * @param onToggleCollapse - Flip collapsed (host persists it).
	 * @param onNewType - Open the host's new-type dialog.
	 */
	let {
		types,
		activeTypeId,
		collapsed,
		onSelect,
		onToggleCollapse,
		onNewType
	}: {
		types: MediaTypeSummary[];
		activeTypeId: string | null;
		collapsed: boolean;
		onSelect: (id: string) => void;
		onToggleCollapse: () => void;
		onNewType: () => void;
	} = $props();
</script>

<aside
	class="flex h-screen shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 {collapsed
		? 'w-14'
		: 'w-56'}"
>
	<!-- Header: brand + collapse toggle -->
	<div class="flex h-12 items-center gap-2 border-b px-2">
		{#if !collapsed}
			<span class="flex-1 truncate px-1 text-sm font-semibold">Records</span>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class={collapsed ? 'mx-auto' : ''}
			onclick={onToggleCollapse}
			title={collapsed ? 'Expand rail' : 'Collapse rail'}
		>
			{#if collapsed}
				<PanelLeftOpen class="size-4" />
			{:else}
				<PanelLeftClose class="size-4" />
			{/if}
		</Button>
	</div>

	<!-- Type list -->
	<nav class="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
		{#if !collapsed}
			<span class="px-2 pb-1 text-xs font-medium uppercase text-muted-foreground">Types</span>
		{/if}
		{#each types as t (t.id)}
			{#if collapsed}
				<Tooltip.Provider delayDuration={300}>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant={t.id === activeTypeId ? 'secondary' : 'ghost'}
									size="icon"
									class="mx-auto"
									onclick={() => onSelect(t.id)}
								>
									<FileText class="size-4" />
								</Button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content side="right">{t.displayName}</Tooltip.Content>
					</Tooltip.Root>
				</Tooltip.Provider>
			{:else}
				<Button
					variant={t.id === activeTypeId ? 'secondary' : 'ghost'}
					size="sm"
					class="w-full justify-start gap-2"
					onclick={() => onSelect(t.id)}
				>
					<FileText class="size-4 shrink-0" />
					<span class="truncate">{t.displayName}</span>
				</Button>
			{/if}
		{/each}

		<!-- New type -->
		{#if collapsed}
			<Tooltip.Provider delayDuration={300}>
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="mx-auto mt-1"
								onclick={onNewType}
							>
								<Plus class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content side="right">New record type</Tooltip.Content>
				</Tooltip.Root>
			</Tooltip.Provider>
		{:else}
			<Button
				variant="ghost"
				size="sm"
				class="mt-1 w-full justify-start gap-2 text-muted-foreground"
				onclick={onNewType}
			>
				<Plus class="size-4 shrink-0" />
				<span class="truncate">New record type</span>
			</Button>
		{/if}
	</nav>

	<!-- Footer: Home + Settings -->
	<div class="flex items-center gap-1 border-t p-2 {collapsed ? 'flex-col' : 'justify-between'}">
		<Button variant="ghost" size="icon" href="/" title="Home">
			<Home class="size-4" />
		</Button>
		<SettingsButton />
	</div>
</aside>
