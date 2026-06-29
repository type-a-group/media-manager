import { createJsonRepoForType, type JsonRepo } from '$lib/storage/jsonRepo.js';
import { getMediaTypePaths } from '$lib/storage/paths.js';

/** Safe typeId / class id: only alphanumeric, hyphen, underscore (no path traversal). */
const TYPE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/** Validate a typeId / class id and return it, or throw. */
export function validateTypeId(typeId: string): string {
	if (!typeId || !TYPE_ID_REGEX.test(typeId)) {
		throw new Error('Invalid media type id');
	}
	return typeId;
}

/**
 * Get the repo for a top-level (`json`) media type by typeId. After the file-first redesign all
 * top-level media types are `json` (file-backed catalogs are now classes under `media/classes/`,
 * served by `classRepo`), so this always returns a {@link JsonRepo}.
 */
export function getMediaTypeRepo(typeId: string): JsonRepo {
	const safe = validateTypeId(typeId);
	const paths = getMediaTypePaths(safe);
	if (paths.kind !== 'json') throw new Error(`Not a valid media-type folder: ${typeId}`);
	return createJsonRepoForType(safe);
}
