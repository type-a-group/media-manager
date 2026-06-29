<script lang="ts">
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Eye } from 'lucide-svelte';
	import { MAX_VERBOSE_FIELDS } from '$lib/core/recordDisplay.js';

	/** One labelled group of selectable items in the menu (e.g. "File info" vs "Fields"). */
	export interface VerboseFieldGroup {
		label: string;
		options: { key: string; label: string }[];
	}

	/**
	 * The shared **Show** toolbar control for the verbose grid (Item 8), used by both the Files hub and
	 * the Records Explorer so the two sides don't fork. A single Popover holds a master **Show on tiles**
	 * toggle plus one or more **labelled groups** of capped, scrollable checkboxes — the host decides the
	 * groups, e.g. Files passes a **File info** group (intrinsic blob keys) and a **Fields** group (class
	 * schema), while Records passes just a fields group. A divider + header is drawn per group **only when
	 * there is more than one** (a lone group renders as a flat list, no redundant header). The list
	 * scrolls (`max-h` + `overflow-y-auto`) so a long schema never overflows. Selecting past {@link max}
	 * (counted across **all** groups) disables the remaining unchecked boxes. Every change flows back
	 * through bindings and fires {@link onchange} so the host can persist (durable per-entity) and reload.
	 *
	 * @param verbose - Bindable: whether the rows are shown. Toggling fires `onchange`.
	 * @param selected - Bindable: the chosen keys across all groups, in selection order (opaque to the
	 *   menu — the host namespaces e.g. `file:size` vs a schema key and resolves them on its side).
	 * @param groups - The labelled option groups to show (host-built, view-scoped).
	 * @param max - Selection cap across all groups (defaults to {@link MAX_VERBOSE_FIELDS}).
	 * @param onchange - Called after any toggle/selection change, for the host to persist + reload.
	 * @param disabled - Disable the whole control (e.g. no selectable items at all).
	 */
	let {
		verbose = $bindable(false),
		selected = $bindable<string[]>([]),
		groups,
		max = MAX_VERBOSE_FIELDS,
		onchange,
		disabled = false
	}: {
		verbose?: boolean;
		selected?: string[];
		groups: VerboseFieldGroup[];
		max?: number;
		onchange?: () => void;
		disabled?: boolean;
	} = $props();

	/** Groups with at least one option (empty groups don't draw a header). */
	const shownGroups = $derived(groups.filter((g) => g.options.length > 0));
	const totalOptions = $derived(shownGroups.reduce((n, g) => n + g.options.length, 0));
	const atCap = $derived(selected.length >= max);

	/** Toggle a key in/out of the selection (preserving order), respecting the cap, then notify. */
	function toggleField(key: string, checked: boolean) {
		if (checked) {
			if (selected.includes(key) || selected.length >= max) return;
			// Picking the first item from an empty selection implies you want to see it — auto-enable the
			// master toggle so the rows actually appear (otherwise a fresh check shows nothing).
			if (selected.length === 0) verbose = true;
			selected = [...selected, key];
		} else {
			selected = selected.filter((k) => k !== key);
		}
		onchange?.();
	}

	function toggleVerbose(checked: boolean) {
		verbose = checked;
		onchange?.();
	}
</script>

<Tooltip.Provider delayDuration={400}>
	<Tooltip.Root>
		<Popover.Root>
			<Tooltip.Trigger>
				{#snippet child({ props: tipProps })}
					<Popover.Trigger {...tipProps}>
						{#snippet child({ props })}
							<Button
								{...props}
								variant={verbose ? 'secondary' : 'outline'}
								size="sm"
								class="h-8 gap-1.5"
								{disabled}
							>
								<Eye class="size-4" />
								Show
								{#if verbose && selected.length}
									<span class="rounded bg-background/70 px-1 text-[10px] tabular-nums"
										>{selected.length}</span
									>
								{/if}
							</Button>
						{/snippet}
					</Popover.Trigger>
				{/snippet}
			</Tooltip.Trigger>
			<Popover.Content class="w-56 p-0" align="start">
				<div class="flex items-center gap-2 border-b p-2.5">
					<Checkbox
						id="verbose-toggle"
						checked={verbose}
						onCheckedChange={(v) => toggleVerbose(v === true)}
					/>
					<Label for="verbose-toggle" class="text-sm font-medium">Show on tiles</Label>
				</div>
				{#if totalOptions === 0}
					<p class="p-3 text-xs text-muted-foreground">Nothing to show.</p>
				{:else}
					<div class="max-h-72 overflow-y-auto py-1">
						{#each shownGroups as group (group.label)}
							{#if shownGroups.length > 1}
								<p
									class="px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
								>
									{group.label}
								</p>
							{/if}
							<div class="px-1.5 pb-1">
								{#each group.options as opt (opt.key)}
									{@const checked = selected.includes(opt.key)}
									<div class="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-muted/60">
										<Checkbox
											id="vf-{opt.key}"
											{checked}
											disabled={!checked && atCap}
											onCheckedChange={(v) => toggleField(opt.key, v === true)}
										/>
										<Label
											for="vf-{opt.key}"
											class="flex-1 truncate text-sm font-normal {!checked && atCap
												? 'text-muted-foreground'
												: ''}"
											title={opt.label}
										>
											{opt.label}
										</Label>
									</div>
								{/each}
							</div>
						{/each}
					</div>
					<p class="border-t px-2.5 py-1.5 text-[11px] text-muted-foreground">
						{selected.length} / {max} selected
					</p>
				{/if}
			</Popover.Content>
		</Popover.Root>
		<Tooltip.Content side="bottom" class="max-w-56 text-center">
			Choose what each tile shows — file info (size, type, dimensions…) and the entity's fields.
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
