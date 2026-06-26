/**
 * Small date/time formatting helpers. Client+server safe — no Node imports.
 */

/**
 * Format an ISO-8601 timestamp as a short, human, **local** date + time (e.g. `Jun 26, 2026, 3:40 PM`).
 * Used for the side-panel "Modified …" / "Added …" caption (Item 9). Returns `''` for an absent or
 * unparseable value so callers can simply skip rendering.
 *
 * @param iso - An ISO timestamp string (e.g. a record's `last_modified` or a blob's `created_at`).
 * @returns The localized date+time, or `''` when there's nothing valid to show.
 */
export function formatTimestamp(iso: string | null | undefined): string {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}
