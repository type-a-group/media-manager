<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { setMode, resetMode, userPrefersMode } from 'mode-watcher';

	/**
	 * Reusable Appearance section for global settings.
	 * Renders Light / Dark / System theme buttons using mode-watcher.
	 * Highlights the button for the currently selected theme (user preference).
	 *
	 * Use case: Shared in root-page Global settings dialog and in project-view
	 * Settings dialog (Global settings tab).
	 *
	 * Concerns / future improvements:
	 * - If theme is persisted server-side later, this component could accept
	 *   an optional callback on change or read initial value from a store.
	 */
</script>

<div class="flex flex-col gap-2">
	<h3 class="text-lg font-bold">Appearance</h3>
	<div class="flex flex-row gap-2">
		<Button
			variant={userPrefersMode.current === 'light' ? 'default' : 'outline'}
			size="sm"
			onclick={() => setMode('light')}
		>
			Light
		</Button>
		<Button
			variant={userPrefersMode.current === 'dark' ? 'default' : 'outline'}
			size="sm"
			onclick={() => setMode('dark')}
		>
			Dark
		</Button>
		<Button
			variant={userPrefersMode.current === 'system' ? 'default' : 'outline'}
			size="sm"
			onclick={() => resetMode()}
		>
			System
		</Button>
	</div>
</div>
