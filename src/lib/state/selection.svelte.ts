import type { ImageId } from '$lib/core/ids.js';
import type { ImageListItem } from '$lib/core/types.js';
import { getContext, setContext } from 'svelte';

const SELECTION_CONTEXT_KEY = Symbol('media-manager:selection');

/**
 * Create the shared selection state for the app.
 *
 * Use case:
 * - Provides a single source of truth for the currently selected image and list view mode.
 * - Allows sidebar and editor pane to coordinate without navigation or URL params.
 *
 * Why this exists (and why it is layout-owned):
 * - Module-level `$state` + `localStorage` reads during module evaluation can diverge between SSR and
 *   the browser, causing hydration mismatch and “dead click handlers until refresh”.
 * - By initializing in `+layout.svelte`, SSR and client begin from the same initial DOM.
 *
 * Concerns / future improvements:
 * - If we later want persistence, add it client-only (inside a component `onMount` + guarded `$effect`).
 * - If we later want shareable deep links, encode `imageId` in the URL intentionally.
 */
export class SelectionState {
	/**
	 * The currently selected imageId.
	 */
	selectedImageId = $state<ImageId | null>(null);

	/**
	 * Current list view mode (which list is shown in the sidebar).
	 */
	viewMode = $state<'linked' | 'unlinked' | 'excluded'>('linked');

	/**
	 * Ordered list of IDs currently visible in the sidebar list.
	 */
	visibleImageIds = $state<ImageId[]>([]);

	/**
	 * Full list items visible in the sidebar (for grid view).
	 */
	visibleImageItems = $state<ImageListItem[]>([]);

	/**
	 * Whether grid view is active (main area shows image grid instead of editor).
	 */
	gridViewActive = $state(false);

	/**
	 * IDs of images selected in grid view multiselect mode.
	 */
	multiselectedIds = $state<ImageId[]>([]);

	/**
	 * Whether grid select mode is on (click toggles multiselect instead of single-select).
	 */
	gridSelectMode = $state(false);

	/**
	 * Schema field key to group grid items by (null = no grouping).
	 * When set, list fetch includes groupBy and items have group_by_value.
	 */
	gridGroupByField = $state<string | null>(null);

	/**
	 * Grid cell size: small (80px), medium (120px), large (180px).
	 */
	gridSize = $state<'small' | 'medium' | 'large'>('medium');

	/** Optional hook run before changing selection to another item. Used to save current edits when "save when advancing" is on. */
	private _beforeSelectAnother: (() => Promise<void>) | null = null;

	/**
	 * Register a callback to run before selecting a different image/record.
	 * When selectImage(newId) is called with newId !== current id, this callback is awaited first.
	 * Use case: Editor panes register save-if-dirty when autoSaveOnAdvance is on.
	 *
	 * @param fn - Async function to run before selection change (e.g. save current record).
	 * @returns Unregister function to call on cleanup.
	 */
	registerBeforeSelectAnother = (fn: () => Promise<void>): (() => void) => {
		this._beforeSelectAnother = fn;
		return () => {
			if (this._beforeSelectAnother === fn) this._beforeSelectAnother = null;
		};
	};

	/**
	 * Update the currently selected image.
	 * If selecting a different id, runs the registered beforeSelectAnother callback first (e.g. save on advance).
	 *
	 * @param id - The selected `imageId`, or null to clear selection.
	 */
	selectImage = async (id: ImageId | null) => {
		if (id !== this.selectedImageId && this._beforeSelectAnother) {
			await this._beforeSelectAnother();
		}
		this.selectedImageId = id;
	};

	/**
	 * Set selection without running beforeSelectAnother.
	 * Use for programmatic advance (e.g. after link-to-catalog) so the save-on-advance hook cannot block.
	 */
	setSelectedImageIdOnly = (id: ImageId | null) => {
		this.selectedImageId = id;
	};

	/**
	 * Update the current list view mode.
	 *
	 * @param mode - `linked`, `unlinked`, or `excluded`.
	 */
	setViewMode = (mode: 'linked' | 'unlinked' | 'excluded') => {
		this.viewMode = mode;
	};

	/**
	 * Update the ordered list of IDs visible in the sidebar.
	 *
	 * @param ids - Ordered list of visible image IDs.
	 */
	setVisibleImageIds = (ids: ImageId[]) => {
		this.visibleImageIds = ids;
	};

	/**
	 * Update the full list items visible in the sidebar (for grid view).
	 *
	 * @param items - Ordered list of visible image list items.
	 */
	setVisibleImageItems = (items: ImageListItem[]) => {
		this.visibleImageItems = items;
	};

	/**
	 * Set whether grid view is active.
	 * When entering grid view, runs the save-before-navigate hook (if registered) then clears selection and multiselect.
	 *
	 * @param active - Whether grid view should be active.
	 */
	setGridViewActive = async (active: boolean) => {
		if (active && this._beforeSelectAnother) {
			await this._beforeSelectAnother();
		}
		this.gridViewActive = active;
		if (active) {
			this.selectedImageId = null;
			this.multiselectedIds = [];
			this.gridSelectMode = false;
		}
	};

	/**
	 * Toggle grid select mode on/off.
	 */
	setGridSelectMode = (on: boolean) => {
		this.gridSelectMode = on;
		if (!on) {
			this.multiselectedIds = [];
		}
	};

	/**
	 * Toggle an image in the multiselect set.
	 *
	 * @param id - The image ID to toggle.
	 */
	toggleMultiselect = (id: ImageId) => {
		const idx = this.multiselectedIds.indexOf(id);
		if (idx === -1) {
			this.multiselectedIds = [...this.multiselectedIds, id];
		} else {
			this.multiselectedIds = this.multiselectedIds.filter((x) => x !== id);
		}
	};

	/**
	 * Clear all multiselected images.
	 */
	clearMultiselect = () => {
		this.multiselectedIds = [];
	};

	/**
	 * Set the field to group grid items by (null = no grouping).
	 *
	 * @param field - Schema field key, or null for flat list.
	 */
	setGridGroupByField = (field: string | null) => {
		this.gridGroupByField = field;
	};

	/**
	 * Set grid cell size (small / medium / large).
	 */
	setGridSize = (size: 'small' | 'medium' | 'large') => {
		this.gridSize = size;
	};
}

/**
 * Initialize and store the selection state in Svelte context.
 *
 * Call this once from a top-level component (e.g. `src/routes/+layout.svelte`).
 *
 * @returns The created `SelectionState` instance.
 */
export function setSelectionContext(): SelectionState {
	const state = new SelectionState();
	setContext(SELECTION_CONTEXT_KEY, state);
	return state;
}

/**
 * Hook to access selection state stored in context.
 *
 * @returns The shared `SelectionState`.
 * @throws If called outside of a component tree where `setSelectionContext()` was invoked.
 */
export function useSelection(): SelectionState {
	const state = getContext<SelectionState | undefined>(SELECTION_CONTEXT_KEY);
	if (!state) {
		throw new Error('useSelection() must be used under a layout that calls setSelectionContext()');
	}
	return state;
}

