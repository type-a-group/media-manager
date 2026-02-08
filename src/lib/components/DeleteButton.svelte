<script lang="ts">
    import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { buttonVariants } from '$lib/components/ui/button';
	import { Trash } from 'lucide-svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	let { title, description, onDelete, actionText = 'Delete', tooltip }: {
		title: string;
		description: string;
		onDelete: () => void;
		actionText?: string;
		tooltip?: string;
	} = $props();
</script>

<AlertDialog.Root>
	<Tooltip.Root>
		<Tooltip.Trigger>
			<AlertDialog.Trigger
				class={buttonVariants({ variant: 'outline', size: 'icon' })}
				title={tooltip ?? title}
				aria-label={tooltip ?? title}
			>
				<Trash />
			</AlertDialog.Trigger>
		</Tooltip.Trigger>
		<Tooltip.Content side="top" sideOffset={6}>
			{tooltip ?? title}
		</Tooltip.Content>
	</Tooltip.Root>
	<AlertDialog.Content>
		<AlertDialog.Title>{title}</AlertDialog.Title>
		<AlertDialog.Description>
			{description}
		</AlertDialog.Description>
        <div class="flex justify-end">
            <form onsubmit={onDelete}>
                <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
                <AlertDialog.Action type="submit">{actionText}</AlertDialog.Action>
            </form>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>