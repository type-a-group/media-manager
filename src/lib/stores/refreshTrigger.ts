import { writable } from 'svelte/store';
import { browser } from '$app/environment';

/**
 * Trigger for refreshing the record/file lists. Increment (via {@link triggerImageListRefresh}) after
 * operations that change what a list renders — a blob/record rename, a delete, a title-by edit, a bulk
 * op. Consumers: the Records hub (`/media`), the Files hub (`/files`), the Globals editor, and the
 * file/record pickers each subscribe and do a *quiet* refetch so referenced/server-resolved values
 * (filenames, titles, `_missing_*` badges) stay current.
 */
export const refreshTrigger = writable(0);

/**
 * Trigger for refreshing the schema (e.g. after schema-editor changes). The record hub subscribes to
 * refetch the schema and record list. Within a tab, schema edits also propagate via the settings
 * dialog's direct callback; this store is the **cross-tab** path (see the BroadcastChannel bridge).
 */
export const schemaRefreshTrigger = writable(0);

/**
 * Cross-tab transport. The sub-app routes (`/files`, `/media`, `/globals`) are mutually-exclusive
 * full-page chrome, so a producer and a consumer are rarely co-mounted in the SAME tab — the real
 * cross-app staleness scenario is two open tabs showing overlapping data. A `BroadcastChannel` mirrors
 * each bump to every other tab in the origin; the receiver bumps its local store **without** re-posting,
 * so there is no echo loop. Degrades to in-memory-only (single-tab) where `BroadcastChannel` is absent.
 */
const channel =
	browser && typeof BroadcastChannel !== 'undefined'
		? new BroadcastChannel('media-manager-refresh')
		: null;

if (channel) {
	channel.onmessage = (e: MessageEvent) => {
		if (e.data === 'list') refreshTrigger.update((n) => n + 1);
		else if (e.data === 'schema') schemaRefreshTrigger.update((n) => n + 1);
	};
}

/**
 * Call to trigger a refresh of the record/file lists in this tab and every other tab on the origin.
 */
export function triggerImageListRefresh(): void {
	refreshTrigger.update((n) => n + 1);
	channel?.postMessage('list');
}

/**
 * Call to trigger a refresh of the schema in the record hub (this tab and every other tab on the origin).
 */
export function triggerSchemaRefresh(): void {
	schemaRefreshTrigger.update((n) => n + 1);
	channel?.postMessage('schema');
}
