<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import SchemaEditorBody from '$lib/components/schema-editor/SchemaEditorBody.svelte';
	import IconPicker from '$lib/components/IconPicker.svelte';
	import { Check, Loader2 } from 'lucide-svelte';
	import { toast } from 'svelte-sonner';
	import { debouncedAutosave } from '$lib/actions/debouncedAutosave.svelte.js';
	import type { IconId } from '$lib/core/icons.js';
	import type { EntitySettingsAdapter, EntityGeneralConfig } from './types.js';

	/**
	 * The single, shared **entity settings** popup used by both the Files class sidebar and the Records
	 * type rail. One tabbed dialog combining **rename** + **title-by** (+ **group-by** for Files) on a
	 * General tab, the shared schema editor on a Fields tab, and **delete** on a Danger tab. All data
	 * access is injected via {@link EntitySettingsAdapter}; the dialog itself is side-agnostic.
	 *
	 * Title is always `{name} — settings` with a scope subtitle so it can't be confused with the global
	 * **App settings** (footer gear). Reached from the row ⋮ menu and the content-header ⋮.
	 *
	 * @param adapter - Data layer (load/save general config, schema adapter, delete).
	 * @param name - Current display name (for the title; the General tab can rename it).
	 * @param open - Bindable dialog open state.
	 * @param onchanged - Called after a (debounced) autosave / schema mutation (host refreshes
	 *   names/counts/list). The General tab has no Save button — edits persist on a ~600ms debounce and
	 *   on close, mirroring the editor-panel autosave policy ({@link debouncedAutosave}).
	 * @param ondeleted - Called after the entity is deleted (host clears selection + reloads).
	 */
	let {
		adapter,
		name,
		open = $bindable(false),
		onchanged,
		ondeleted
	}: {
		adapter: EntitySettingsAdapter;
		name: string;
		open?: boolean;
		onchanged?: () => void;
		ondeleted?: () => void;
	} = $props();

	type Tab = 'general' | 'fields' | 'danger';
	let tab = $state<Tab>('general');

	let loading = $state(false);
	let saving = $state(false);
	let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let deleting = $state(false);
	let confirmDeleteOpen = $state(false);

	let displayName = $state('');
	let icon = $state('');
	let titleBy = $state('');
	let subtitleBy = $state('');
	let groupBy = $state('');
	let fields = $state<{ key: string; label: string }[]>([]);

	/** JSON snapshot of the last persisted General-tab values (the autosave baseline). */
	let savedSnapshot = $state('');

	/** Live JSON snapshot of the General-tab form (name trimmed so trailing space isn't "dirty"). */
	const snapshot = $derived(
		JSON.stringify({ displayName: displayName.trim(), icon, titleBy, subtitleBy, groupBy })
	);

	// Dirty only when loaded, the name is non-empty (we never autosave a blank name), and the snapshot
	// has drifted from the last save. This is the sole signal driving the debounced autosave.
	const isDirty = $derived(!loading && displayName.trim() !== '' && snapshot !== savedSnapshot);

	const autosave = debouncedAutosave({ isDirty: () => isDirty, save: saveGeneral });

	const titleByLabel = $derived(
		titleBy ? (fields.find((f) => f.key === titleBy)?.label ?? titleBy) : 'Default'
	);
	const subtitleByLabel = $derived(
		subtitleBy ? (fields.find((f) => f.key === subtitleBy)?.label ?? subtitleBy) : 'None'
	);
	const groupByLabel = $derived(
		groupBy ? (fields.find((f) => f.key === groupBy)?.label ?? groupBy) : 'None'
	);

	/** Generic glyph for this entity kind when no icon is set (classes ⇒ tag, record types ⇒ doc). */
	const fallbackIcon: IconId = $derived(adapter.noun === 'class' ? 'tag' : 'file-text');

	async function load() {
		loading = true;
		saveStatus = 'idle';
		try {
			const cfg: EntityGeneralConfig = await adapter.load();
			displayName = cfg.displayName;
			icon = cfg.icon;
			titleBy = cfg.titleBy;
			subtitleBy = cfg.subtitleBy;
			groupBy = cfg.groupBy;
			fields = cfg.fields;
			savedSnapshot = snapshot;
		} catch (e) {
			console.error(e);
			toast.error(`Failed to load ${adapter.noun} settings`);
		} finally {
			loading = false;
		}
	}

	// (Re)load whenever the dialog opens (reset to the General tab); flush any pending edit on close so
	// nothing is lost if the user closes inside the debounce window.
	$effect(() => {
		if (open) {
			tab = 'general';
			load();
		} else {
			void autosave.flush();
		}
	});

	/** Persist the General tab if dirty. Called by the debounced autosave and on close. */
	async function saveGeneral() {
		const trimmed = displayName.trim();
		// Never autosave a blank name; the snapshot is already up to date when nothing changed.
		if (loading || saving || !trimmed || snapshot === savedSnapshot) return;
		const committed = snapshot;
		saving = true;
		saveStatus = 'saving';
		try {
			await adapter.save({ displayName: trimmed, icon, titleBy, subtitleBy, groupBy });
			savedSnapshot = committed;
			saveStatus = 'saved';
			onchanged?.();
		} catch (e) {
			console.error(e);
			saveStatus = 'error';
			toast.error('Failed to save settings');
		} finally {
			saving = false;
		}
	}

	async function doDelete() {
		deleting = true;
		try {
			await adapter.remove();
			// Drop any pending autosave and mark clean so closing doesn't flush a write to the deleted entity.
			autosave.cancel();
			savedSnapshot = snapshot;
			toast.success(`Deleted ${adapter.noun} “${name}”`);
			confirmDeleteOpen = false;
			open = false;
			ondeleted?.();
		} catch (e) {
			console.error(e);
			toast.error(`Failed to delete ${adapter.noun}`);
		} finally {
			deleting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="flex max-h-[90vh] max-w-2xl flex-col">
		<Dialog.Title>{name} — settings</Dialog.Title>
		<Dialog.Description>
			Settings for this {adapter.noun} — global preferences live in <strong>App settings</strong>.
		</Dialog.Description>

		<!-- Tab strip (no shadcn `tabs` primitive in this project; Buttons are the navigation control). -->
		<div class="flex gap-1 border-b">
			<Button
				variant="ghost"
				size="sm"
				class="rounded-none border-b-2 {tab === 'general'
					? 'border-primary'
					: 'border-transparent text-muted-foreground'}"
				onclick={() => (tab = 'general')}
			>
				General
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="rounded-none border-b-2 {tab === 'fields'
					? 'border-primary'
					: 'border-transparent text-muted-foreground'}"
				onclick={() => (tab = 'fields')}
			>
				Fields
			</Button>
			<Button
				variant="ghost"
				size="sm"
				class="rounded-none border-b-2 {tab === 'danger'
					? 'border-primary'
					: 'border-transparent text-muted-foreground'}"
				onclick={() => (tab = 'danger')}
			>
				Danger
			</Button>
		</div>

		<div class="min-h-0 flex-1 overflow-y-auto py-2">
			{#if loading}
				<p class="py-4 italic text-muted-foreground">Loading…</p>
			{:else if tab === 'general'}
				<div class="flex flex-col gap-4 py-2">
					<div class="flex items-end gap-3">
						<div class="flex flex-col gap-2">
							<Label>Icon</Label>
							<IconPicker
								value={icon}
								fallback={fallbackIcon}
								onSelect={(id) => (icon = id ?? '')}
								label="Choose {adapter.noun} icon"
							/>
						</div>
						<div class="flex flex-1 flex-col gap-2">
							<Label for="entity-display-name">Display name</Label>
							<Input id="entity-display-name" bind:value={displayName} placeholder="Name" />
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label>Title rows by</Label>
						<Select.Root type="single" value={titleBy} onValueChange={(v) => (titleBy = v ?? '')}>
							<Select.Trigger>{titleByLabel}</Select.Trigger>
							<Select.Content>
								<Select.Item value="">Default</Select.Item>
								{#each fields as f (f.key)}
									<Select.Item value={f.key}>{f.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-xs text-muted-foreground">
							Which field labels each row in the list. Persisted.
						</p>
					</div>

					{#if adapter.hasSubtitle}
						<div class="flex flex-col gap-2">
							<Label>Subtitle (optional)</Label>
							<Select.Root
								type="single"
								value={subtitleBy}
								onValueChange={(v) => (subtitleBy = v ?? '')}
							>
								<Select.Trigger>{subtitleByLabel}</Select.Trigger>
								<Select.Content>
									<Select.Item value="">None</Select.Item>
									{#each fields as f (f.key)}
										<Select.Item value={f.key}>{f.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
							<p class="text-xs text-muted-foreground">
								A muted secondary line under each row. Choose “None” to hide it.
							</p>
						</div>
					{/if}

					{#if adapter.hasGroupBy}
						<div class="flex flex-col gap-2">
							<Label>Group by</Label>
							<Select.Root type="single" value={groupBy} onValueChange={(v) => (groupBy = v ?? '')}>
								<Select.Trigger>{groupByLabel}</Select.Trigger>
								<Select.Content>
									<Select.Item value="">None</Select.Item>
									{#each fields as f (f.key)}
										<Select.Item value={f.key}>{f.label}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					{/if}

					<div class="flex h-4 justify-end text-xs text-muted-foreground">
						{#if saveStatus === 'saving'}
							<span><Loader2 class="inline size-3 animate-spin" /> Saving…</span>
						{:else if saveStatus === 'saved' && !isDirty}
							<span><Check class="inline size-3 text-green-600" /> Saved</span>
						{:else if saveStatus === 'error'}
							<span class="text-destructive">Save failed</span>
						{/if}
					</div>
				</div>
			{:else if tab === 'fields'}
				{#key open}
					<SchemaEditorBody
						adapter={adapter.schema}
						recordNoun={adapter.recordNoun}
						onchanged={() => onchanged?.()}
					/>
				{/key}
			{:else}
				<div class="flex flex-col gap-3 py-2">
					<div
						class="flex items-center justify-between rounded-md border border-destructive/40 bg-destructive/5 p-3"
					>
						<span class="text-sm text-muted-foreground">
							Delete this {adapter.noun} and everything it stores. This cannot be undone.
						</span>
						<Button variant="destructive" size="sm" onclick={() => (confirmDeleteOpen = true)}>
							Delete…
						</Button>
					</div>
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={confirmDeleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Title>Delete {adapter.noun}</AlertDialog.Title>
		<AlertDialog.Description>
			Delete the {adapter.noun} “{name}”? This cannot be undone.
		</AlertDialog.Description>
		<div class="mt-4 flex justify-end gap-2">
			<AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
			<Button variant="destructive" type="button" disabled={deleting} onclick={doDelete}>
				Delete {adapter.noun}
			</Button>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>
