/**
 * The curated **icon set** for per-entity (class / record-type) icons — the single source of truth for
 * which Lucide ids are assignable and how they're labelled in the picker. Kept Node-free and
 * component-free so it can be imported on both client and server (the server validates a stored id
 * against {@link isIconId}; the client renders it via `EntityIcon.svelte`, which owns the id→component
 * map). Stored values are stable kebab-case Lucide ids (e.g. `"film"`); an unknown/absent id falls
 * back to the surface's generic glyph (see {@link resolveIconId}).
 *
 * Adding an icon is a two-step, intentional edit: add the id + label here, then add the matching
 * `lucide-svelte` import + map entry in `EntityIcon.svelte`. Keeping the two in lockstep guarantees
 * every assignable id actually renders.
 */

/** Every assignable icon: a stable Lucide id + a human label shown in the picker / its search. */
export const ICON_OPTIONS = [
	{ id: 'image', label: 'Image' },
	{ id: 'camera', label: 'Camera' },
	{ id: 'film', label: 'Film' },
	{ id: 'clapperboard', label: 'Clapperboard' },
	{ id: 'video', label: 'Video' },
	{ id: 'music', label: 'Music' },
	{ id: 'headphones', label: 'Headphones' },
	{ id: 'file-audio', label: 'Audio file' },
	{ id: 'file-text', label: 'Document' },
	{ id: 'newspaper', label: 'Newspaper' },
	{ id: 'book', label: 'Book' },
	{ id: 'quote', label: 'Quote' },
	{ id: 'tag', label: 'Tag' },
	{ id: 'bookmark', label: 'Bookmark' },
	{ id: 'hash', label: 'Hash' },
	{ id: 'flag', label: 'Flag' },
	{ id: 'star', label: 'Star' },
	{ id: 'heart', label: 'Heart' },
	{ id: 'sparkles', label: 'Sparkles' },
	{ id: 'trophy', label: 'Trophy' },
	{ id: 'target', label: 'Target' },
	{ id: 'rocket', label: 'Rocket' },
	{ id: 'folder', label: 'Folder' },
	{ id: 'folder-open', label: 'Folder (open)' },
	{ id: 'box', label: 'Box' },
	{ id: 'package', label: 'Package' },
	{ id: 'layers', label: 'Layers' },
	{ id: 'shapes', label: 'Shapes' },
	{ id: 'list', label: 'List' },
	{ id: 'database', label: 'Database' },
	{ id: 'code', label: 'Code' },
	{ id: 'link', label: 'Link' },
	{ id: 'globe', label: 'Globe' },
	{ id: 'map-pin', label: 'Map pin' },
	{ id: 'calendar', label: 'Calendar' },
	{ id: 'users', label: 'People' },
	{ id: 'mail', label: 'Mail' },
	{ id: 'phone', label: 'Phone' },
	{ id: 'palette', label: 'Palette' },
	{ id: 'brain', label: 'Brain' },
	{ id: 'wrench', label: 'Wrench' },
	{ id: 'briefcase', label: 'Briefcase' },
	{ id: 'graduation-cap', label: 'Education' },
	{ id: 'gamepad-2', label: 'Game' },
	{ id: 'utensils', label: 'Food' },
	{ id: 'shopping-cart', label: 'Shopping' },
	{ id: 'plane', label: 'Plane' },
	{ id: 'car', label: 'Car' },
	{ id: 'house', label: 'House' }
] as const;

/** A valid, assignable icon id (a member of {@link ICON_OPTIONS}). */
export type IconId = (typeof ICON_OPTIONS)[number]['id'];

const ICON_ID_SET: ReadonlySet<string> = new Set(ICON_OPTIONS.map((o) => o.id));

/** Narrow an arbitrary string to a known {@link IconId}. Used by the server to validate stored ids. */
export function isIconId(value: unknown): value is IconId {
	return typeof value === 'string' && ICON_ID_SET.has(value);
}

/**
 * Resolve a stored icon id to one that's safe to render: the id itself when known, otherwise the
 * caller's generic `fallback` glyph (each surface picks its own — e.g. `tag` for classes, `file-text`
 * for record types). Centralizes the "missing/unknown ⇒ fallback" rule promised by the design.
 */
export function resolveIconId(id: string | undefined | null, fallback: IconId): IconId {
	return isIconId(id) ? id : fallback;
}
