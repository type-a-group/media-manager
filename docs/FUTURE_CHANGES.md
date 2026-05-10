# Future Changes

Planned improvements and features that were identified during the codebase audit but deferred to later work.

---

## 1. File Field Picker UI

**Priority**: High  
**Context**: The `file` field type is now supported in the schema (can be created, filtered, stored), but the editor UI doesn't yet have a specialized picker for it.

### What's needed
- A file-picker component for `file` type fields in `ImageEditorPane.svelte` and `JsonEditorPane.svelte`
- Should list files from the global `files/` directory (via blob_store API)
- Allow searching/filtering available files
- Show a thumbnail preview for image files
- Display the current value as a clickable link

### Current state
- Schema creation, validation, filtering, and default values all work for `file` fields
- The field renders as a plain text input (inherited from the default `string` fallback)

---

## 2. Missing File Indicators (API + UI)

**Priority**: Medium  
**Context**: JSON records with `file` type fields may reference files that no longer exist in `files/`. The API should flag these broken references.

### API design (agreed)
- **List endpoint**: Return `missing_file_fields: string[]` on each list item (field keys with missing file references)
- **Record detail**: Return `_missing_files: Record<string, string>` mapping field key → expected filename for broken refs

### UI design
- Show a warning badge on list items with missing files
- Show inline warnings in the editor pane next to broken file fields
- Optionally offer a "clear" action to reset the field value

---

## 3. Bulk Operations

**Priority**: Low  
**Context**: The multiselect system exists but has limited actions.

### Potential features
- Bulk-update a field across selected records
- Bulk-delete selected records
- Bulk-export selected records as JSON

---

## 4. Schema Import/Export

**Priority**: Low  
**Context**: Media types have embedded schemas. Users may want to share or duplicate schemas.

### What's needed
- Export schema as standalone JSON
- Import schema from JSON (merge or replace)
- Clone schema from another media type

---

## 5. Data Validation & Repair

**Priority**: Low  
**Context**: Records may have orphaned keys (schema field deleted, value remains) or type mismatches.

### What's needed
- A "repair" action that scans all records and:
  - Removes keys not in schema
  - Coerces values to match field type
  - Reports and optionally fixes issues
