<script lang="ts">
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
</script>

<header class="flex flex-row justify-between items-center">
	<h2 class="text-lg font-bold pl-2">Media Manager</h2>
	<div class="flex flex-row gap-2">
		<Sidebar.Trigger />
	</div>
</header>
<Separator />
