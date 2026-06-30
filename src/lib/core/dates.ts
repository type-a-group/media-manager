/**
 * Date-field helpers (client + server safe — no Node imports, no `@internationalized/date`).
 *
 * Use case:
 * - The `date` schema field type stores a date-only ISO string `YYYY-MM-DD` (no time, no timezone).
 *   These pure-string helpers validate that shape and render it for display, and are imported by the
 *   server display path (`stringifyFieldValue`) and the client `DateField` alike.
 *
 * Concerns / future improvements:
 * - Display is rendered **deterministically** (`DD Mon YYYY`, e.g. `29 Jun 2026`) rather than via
 *   `Intl.DateTimeFormat`, so the server and client produce byte-identical output (no SSR/locale
 *   drift). The browser-locale concern is the *input* segment order, which the bits-ui `DateField`
 *   handles on its own — display intentionally does not depend on locale.
 * - Date arithmetic for the calendar picker lives in `DateField.svelte` (the only place that pulls in
 *   `@internationalized/date`), keeping this module dependency-free for every server caller.
 */

/** Matches a strict ISO date-only string: four-digit year, two-digit month, two-digit day. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Fixed three-letter month abbreviations — locale-independent so display is deterministic. */
const MONTH_ABBR = [
	'Jan',
	'Feb',
	'Mar',
	'Apr',
	'May',
	'Jun',
	'Jul',
	'Aug',
	'Sep',
	'Oct',
	'Nov',
	'Dec'
];

/**
 * Type guard: is `value` a valid date-only ISO string (`YYYY-MM-DD`) for a real calendar day?
 *
 * Rejects malformed shapes, out-of-range months, and impossible days (e.g. `2026-02-30`,
 * `2025-02-29`). Used to validate stored values, default values, and filter operands before they
 * are compared or rendered.
 *
 * @param value - Any value (typically a raw field value off disk).
 * @returns `true` when `value` is a string of the form `YYYY-MM-DD` naming an existing day.
 */
export function isValidIsoDate(value: unknown): value is string {
	if (typeof value !== 'string' || !ISO_DATE_RE.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	if (m < 1 || m > 12 || d < 1) return false;
	// Day 0 of month m+1 (UTC) is the last day of month m — the real length of that month.
	const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return d <= daysInMonth;
}

/**
 * Renders a date-only ISO string to the app's medium display form, e.g. `2026-06-29` → `29 Jun 2026`.
 *
 * Use case:
 * - The single display formatter for `date` fields, called by `stringifyFieldValue` so tiles, titles,
 *   verbose grids, and bulk previews all show the same string. Deterministic (no `Intl`/locale) so the
 *   server-rendered value matches the client exactly.
 *
 * @param iso - A value expected to be a `YYYY-MM-DD` string. Invalid/empty input returns `''`.
 * @returns The `DD Mon YYYY` string, or `''` when `iso` is not a valid date.
 */
export function formatDateMedium(iso: unknown): string {
	if (!isValidIsoDate(iso)) return '';
	const [y, m, d] = iso.split('-').map(Number);
	return `${String(d).padStart(2, '0')} ${MONTH_ABBR[m - 1]} ${y}`;
}

/**
 * Today's date as a date-only ISO string in the local timezone (`YYYY-MM-DD`).
 *
 * Use case:
 * - The "Today" convenience in the date picker and the schema editor's default-value control.
 *
 * @returns The current local date as `YYYY-MM-DD`.
 */
export function isoToday(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}
