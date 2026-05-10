# media-manager

Local-first data manager built with SvelteKit + Svelte 5. Manages metadata for multiple media types: **images** (files + metadata), **generic / files** (loose files in a folder, optional metadata), and **pure JSON** (metadata only, e.g. projects list).

## What it does

- **Multi-media-type**: Open the app to see an overview of media types (e.g. Images, Projects). Each type lives in its own folder under a root directory.
- **Images**: Store image files and custom metadata (schema-driven fields). Upload, link/unlink, edit properties, delete.
- **Files (generic)**: Store arbitrary files in the type folder (not only images). Same UI patterns as images (linked/unlinked, upload, etc.); MIME/extension rules are relaxed for uploads compared to `images`.
- **Pure JSON**: Store records with no file attachment (e.g. a list of projects with title, description, links, tags). Same schema-driven fields and filters.
- **Schema = settings**: Each media type has one `settings.json` containing display name, kind, schema (field definitions), and app preferences (grid size, etc.). On first launch, the app may create default **`files`** (generic) and **`globals`** (json) groups under your root—see [`docs/FEATURES.md`](docs/FEATURES.md) for behavior details.

## Running the production build (typical use)

The shipped app is a **Node server** produced by SvelteKit’s adapter. You build once, then run Node with a data root:

```bash
npm install
npm run build
MEDIA_MANAGER_ROOT=/absolute/path/to/my-data node build
```

Equivalent shortcuts:

```bash
npm start
# same as: MEDIA_MANAGER_ROOT must still be set in the environment unless you use the CLI below
```

**Recommended:** use the **`media-manager`** CLI from the package root (after `npm run build`). It sets `MEDIA_MANAGER_ROOT` for you and opens the browser by default:

```bash
npm run build
node bin/media-manager.js /absolute/path/to/my-data
# or, if the package is linked/globally installed:
# media-manager /absolute/path/to/my-data
```

The server listens on **`PORT`** (default **3000**). Override with `PORT=8080` (or your platform’s env mechanism).

## Development server

For local development with hot reload:

```bash
npm install
MEDIA_MANAGER_ROOT=./my-data npm run dev
```

Create the root folder first:

```bash
mkdir -p my-data
```

Open the app in the browser. You’ll see the **overview** of media types. Use **Create new** to add a media type (Images, Files, or Pure JSON). Each type gets its own subfolder under the root.

## Data layout

**Root folder** (e.g. `./my-data`) contains one **subfolder per media type** plus a shared **`files/`** directory for all file-backed types. The app scans the root for subfolders that contain a valid `settings.json` (our format). No manifest file.

```
my-data/
├── files/                  # Global shared file storage (all images/files live here)
├── images/                 # An "images" media type
│   ├── settings.json       # kind: "images", schema, app preferences
│   └── image-data.json     # { images: [...] } — linked records
├── documents/              # A "generic" media type
│   ├── settings.json       # kind: "generic", schema
│   └── data.json           # { files: [...] } — linked records
├── projects/               # A "json" media type
│   ├── settings.json       # kind: "json", schema
│   └── data.json           # { records: [...] }
└── files-catalog/          # Auto-created "blob_store" (browse files/)
    └── settings.json       # kind: "blob_store"
```

### Images media type

- **settings.json** – `kind: "images"`, `schema` (field definitions), `dataFileName`, app preferences (grid size, etc.)
- **image-data.json** – `{ images: [{ id, file_name, image_name, ...custom fields }] }`
- Files are stored in the root-level **`files/`** directory (shared across all file-backed types)

### Pure JSON media type

- **settings.json** – `kind: "json"`, `schema`, `dataFileName`
- **data.json** – `{ records: [{ id, name, last_modified?, ...custom fields }] }`

### Generic / "files" media type

- **settings.json** – `kind: "generic"`, optional `schema`, `dataFileName`
- **data.json** – `{ files: [{ id, file_name, ...custom fields }] }`
- Files are stored in the root-level **`files/`** directory

### Blob store (auto-created)

- **settings.json** – `kind: "blob_store"` (read-only schema, browse-only)
- Provides a view of all files in `files/` without editing capabilities


## Key concepts

- **Stable identity**: Records are identified by a UUID (`id`). The UI does not put filenames in the URL.
- **Discovery**: The app scans the root folder for subfolders that contain a valid `settings.json`. No manifest.
- **Media type id** = folder name (e.g. `images`, `projects`). Renaming the display name in the UI does not change the folder name.

## CLI (`media-manager`)

After **`npm run build`**, the CLI expects the **`build/`** directory to exist next to `bin/media-manager.js`. It runs `node build` with `MEDIA_MANAGER_ROOT` set to your first argument.

```bash
npm run build
node bin/media-manager.js /path/to/my-data
```

Flags:

- `--body-size-limit N` — request body size limit in bytes (uploads)
- `--no-open` — do not open a browser when the server starts

Published install (if using `npx` from npm):

```bash
npx media-manager ./my-data
```

**Warning:** default upload limits are for **local use only**. If you expose the server on a network, set a smaller limit or run behind a reverse proxy.

## Developer reference

- **Feature map** (behavior, file locations, API index, known gaps): [`docs/FEATURES.md`](docs/FEATURES.md)

## Scripts

- `npm run dev`: dev server (requires `MEDIA_MANAGER_ROOT`)
- `npm run build`: production build (output in `build/`; run with `node build` or the CLI above)
- `npm run preview`: preview build
- `npm run start`: run the production server (`node build`; set `MEDIA_MANAGER_ROOT` in the environment)
- `npm run check`: svelte check
- `npm run lint`: prettier + eslint
- `npm run test`: unit tests (vitest)
