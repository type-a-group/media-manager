import { writable } from 'svelte/store';

/**
 * Trigger for refreshing the image list in the sidebar.
 * Increment this after operations that change the list (delete, upload, etc.).
 */
export const refreshTrigger = writable(0);

/**
 * Trigger for refreshing the schema (e.g. after schema editor changes).
 * ImageEditorPane subscribes to this to refetch schema and properties.
 */
export const schemaRefreshTrigger = writable(0);

/**
 * Call to trigger a refresh of the image list.
 */
export function triggerImageListRefresh(): void {
	refreshTrigger.update((n) => n + 1);
}

/**
 * Call to trigger a refresh of the schema in ImageEditorPane and other consumers.
 */
export function triggerSchemaRefresh(): void {
	schemaRefreshTrigger.update((n) => n + 1);
}
