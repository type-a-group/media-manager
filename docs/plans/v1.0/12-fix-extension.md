# Item 12 — Fix / Normalize File Extension (+ better rename UX)

> 1.0 brief. Backlog: [Item 12](../../FUTURE_CHANGES.md#shipped--folded). Build process: [working agreement](README.md#how-we-build-each-feature-the-working-agreement). **Status: ✅ shipped.** Design plan: [`12-fix-extension-plan.html`](12-fix-extension-plan.html). This brief also covered the "better renaming UI pattern" Nicholas called out alongside it.
>
> **Shipped shape (interview):** the mismatch shares the Item 13 **warning badge** on `MetadataButton` (`needsAttention = dim‖ext`) and adds a one-tap **"Fix to .png"** hint in the editor header. Renaming was made first-class — the header splits the filename into a **base-name field + a separate extension field** (commit on blur/Enter), and the duplicate base-name rename inside the metadata dialog was retired. Magic-byte sniff extended to GIF/TIFF/BMP. Cut: no auto-fix-on-upload, no bulk fix.

## Backlog snapshot

```yaml
status: ready
size: S
usefulness: 2
priority: low
files: [src/lib/storage/classRepo.ts, src/lib/server/fileMetadata.ts]
depends_on: []
open_questions: 0
acceptance:
  - A per-file action to rename the extension (via the O(1) renameBlobById path — references stay intact)
  - Optionally detect the true type (magic bytes) and suggest the correct extension
```

## What & why

Since Item 6 (stable file IDs) shipped, identity is **decoupled from filename** — rename is O(1) via `renameBlobById` ([`classRepo.ts`](../../../src/lib/storage/classRepo.ts) / [`manifest.ts`](../../../src/lib/storage/manifest.ts)), and an extension fix is a pure display-name change (no fan-out). [`fileMetadata.ts`](../../../src/lib/server/fileMetadata.ts) already sniffs **magic bytes** (it does this to satisfy ExifTool), so true-type detection is reusable.

**The "+ better rename UI pattern" ask:** the current per-file rename is functional but plain. 1.0 should make renaming (full name *and* extension) a first-class, low-friction interaction in `FileEditorPanel` — this is the half of the item with the most user value and is where the interview should focus.

## Decisions to resolve in the interview (Phase 1)

- **Rename UX shape** — inline-edit the filename in the editor header? A dedicated rename affordance? Split base-name vs. extension into separate controls so an extension fix is one tap? Get Nicholas's concrete picture (this is a "what should it look like" question — mock it in the HTML plan).
- Should the app **proactively flag** an extension that disagrees with the sniffed type (a quiet badge offering "fix to `.png`"), or only offer it on demand?
- Guardrails: extension change must still pass `assertSafeBasename`/`assertSafeImageFilename`; confirm we warn (not block) when changing to an extension that disagrees with content.

## Build notes (Phase 3)

- Reuse `renameBlobById` for the actual rename; no new persistence path.
- Reuse the magic-byte sniff in `fileMetadata.ts` to compute the suggested extension; surface it as a suggestion, not an automatic mutation.
- This is the natural place to also land the improved rename interaction — keep it within `FileEditorPanel` and the shared editor chrome; don't fork a new panel.

## Verification stages (Phase 4)

- [x] `npm run check` + `npm run lint` clean (touched files).
- [x] `npm run test` — pure `detectExtensionMismatch` (match / `.jpeg≡.jpg` / `.tiff≡.tif` / png-as-jpg / null / no-ext) + `detectExtensionFromMagic` sniff table incl. GIF/TIFF/BMP (121 pass).
- [x] `npm run test:serve` — `extension-check` matrix on the fixture: `mislabeled.jpg` (PNG bytes) → mismatch `.png`; `forest.png`/`rotated.jpg`/`notes.txt` → no mismatch; one-tap Fix renames to `.png` + clears the badge; references survive, blob still serves; dup-name → 409; invalid id 400 / unknown 404.
- [x] UI capture of the split rename + badge + the one-tap Fix (before → after).
- [x] `FEATURES.md` updated (Extension-consistency row + `extension-check` endpoint + split-rename note); Item 12 → **Shipped & folded**; triage HTML synced.

## ✅ Shipped — manual smoke test (developer)

Run `npm run test:serve` (throwaway fixture — never a real root). The fixture ships
`mislabeled.jpg` (**PNG bytes** with a `.jpg` name, so it sniffs as `.png`).

1. **Badge + hint:** `/files` → click **mislabeled.jpg**. The side panel header shows a **base-name**
   field (`mislabeled`) + a separate **`.jpg`** field; the **ⓘ Metadata** button carries an amber **"!"**
   dot, and an amber banner reads _"Detected `.png` — extension doesn't match content"_ with a
   **Fix to .png** button. `forest.png` / `rotated.jpg` / the `.txt` show **no** badge/banner.
2. **One-tap fix:** click **Fix to .png** → toast; the extension field becomes `.png`, the grid tile
   relabels to `mislabeled.png`, and the **banner + badge disappear**.
3. **Persists:** reload → no badge (the manifest filename is now `.png`).
4. **General rename:** edit the base-name field (e.g. `mislabeled` → `forest`) and blur → if the name
   collides you get an inline _"A file with that name already exists"_ and the fields snap back;
   otherwise the tile relabels. Renaming never fires per keystroke — only on blur/Enter.
5. **Not sniffable:** the `.txt` (and any unrecognised type) never flags — we don't guess.
