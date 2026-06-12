import path from 'node:path';
import { z } from 'zod';

import { getGlobalFilesDir } from './paths.js';
import { readJsonFile, writeJsonFileAtomic } from './json.js';
import { withFileLock } from './lock.js';
import { newFileId, type FileId } from '$lib/core/ids.js';

/**
 * Global blob manifest: the single registry that gives every binary in the shared global `files/`
 * store a stable, workspace-scoped identity (`file_id`).
 *
 * Why this module exists:
 * - Before the manifest, the **filename** was the cross-catalog primary key for blobs, so the same
 *   physical file referenced by N media types was glued together only by equal strings. Rename was an
 *   O(#types) string-rewrite fan-out (`propagateFilenameRename`) and unlinked files had no real
 *   identity. The manifest replaces that: each blob has one `file_id`; the human-readable name lives in
 *   exactly one place (the manifest entry, mirrored by the on-disk filename), so rename is O(1).
 *
 * On-disk shape (`<root>/files/manifest.json`):
 *   `{ version: 1, files: { "<file_id>": { file_name, size?, created_at? } } }`
 *
 * Single point of failure + lock-ordering rule:
 * - This file is now load-bearing for every file-backed catalog. All mutations are atomic
 *   ({@link writeJsonFileAtomic}) under a single `.lock` (coarse, single-node — same model as the rest
 *   of the storage layer). When an operation needs **both** the manifest lock and a catalog data lock,
 *   it must take the **manifest lock first** to avoid deadlock. (In practice callers take the locks
 *   sequentially, not nested.)
 *
 * Concerns / future improvements:
 * - `mintFileId` / `reconcile` are idempotent **by name**, which is valid only while the disk enforces
 *   unique human-readable names (the current "name-on-disk" model). A future content-addressed store
 *   would break that assumption and should key the manifest differently.
 */

/** One blob's manifest entry. `file_name` is the canonical display name; `size`/`created_at` are best-effort. */
export const ManifestEntrySchema = z.object({
	file_name: z.string().min(1),
	size: z.number().optional(),
	created_at: z.string().optional()
});
export type ManifestEntry = z.infer<typeof ManifestEntrySchema>;

/** The whole manifest document. */
export const ManifestSchema = z.object({
	version: z.literal(1).default(1),
	files: z.record(ManifestEntrySchema).default({})
});
export type Manifest = z.infer<typeof ManifestSchema>;

/** Absolute path to the manifest file (`<root>/files/manifest.json`). */
export function getManifestPath(): string {
	return path.join(getGlobalFilesDir(), 'manifest.json');
}

/** Lock path guarding all manifest mutations. */
function manifestLockPath(): string {
	return `${getManifestPath()}.lock`;
}

/**
 * Read and validate the manifest. Returns an empty manifest (in memory, **not** written) when the file
 * does not exist yet, so reads are side-effect free.
 *
 * @returns The parsed manifest.
 */
export async function readManifest(): Promise<Manifest> {
	try {
		const raw = await readJsonFile(getManifestPath());
		return ManifestSchema.parse(raw);
	} catch (err) {
		const e = err as NodeJS.ErrnoException;
		if (e.code === 'ENOENT') return { version: 1, files: {} };
		throw err;
	}
}

/**
 * Resolve a `file_id` to its current filename.
 *
 * @param fileId - Blob identity.
 * @param manifest - Optional already-read manifest to avoid a re-read.
 * @returns The filename, or null if the id is unknown.
 */
export async function getFilenameForFileId(
	fileId: string,
	manifest?: Manifest
): Promise<string | null> {
	const m = manifest ?? (await readManifest());
	return m.files[fileId]?.file_name ?? null;
}

/**
 * Reverse lookup: the `file_id` currently mapped to a filename (first match), or null.
 *
 * @param fileName - Basename in the global store.
 * @param manifest - Optional already-read manifest to avoid a re-read.
 */
export async function getFileIdForFilename(
	fileName: string,
	manifest?: Manifest
): Promise<string | null> {
	const m = manifest ?? (await readManifest());
	for (const [id, entry] of Object.entries(m.files)) {
		if (entry.file_name === fileName) return id;
	}
	return null;
}

/** Find the id mapped to a name within an already-loaded manifest (sync helper). */
function findIdByName(manifest: Manifest, fileName: string): string | null {
	for (const [id, entry] of Object.entries(manifest.files)) {
		if (entry.file_name === fileName) return id;
	}
	return null;
}

/**
 * Get (or create) the `file_id` for a filename. **Idempotent by name**: if an entry already maps the
 * name, its existing id is returned unchanged; otherwise a new id is minted and inserted.
 *
 * @param fileName - Basename of a blob in the global store.
 * @param size - Optional byte size to record.
 * @returns The stable `file_id` for that blob.
 */
export async function mintFileId(fileName: string, size?: number): Promise<FileId> {
	return await withFileLock(manifestLockPath(), async () => {
		const manifest = await readManifest();
		const existing = findIdByName(manifest, fileName);
		if (existing) return existing as FileId;
		const id = newFileId();
		manifest.files[id] = {
			file_name: fileName,
			...(size != null ? { size } : {}),
			created_at: new Date().toISOString()
		};
		await writeJsonFileAtomic(getManifestPath(), manifest);
		return id;
	});
}

/**
 * Update only the `file_name` of an existing manifest entry (the O(1) rename primitive). The blob on
 * disk must be renamed separately by the caller; this records the new name in the registry.
 *
 * @param fileId - Blob identity (must exist).
 * @param newName - New basename.
 * @throws If the id is unknown.
 */
export async function renameFileId(fileId: string, newName: string): Promise<void> {
	await withFileLock(manifestLockPath(), async () => {
		const manifest = await readManifest();
		const entry = manifest.files[fileId];
		if (!entry) throw new Error(`Unknown file_id: ${fileId}`);
		manifest.files[fileId] = { ...entry, file_name: newName };
		await writeJsonFileAtomic(getManifestPath(), manifest);
	});
}

/**
 * Remove a manifest entry entirely (used only when a blob is deleted from disk).
 *
 * @param fileId - Blob identity.
 */
export async function removeFileId(fileId: string): Promise<void> {
	await withFileLock(manifestLockPath(), async () => {
		const manifest = await readManifest();
		if (!(fileId in manifest.files)) return;
		delete manifest.files[fileId];
		await writeJsonFileAtomic(getManifestPath(), manifest);
	});
}

/** Result of {@link reconcile}: what changed, plus the up-to-date manifest. */
export interface ReconcileResult {
	/** Blobs newly seen on disk that were minted a `file_id`. */
	added: { file_id: string; file_name: string }[];
	/** Manifest entries whose blob is no longer on disk (flagged, **not** removed). */
	missing: { file_id: string; file_name: string }[];
	/** The manifest after reconciliation. */
	manifest: Manifest;
}

/**
 * Reconcile the manifest against the set of blob filenames currently on disk, in a **single** locked
 * critical section. New disk files are minted ids; entries whose blob has vanished are reported but
 * **kept** (so missing-file rows still resolve a human name) — only an explicit disk delete removes an
 * entry. The manifest is written only when something was added.
 *
 * This is the lazy-heal primitive every list call runs first.
 *
 * @param diskNames - Basenames of real blobs currently in the global store (excluding `manifest.json`,
 *   `settings.json`, `*.lock`, and dotfiles).
 * @returns What was added/missing and the reconciled manifest.
 */
export async function reconcile(diskNames: string[]): Promise<ReconcileResult> {
	return await withFileLock(manifestLockPath(), async () => {
		const manifest = await readManifest();
		const diskSet = new Set(diskNames);

		const knownNames = new Set(Object.values(manifest.files).map((e) => e.file_name));
		const added: { file_id: string; file_name: string }[] = [];
		for (const name of diskNames) {
			if (knownNames.has(name)) continue;
			const id = newFileId();
			manifest.files[id] = { file_name: name, created_at: new Date().toISOString() };
			knownNames.add(name);
			added.push({ file_id: id, file_name: name });
		}

		const missing: { file_id: string; file_name: string }[] = [];
		for (const [id, entry] of Object.entries(manifest.files)) {
			if (!diskSet.has(entry.file_name)) missing.push({ file_id: id, file_name: entry.file_name });
		}

		if (added.length > 0) await writeJsonFileAtomic(getManifestPath(), manifest);
		return { added, missing, manifest };
	});
}
