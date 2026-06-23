<script lang="ts">
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';

	/**
	 * A thin shared **breadcrumb trail** wrapped over the shadcn `Breadcrumb` primitive, used in the
	 * content-column header of every sub-app for a consistent `Home › <Sub-app> › <Entity> › <Item>`
	 * path. Each crumb with an `href` is a link; the final crumb (or any crumb without `href`) renders
	 * as the non-link current page. Keeps the markup in one place so all three hubs read the same.
	 *
	 * @param items - Ordered crumbs; an item without `href` is rendered as the current (non-link) page.
	 */
	let { items }: { items: { label: string; href?: string }[] } = $props();
</script>

<Breadcrumb.Root>
	<Breadcrumb.List>
		{#each items as crumb, i (i)}
			<Breadcrumb.Item>
				{#if crumb.href && i < items.length - 1}
					<Breadcrumb.Link href={crumb.href}>{crumb.label}</Breadcrumb.Link>
				{:else}
					<Breadcrumb.Page>{crumb.label}</Breadcrumb.Page>
				{/if}
			</Breadcrumb.Item>
			{#if i < items.length - 1}
				<Breadcrumb.Separator />
			{/if}
		{/each}
	</Breadcrumb.List>
</Breadcrumb.Root>
