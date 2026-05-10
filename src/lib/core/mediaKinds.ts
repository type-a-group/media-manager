/**
 * Client- and server-safe helpers for media type `kind` values (see `settingsFile.ts`).
 * Kept separate from storage modules that import Node built-ins.
 */

/**
 * Whether the UI should treat this kind like a browse-first file group (no sidebar schema editor,
 * uploads may be any file type, same as legacy `generic`).
 *
 * @param kind - Current media type kind from the API or store
 */
export function isBrowseFirstFileKind(kind: string | undefined | null): boolean {
	return kind === 'generic' || kind === 'blob_store';
}
