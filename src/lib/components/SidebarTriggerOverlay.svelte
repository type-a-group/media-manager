<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { useSidebar } from '$lib/components/ui/sidebar/index.js';

	/**
	 * Renders the sidebar toggle trigger fixed in the corner only when the sidebar is collapsed.
	 * When expanded, the trigger lives in the sidebar header (AppSidebar); this overlay shows nothing.
	 */
	const sidebar = useSidebar();
</script>

{#if sidebar.state === 'collapsed'}
	<div class="fixed top-3 left-3 z-50">
		<Sidebar.Trigger />
	</div>
{/if}
