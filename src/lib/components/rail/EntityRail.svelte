<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import SettingsButton from '$lib/components/SettingsButton.svelte';
	import { Home, PanelLeftClose, PanelLeftOpen } from 'lucide-svelte';

	/**
	 * The shared **rail shell** for both sub-apps: a collapsible left `<aside>` with a header (title +
	 * collapse toggle), a scrollable body, and a footer (Home + global App settings). The Records type
	 * rail (single-select **navigate** rows) and the Files class sidebar (multi-select **filter** rows)
	 * both compose this — the chrome, collapse behavior, and footer are unified; only the body differs,
	 * injected per side via snippets. Collapsing renders the icon-only `collapsedBody` strip; the active
	 * entity's settings ⋮ then lives in the content-column header (handled by the host).
	 *
	 * @param title - Brand label shown when expanded.
	 * @param collapsed - Icon-only when true (host owns + persists the state).
	 * @param onToggleCollapse - Flip collapsed.
	 * @param body - Expanded body (the rows + per-side extras).
	 * @param collapsedBody - Icon-only body shown when collapsed.
	 * @param belowHeader - Optional content directly under the header in both states (e.g. search).
	 * @param footer - Optional footer override; defaults to Home + App settings.
	 */
	let {
		title,
		collapsed,
		onToggleCollapse,
		body,
		collapsedBody,
		belowHeader,
		footer
	}: {
		title: string;
		collapsed: boolean;
		onToggleCollapse: () => void;
		body: Snippet;
		collapsedBody?: Snippet;
		belowHeader?: Snippet;
		footer?: Snippet;
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
			<span class="flex-1 truncate px-1 text-sm font-semibold">{title}</span>
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

	{#if belowHeader && !collapsed}
		<div class="border-b p-2">
			{@render belowHeader()}
		</div>
	{/if}

	<!-- Body -->
	<div class="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
		{#if collapsed}
			{#if collapsedBody}{@render collapsedBody()}{/if}
		{:else}
			{@render body()}
		{/if}
	</div>

	<!-- Footer -->
	{#if footer}
		{@render footer()}
	{:else}
		<div class="flex items-center gap-1 border-t p-2 {collapsed ? 'flex-col' : 'justify-between'}">
			<Button variant="ghost" size="icon" href="/" title="Home">
				<Home class="size-4" />
			</Button>
			<SettingsButton />
		</div>
	{/if}
</aside>
