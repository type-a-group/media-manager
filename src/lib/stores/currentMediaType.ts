import { writable } from 'svelte/store';

/**
 * Current media type when viewing /media/[typeId].
 * Set by the editor page; read by sidebar and editor pane.
 */
export interface CurrentMediaType {
	typeId: string;
	kind: 'images' | 'json' | 'generic' | 'blob_store';
	displayName?: string;
}

export const currentMediaTypeStore = writable<CurrentMediaType | null>(null);
