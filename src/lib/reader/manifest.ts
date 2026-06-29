/**
 * Reader-side shape + parser for the blob manifest (`media/manifest.json`).
 *
 * The editor's authoritative manifest type lives in `src/lib/storage/manifest.ts`, but that module
 * is Node-only (it does filesystem I/O + locking). The reader is **pure** — it runs inside a host's
 * build with no `fs` — so it carries its own minimal, read-only view of the manifest shape and a
 * hand-rolled guard (no `zod` at runtime, keeping the reader dependency-light for the future
 * standalone package, FUTURE_CHANGES Item 44). Keep this in sync with the writer's on-disk format;
 * the `version` constant below is the single gate that fails loudly when it drifts.
 *
 * @see src/lib/storage/manifest.ts — the writer / source of truth for the on-disk format.
 */

/** The on-disk manifest format version the reader understands (file-first layout, Item 18). */
export const SUPPORTED_MANIFEST_VERSION = 2;

/** One blob's manifest entry: identity + derived class membership + intrinsic info. */
export interface ManifestFileEntry {
	/** Current filename of the blob within `media/files/`. */
	file_name: string;
	/** Derived membership index — the class ids this blob belongs to. */
	classes: string[];
	/** True when the blob's file is gone from disk but the entry is retained. */
	missing: boolean;
	/** ISO timestamp the blob was first registered. */
	created_at?: string;
	/** Intrinsic pixel width (images), when known. */
	width?: number;
	/** Intrinsic pixel height (images), when known. */
	height?: number;
}

/** The parsed `media/manifest.json`: a format version + the blob registry keyed by stable id. */
export interface Manifest {
	version: number;
	files: Record<string, ManifestFileEntry>;
}

/**
 * Error thrown when a workspace cannot be read — a missing manifest or an unsupported on-disk
 * format version. Thrown eagerly at load time (never a silent empty render) so a host sitting on a
 * stale or pre-migration export gets an actionable message instead of blank galleries.
 */
export class WorkspaceFormatError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'WorkspaceFormatError';
	}
}

/**
 * Validate + narrow a raw parsed `media/manifest.json` into a {@link Manifest}, enforcing the
 * supported format version. This is the **version guard**: anything that isn't a v2 file-first
 * manifest throws {@link WorkspaceFormatError} with a message naming the expected layout.
 *
 * @param raw - The already-parsed JSON of `media/manifest.json` (or `undefined` if it wasn't found).
 * @returns The validated manifest.
 * @throws {WorkspaceFormatError} when the manifest is absent, malformed, or a version the reader
 *   does not understand.
 */
export function parseManifest(raw: unknown): Manifest {
	if (raw == null || typeof raw !== 'object') {
		throw new WorkspaceFormatError(
			'No media-manager manifest found. Expected a file-first workspace with `media/manifest.json` ' +
				`(format version ${SUPPORTED_MANIFEST_VERSION}). Did you pass the workspace root and is it migrated?`
		);
	}
	const obj = raw as Record<string, unknown>;
	const version = obj.version;
	if (version !== SUPPORTED_MANIFEST_VERSION) {
		throw new WorkspaceFormatError(
			`Unsupported workspace format: media/manifest.json is version ${String(version)}, but this ` +
				`reader understands version ${SUPPORTED_MANIFEST_VERSION} (the file-first layout). Run ` +
				'`npm run upgrade-data` on the workspace, or upgrade the reader.'
		);
	}
	const filesRaw = obj.files;
	const files: Record<string, ManifestFileEntry> = {};
	if (filesRaw && typeof filesRaw === 'object') {
		for (const [id, entryRaw] of Object.entries(filesRaw as Record<string, unknown>)) {
			if (!entryRaw || typeof entryRaw !== 'object') continue;
			const e = entryRaw as Record<string, unknown>;
			files[id] = {
				file_name: typeof e.file_name === 'string' ? e.file_name : '',
				classes: Array.isArray(e.classes) ? (e.classes as unknown[]).filter(isString) : [],
				missing: e.missing === true,
				created_at: typeof e.created_at === 'string' ? e.created_at : undefined,
				width: typeof e.width === 'number' ? e.width : undefined,
				height: typeof e.height === 'number' ? e.height : undefined
			};
		}
	}
	return { version: SUPPORTED_MANIFEST_VERSION, files };
}

function isString(v: unknown): v is string {
	return typeof v === 'string';
}
