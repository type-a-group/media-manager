/**
 * Side-agnostic data model for the shared {@link DataGrid}. A host's native row shape (e.g. the
 * file-first `FileItem` or a json record) may not leak past its adapter: each host maps its native
 * rows to {@link GridItem} and feeds the grid these normalized values only. This is what lets one
 * grid serve both the files hub and the json record views without re-introducing the legacy
 * linked/unlinked/excluded model (those concepts have no representation here).
 */

export type GridSize = 'small' | 'medium' | 'large';

/** A small membership/label badge under a tile (e.g. a class name, or a muted "unclassified"). */
export interface GridChip {
	label: string;
	/** `muted` renders a low-emphasis hint (e.g. "unclassified"); defaults to a solid secondary chip. */
	tone?: 'default' | 'muted';
}

/** One tile in the grid. Carries only what a tile renders — no native row fields survive here. */
export interface GridItem {
	id: string;
	/** Filename / record name / id fallback — already resolved by the host adapter. */
	primaryLabel: string;
	/**
	 * Optional muted secondary line under the primary label (e.g. a record subtitle). Currently
	 * unused by the Files tiles; wired in for hosts that want a subtitle under each tile.
	 */
	secondaryLabel?: string;
	/** Blob bytes URL for an image thumbnail; omit to render the file-icon fallback. */
	thumbnailUrl?: string;
	chips: GridChip[];
	/** Count of chips beyond those in `chips` (renders a trailing "+N"). */
	extraChips?: number;
	/** A warning to surface on the tile, e.g. "Missing file reference: cover". */
	warning?: string;
}

/** Presentational configuration injected by the host. */
export interface GridConfig {
	size: GridSize;
	/**
	 * Tile presentation. `thumbnail` (default) renders an image/file-icon square with a small label
	 * beneath it (the files hub). `text` is name-forward: the `primaryLabel` fills the square, with no
	 * thumbnail — used for json records, which have no blob to preview.
	 */
	variant?: 'thumbnail' | 'text';
	/**
	 * Selection mode is active. When true, clicking a tile toggles its selection (and a selected tile
	 * is marked with a primary ring) instead of opening it; when false, clicking opens the editor and
	 * tiles are never selectable. The host owns the mode (toggled by a header button).
	 */
	selectable: boolean;
	/** Highlight the tile whose item is open in an editor. */
	activeId?: string | null;
	/** Header text for a group key (host already stringified the group value into the key). */
	groupLabel?: (groupKey: string) => string;
	/** Message shown when there are no items. */
	emptyText?: string;
}

/** Interaction callbacks. The grid never mutates data or reads a host's selection store directly. */
export interface GridCallbacks {
	/** Single click on a tile when not in selection mode (open editor). */
	onOpen: (id: string) => void;
	/** Toggle the tile's selection (the click action while `config.selectable` is true). */
	onToggleSelect?: (id: string) => void;
	/** Whether a tile is currently selected. */
	isSelected?: (id: string) => boolean;
}

/** Min tile column width (px) for each grid size. */
export function gridColMin(size: GridSize): number {
	return size === 'small' ? 110 : size === 'large' ? 200 : 140;
}
