<script lang="ts">
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import EntityIcon from '$lib/components/EntityIcon.svelte';
	import type { IconId } from '$lib/core/icons.js';

	/**
	 * A thin shared **breadcrumb trail** wrapped over the shadcn `Breadcrumb` primitive, used in the
	 * content-column header of every sub-app for a consistent `Home › <Sub-app> › <Entity> › <Item>`
	 * path. Each crumb with an `href` is a link; the final crumb (or any crumb without `href`) renders
	 * as the non-link current page. Keeps the markup in one place so all three hubs read the same.
	 *
	 * @param items - Ordered crumbs; an item without `href` is rendered as the current (non-link) page.
	 *   A crumb may carry an `icon` (stored id) + `iconFallback` to prefix its label with the entity icon.
	 */
	let {
		items
	}: {
		items: { label: string; href?: string; icon?: string; iconFallback?: IconId }[];
	} = $props();
</script>

{#snippet crumbLabel(crumb: (typeof items)[number])}
	{#if crumb.iconFallback}
		<EntityIcon name={crumb.icon} fallback={crumb.iconFallback} class="size-3.5" />
	{/if}
	{crumb.label}
{/snippet}

<Breadcrumb.Root>
	<Breadcrumb.List>
		{#each items as crumb, i (i)}
			<Breadcrumb.Item class="gap-1.5 [&>*]:inline-flex [&>*]:items-center [&>*]:gap-1.5">
				{#if crumb.href && i < items.length - 1}
					<Breadcrumb.Link href={crumb.href}>{@render crumbLabel(crumb)}</Breadcrumb.Link>
				{:else}
					<Breadcrumb.Page>{@render crumbLabel(crumb)}</Breadcrumb.Page>
				{/if}
			</Breadcrumb.Item>
			{#if i < items.length - 1}
				<Breadcrumb.Separator />
			{/if}
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
