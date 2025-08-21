<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';

	const sidebar = Sidebar.useSidebar();
</script>

<div class="flex flex-col items-center justify-center h-full w-full">
	<p class="text-base text-gray-500 text-center italic">
		To get started, select an image from the 
		<Button variant="link" onclick={() => sidebar.toggle()} class="m-0 p-0 align-baseline font-semibold">
			sidebar
		</Button>
		to begin editing.
	</p>
</div>