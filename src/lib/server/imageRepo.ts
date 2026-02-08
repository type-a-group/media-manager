import { createImageRepo, createMediaTypeRepo } from '$lib/storage/repo.js';
import type { ImageRepo } from '$lib/storage/repo.js';
import type { JsonRepo } from '$lib/storage/jsonRepo.js';

/**
 * Safe typeId: only alphanumeric, hyphen, underscore (no path traversal).
 */
const TYPE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate typeId and return it, or throw.
 */
export function validateTypeId(typeId: string): string {
	if (!typeId || !TYPE_ID_REGEX.test(typeId)) {
		throw new Error('Invalid media type id');
	}
	return typeId;
}

/**
 * Singleton image repository instance for SvelteKit server routes (legacy single-folder).
 *
 * Use case:
 * - Avoid re-creating repository helpers for every request.
 *
 * Concerns / future improvements:
 * - If we later add configurable roots, this should be created from env/config per deployment.
 */
export const imageRepo = createImageRepo();

/**
 * Get a repo for a media type by typeId (folder name under root).
 * Validates typeId and returns ImageRepo or JsonRepo depending on kind.
 */
export function getMediaTypeRepo(typeId: string): ImageRepo | JsonRepo {
	const safe = validateTypeId(typeId);
	return createMediaTypeRepo(safe);
}

