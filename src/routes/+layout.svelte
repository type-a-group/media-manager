<script lang="ts">
	import { onMount } from 'svelte';
	import '../app.css';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { TOOLTIP_DELAY_MS } from '$lib/utils.js';
	import { settingsStore } from '$lib/stores/settings.js';

	let { children } = $props();

	// Every route brings its own chrome: the dashboard (/), the files hub (/files), and the record
	// hub (/media/[typeId]) each own their sidebar/grid/panel layout. The layout only mounts global
	// concerns (theme, toasts, tooltips, the ⌘K command palette) and warms the settings store.
	onMount(() => {
		settingsStore.fetchSettings();
	});
</script>

<!-- Mounted at the top level so the theme (.dark class on <html>) applies on every route. -->
<ModeWatcher defaultMode="system" />
<Tooltip.Provider delayDuration={TOOLTIP_DELAY_MS}>
	{@render children?.()}
</Tooltip.Provider>
<CommandPalette />
<Toaster />
