# test-fixtures

A **pristine, committed sample data root** in the **file-first layout**, so all storage/UI
code paths can be exercised:

| Path                           | What                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `media/files/`                 | The global blob dir: three PNGs + one `.txt`                                                                     |
| `media/manifest.json`          | Blob registry (v2) with the derived `classes[]` membership index                                                 |
| `media/classes/images.json`    | Class over the three PNGs; has a `related_doc` **file** field (one valid ref, one broken); `config.icon: image`  |
| `media/classes/documents.json` | Class with the `.txt` as a member (any file type); `config.icon: file-text`                                      |
| `media/settings.json`          | Media-wide prefs (class order, grid size)                                                                        |
| `notes/`                       | `json` type; two records; `attachment` **file** field (one valid, one broken); `settings.json` `icon: newspaper` |
| `globals/`                     | The reserved `json` singleton                                                                                    |

Every blob lives in `media/files/` (`getGlobalFilesDir()`) and is registered in
`media/manifest.json` with a stable id; a class is a member-keyed metadata table
(`media/classes/<id>.json`). The deliberately broken `file` references (`deadbeef-…`) exercise
the global missing-files warning. See `docs/FILE_FIRST_CLASSES.md` and `CLAUDE.md`.

## How to use it

```bash
npm run test:serve        # builds if needed, copies this seed to a gitignored
                          # test-data/ working copy, and serves it on :3000
npm run test:serve -- --no-open
```

**Do not point the app directly at this folder.** Running the app mutates its data root
(heals settings, writes data files, can rename/strip blob references), which would dirty
the committed seed. `test:serve` always serves a throwaway copy at `test-data/`.

## Keeping the seed current

When you change on-disk structure — `settings.json` / data-file layout, reserved-group
behavior, or media-kind semantics — **update this seed in the same change** (the same
discipline as `docs/FEATURES.md`). The reliable way to regenerate it: serve a scratch
root, recreate the classes/types via the UI/API, then copy the result back here. For a pure
on-disk format migration, running `node scripts/upgrade-data.mjs test-fixtures --apply`
against an old-layout seed is also valid (this is how the `media/` layout was generated).
