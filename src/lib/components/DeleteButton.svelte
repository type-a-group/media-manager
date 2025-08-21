<script lang="ts">
    import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Trash } from 'lucide-svelte';

	let { title, description, onDelete } = $props<{ title: string, description: string, onDelete: () => void }>();
</script>

<AlertDialog.Root>
	<AlertDialog.Trigger>
		<Button variant="outline" size="icon">
			<Trash />
		</Button>
	</AlertDialog.Trigger>
	<AlertDialog.Content>
		<AlertDialog.Title>{title}</AlertDialog.Title>
		<AlertDialog.Description>
			{description}
		</AlertDialog.Description>
        <div class="flex justify-end">
            <form onsubmit={onDelete}>
                <AlertDialog.Cancel type="button">Cancel</AlertDialog.Cancel>
                <AlertDialog.Action type="submit">Delete</AlertDialog.Action>
            </form>
		</div>
	</AlertDialog.Content>
</AlertDialog.Root>