import { writable } from 'svelte/store';

/**
 * Trigger for refreshing the record list.
 * Increment this after operations that change the list (delete, create, etc.).
 */
export const refreshTrigger = writable(0);

/**
 * Trigger for refreshing the schema (e.g. after schema editor changes).
 * The record hub (`/media/[typeId]`) subscribes to this to refetch the schema and record list.
 */
export const schemaRefreshTrigger = writable(0);

/**
 * Call to trigger a refresh of the record list.
 */
export function triggerImageListRefresh(): void {
	refreshTrigger.update((n) => n + 1);
}

/**
 * Call to trigger a refresh of the schema in the record hub and other consumers.
 */
export function triggerSchemaRefresh(): void {
	schemaRefreshTrigger.update((n) => n + 1);
}
