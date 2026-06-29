<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { toast } from 'svelte-sonner';
	import { Download, Upload } from 'lucide-svelte';
	import type { GlobalsFieldSort } from '$lib/core/globalsLayout.js';

	type SectionOption = { id: string; name: string };

	/**
	 * The thin Globals settings popup. With field-type selection in the per-field `⋮` menu and sections
	 * managed inline, the gear is intentionally small: render-time field sort, the default section new
	 * fields land in, and whole-record JSON export/import (genuinely useful for a config store).
	 * Everything it touches lives in the record / `__layout` — no `settings.json` involvement.
	 */
	let {
		open = $bindable(),
		fieldSort,
		defaultSectionId,
		sections,
		exportText,
		onFieldSortChange,
		onDefaultSectionChange,
		onImport
	}: {
		open: boolean;
		fieldSort: GlobalsFieldSort;
		defaultSectionId: string;
		sections: SectionOption[];
		exportText: string;
		onFieldSortChange: (sort: GlobalsFieldSort) => void;
		onDefaultSectionChange: (id: string) => void;
		onImport: (parsed: Record<string, unknown>) => void;
	} = $props();

	let importText = $state('');

	function download() {
		const blob = new Blob([exportText], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = 'globals.json';
		a.click();
		URL.revokeObjectURL(url);
	}

	function applyImport() {
		const text = importText.trim();
		if (!text) return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			toast.error('Not valid JSON');
			return;
		}
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			toast.error('Expected a JSON object');
			return;
		}
		onImport(parsed as Record<string, unknown>);
		importText = '';
		open = false;
		toast.success('Imported globals');
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Globals settings</Dialog.Title>
			<Dialog.Description>Display and import/export for the globals record.</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 py-2">
			<!-- Field sort -->
			<div class="space-y-1.5">
				<Label class="text-sm">Field order within sections</Label>
				<Select.Root
					type="single"
					value={fieldSort}
					onValueChange={(v) => v && onFieldSortChange(v as GlobalsFieldSort)}
				>
					<Select.Trigger class="w-full">
						{fieldSort === 'alpha' ? 'A → Z (alphabetical)' : 'Manual (drag to order)'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="manual">Manual (drag to order)</Select.Item>
						<Select.Item value="alpha">A → Z (alphabetical)</Select.Item>
					</Select.Content>
				</Select.Root>
			</div>

			<!-- Default section for new fields -->
			<div class="space-y-1.5">
				<Label class="text-sm">Default section for new fields</Label>
				<Select.Root
					type="single"
					value={defaultSectionId}
					onValueChange={(v) => v && onDefaultSectionChange(v)}
				>
					<Select.Trigger class="w-full">
						{sections.find((s) => s.id === defaultSectionId)?.name ?? 'Select…'}
					</Select.Trigger>
					<Select.Content>
						{#each sections as s (s.id)}
							<Select.Item value={s.id}>{s.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<Separator />

			<!-- Export / import -->
			<div class="space-y-1.5">
				<Label class="text-sm">Export / import (JSON)</Label>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={download}>
						<Download class="mr-1 size-4" /> Download
					</Button>
				</div>
				<textarea
					rows="5"
					placeholder="Paste a globals JSON object here to import…"
					bind:value={importText}
					class="flex w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				></textarea>
				<div class="flex justify-end">
					<Button size="sm" disabled={!importText.trim()} onclick={applyImport}>
						<Upload class="mr-1 size-4" /> Import
					</Button>
				</div>
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
