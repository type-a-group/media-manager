<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { X, ChevronLeft, ChevronRight } from 'lucide-svelte';

	/**
	 * The shared right-hand editor side panel used by both the files hub ({@link FileEditorPanel}) and
	 * the json record views ({@link RecordEditorPanel}). It owns only chrome — the fixed-width `<aside>`,
	 * the prev/next chevrons + ←/→ key navigation, and the close button — and delegates everything
	 * type-specific (title, header actions, body) to snippets. The grid behind it stays mounted; this
	 * panel is a flex sibling of `<main>`, not an overlay.
	 *
	 * Navigation: the chevrons and arrow keys call `onPrev`/`onNext`. Those handlers (supplied by the
	 * host) are where any save-on-advance behaviour lives — the shell stays agnostic of dirty state.
	 *
	 * @param index - Position of the open item in the current grid order (for enabling prev/next).
	 * @param total - Total items in the current grid order.
	 * @param onPrev - Go to the previous item (host may autosave first).
	 * @param onNext - Go to the next item (host may autosave first).
	 * @param onclose - Close the panel.
	 * @param titleArea - Snippet rendered between the chevrons and the close button (e.g. a rename input).
	 * @param actions - Optional snippet rendered just before the close button (e.g. a metadata button).
	 * @param children - The scrollable panel body.
	 */
	let {
		index = -1,
		total = 0,
		onPrev,
		onNext,
		onclose,
		titleArea,
		actions,
		children
	}: {
		index?: number;
		total?: number;
		onPrev?: () => void;
		onNext?: () => void;
		onclose: () => void;
		titleArea?: Snippet;
		actions?: Snippet;
		children: Snippet;
	} = $props();

	const hasPrev = $derived(index > 0);
	const hasNext = $derived(index >= 0 && index < total - 1);

	$effect(() => {
		// ←/→ walk the grid order, unless focus is in a form control (so arrow keys still edit text).
		function onKey(e: KeyboardEvent) {
			const el = document.activeElement as HTMLElement | null;
			if (
				el &&
				(el instanceof HTMLInputElement ||
					el instanceof HTMLTextAreaElement ||
					el instanceof HTMLSelectElement ||
					el.isContentEditable)
			)
				return;
			if (e.key === 'ArrowLeft' && hasPrev) {
				e.preventDefault();
				onPrev?.();
			} else if (e.key === 'ArrowRight' && hasNext) {
				e.preventDefault();
				onNext?.();
			}
		}
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

<aside class="flex h-full w-[420px] shrink-0 flex-col border-l bg-card">
	<header class="flex items-center gap-1 border-b p-3">
		<Button
			variant="outline"
			size="icon"
			title="Previous (←)"
			disabled={!hasPrev}
			onclick={() => onPrev?.()}
		>
			<ChevronLeft class="size-4" />
		</Button>
		<Button
			variant="outline"
			size="icon"
			title="Next (→)"
			disabled={!hasNext}
			onclick={() => onNext?.()}
		>
			<ChevronRight class="size-4" />
		</Button>
		{@render titleArea?.()}
		{@render actions?.()}
		<Button variant="ghost" size="icon" title="Close" onclick={onclose}>
			<X class="size-4" />
		</Button>
	</header>

	<div class="flex-1 overflow-y-auto p-3">
		{@render children()}
	</div>
</aside>
