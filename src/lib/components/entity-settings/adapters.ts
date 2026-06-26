import type { EntitySettingsAdapter } from './types.js';
import { fieldLabel, schemaUserFields } from '$lib/core/fieldKeys.js';
import type { SchemaDefinition } from '$lib/core/types.js';
import {
	apiGetClass,
	apiUpdateClassConfig,
	apiDeleteClass,
	apiAddClassField,
	apiUpdateClassField,
	apiDeleteClassField
} from '$lib/api/files.js';
import {
	apiGetTypeSettings,
	apiUpdateTypeSettings,
	apiDeleteMediaType,
	apiGetSchemaForType,
	apiAddSchemaFieldForType,
	apiUpdateSchemaFieldForType,
	apiDeleteSchemaFieldForType
} from '$lib/api/client.js';

/** Sorted `{ key, label }` list for a class schema's title/group selects. */
function classFields(schema: SchemaDefinition): { key: string; label: string }[] {
	return Object.keys(schema)
		.sort((a, b) => a.localeCompare(b))
		.map((k) => ({ key: k, label: fieldLabel(k) }));
}

/**
 * Entity-settings adapter for a Files **class** (`/api/classes/[id]`). General tab persists
 * `displayName`, `displayField` (title-by), and `gridGroupByField` (group-by); Fields tab drives the
 * class schema; Danger tab deletes the class.
 */
export function classSettingsAdapter(classId: string): EntitySettingsAdapter {
	return {
		noun: 'class',
		recordNoun: 'record',
		hasGroupBy: true,
		hasSubtitle: false,
		load: async () => {
			const detail = await apiGetClass(classId);
			return {
				displayName: detail.config.displayName ?? '',
				icon: detail.config.icon ?? '',
				titleBy: detail.config.displayField ?? '',
				subtitleBy: '',
				groupBy: detail.config.gridGroupByField ?? '',
				fields: classFields(detail.schema)
			};
		},
		save: async ({ displayName, icon, titleBy, groupBy }) => {
			await apiUpdateClassConfig(classId, {
				displayName,
				// '' is sent verbatim to clear (it resolves to the generic fallback when rendered).
				icon,
				displayField: titleBy || undefined,
				gridGroupByField: groupBy || undefined
			});
		},
		schema: {
			getSchema: async () => (await apiGetClass(classId)).schema,
			addField: (body) => apiAddClassField(classId, body),
			updateField: (body) => apiUpdateClassField(classId, body),
			deleteField: (fieldName, removeFromRecords) =>
				apiDeleteClassField(classId, fieldName, removeFromRecords)
		},
		remove: () => apiDeleteClass(classId)
	};
}

/** `{ key, label }` list for a record type: user fields + `name`, name first (shared helper). */
const typeFields = schemaUserFields;

/** Media-type schema key ordering: hide system keys, float the name field first. */
function orderTypeKeys(s: SchemaDefinition): string[] {
	return Object.keys(s)
		.filter((k) => !['file_name', 'last_modified', 'default'].includes(k))
		.sort((a, b) => (a === 'name' ? -1 : b === 'name' ? 1 : a.localeCompare(b)));
}

/**
 * Entity-settings adapter for a Records **type** (`/api/media-types/[typeId]`). General tab persists
 * `displayName` + `displayField` (title-by); there is no persisted group-by (it stays an ephemeral
 * header control). Fields tab drives the type schema; Danger tab deletes the type.
 */
export function typeSettingsAdapter(typeId: string): EntitySettingsAdapter {
	return {
		noun: 'record type',
		recordNoun: 'record',
		hasGroupBy: false,
		hasSubtitle: true,
		load: async () => {
			const [settings, schema] = await Promise.all([
				apiGetTypeSettings(typeId),
				apiGetSchemaForType(typeId)
			]);
			return {
				displayName: settings.displayName,
				icon: settings.icon,
				titleBy: settings.displayField,
				subtitleBy: settings.subtitleField,
				groupBy: '',
				fields: typeFields(schema)
			};
		},
		save: async ({ displayName, icon, titleBy, subtitleBy }) => {
			await apiUpdateTypeSettings(typeId, {
				displayName,
				icon,
				displayField: titleBy,
				subtitleField: subtitleBy
			});
		},
		schema: {
			getSchema: () => apiGetSchemaForType(typeId),
			addField: (body) => apiAddSchemaFieldForType(typeId, body),
			updateField: (body) => apiUpdateSchemaFieldForType(typeId, body),
			deleteField: (fieldName, removeFromRecords) =>
				apiDeleteSchemaFieldForType(typeId, { fieldName, removeFromImages: removeFromRecords }),
			orderKeys: orderTypeKeys
		},
		remove: async () => {
			await apiDeleteMediaType(typeId);
		}
	};
}
