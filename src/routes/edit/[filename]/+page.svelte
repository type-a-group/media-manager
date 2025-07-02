<script lang="ts">
	import ImageForm from '$lib/components/ImageForm.svelte';
	import { page } from '$app/stores';

	let filename = $derived($page.params.filename);
</script>

<ImageForm {filename} /> 