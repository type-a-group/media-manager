<script lang="ts">
	import { DateField } from 'bits-ui';
	import { parseDate, type DateValue } from '@internationalized/date';
	import { onMount } from 'svelte';
	import { Calendar } from '$lib/components/ui/calendar/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
	import { Calendar as CalendarIcon, X } from 'lucide-svelte';
	import { isValidIsoDate, isoToday } from '$lib/core/dates.js';
	import { cn } from '$lib/utils.js';

	/**
	 * The single date input control for `date` schema fields — a segmented `DD / MM / YYYY` field you
	 * can type into, plus a calendar-icon button opening a month-grid popover. Wraps the bits-ui
	 * {@link DateField} (segmented entry) and the shadcn {@link Calendar} (popover) and keeps them in
	 * sync through one derived {@link DateValue}.
	 *
	 * The bound `value` is the on-disk shape for a `date` field: a date-only ISO string `YYYY-MM-DD`,
	 * or `''` when empty. We treat the ISO string as the source of truth — the inner `DateValue` is
	 * derived from it and edits are serialized straight back, so there is exactly one canonical value
	 * and no two-way-binding loop. The segment order follows the **browser locale** (resolved on mount;
	 * SSR falls back to `en`), while the *displayed* value elsewhere stays a deterministic medium form.
	 *
	 * @param value - The current ISO date string (`YYYY-MM-DD`) or `''`. Invalid input renders empty.
	 * @param onValueChange - Called with the new ISO string (`''` when cleared) on every edit.
	 * @param id - Optional id applied to the field wrapper (for an external `<Label for>`).
	 * @param disabled - Disable the whole control.
	 */
	let {
		value = '',
		onValueChange,
		id,
		disabled = false
	}: {
		value?: string;
		onValueChange?: (value: string) => void;
		id?: string;
		disabled?: boolean;
	} = $props();

	/** The inner calendar value, derived from the ISO string (the source of truth). */
	const dateValue = $derived<DateValue | undefined>(
		isValidIsoDate(value) ? parseDate(value) : undefined
	);

	/** Serialize a calendar value back to the stored ISO string (empty when cleared). */
	function emit(v: DateValue | undefined) {
		onValueChange?.(v ? v.toString() : '');
	}

	/** Calendar popover open state. */
	let open = $state(false);

	/**
	 * The locale that drives segment order (e.g. day-first vs month-first). Resolved from the browser
	 * on mount; defaults to `en` so SSR is stable and there is no hydration mismatch.
	 */
	let locale = $state('en');
	onMount(() => {
		if (typeof navigator !== 'undefined' && navigator.language) locale = navigator.language;
	});

	/** The calendar opens on the selected date, else today's month (without selecting it). */
	const placeholder = $derived<DateValue>(dateValue ?? parseDate(isoToday()));
</script>

<div class="flex w-full flex-col gap-1">
	<DateField.Root value={dateValue} onValueChange={emit} {locale} {disabled} granularity="day">
		<DateField.Input
			{id}
			class={cn(
				'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
				disabled && 'cursor-not-allowed opacity-50'
			)}
		>
			{#snippet children({ segments })}
				<!-- Key by index: the `literal` part (the `/` separators) repeats, so `part` is not unique. -->
				{#each segments as { part, value: segValue }, i (i)}
					<DateField.Segment
						{part}
						class={cn(
							'rounded px-0.5 tabular-nums focus:outline-none focus:bg-primary focus:text-primary-foreground',
							part === 'literal'
								? 'text-muted-foreground px-px'
								: 'data-[placeholder]:text-muted-foreground'
						)}
					>
						{segValue}
					</DateField.Segment>
				{/each}

				<!-- Clear + calendar trigger, pushed to the right edge of the field. -->
				<div class="ml-auto flex items-center gap-0.5 pl-1">
					{#if value && !disabled}
						<button
							type="button"
							class="grid size-6 place-items-center rounded text-muted-foreground hover:text-destructive"
							onclick={() => emit(undefined)}
							aria-label="Clear date"
						>
							<X class="size-4" />
						</button>
					{/if}
					<Popover.Root bind:open>
						<Popover.Trigger
							{disabled}
							class={cn(
								buttonVariants({ variant: 'ghost', size: 'icon' }),
								'size-7 text-muted-foreground'
							)}
							aria-label="Open calendar"
						>
							<CalendarIcon class="size-4" />
						</Popover.Trigger>
						<Popover.Content class="w-auto p-0" align="end">
							<Calendar
								type="single"
								value={dateValue as never}
								{placeholder}
								{locale}
								captionLayout="dropdown"
								onValueChange={(v: DateValue | undefined) => {
									emit(v);
									open = false;
								}}
							/>
						</Popover.Content>
					</Popover.Root>
				</div>
			{/snippet}
		</DateField.Input>
	</DateField.Root>
</div>
