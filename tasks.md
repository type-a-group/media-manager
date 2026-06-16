# Cursor Specific
- figure out if using `$bindable` is ok, it seems weird?
- make a plan on what svelte features it should and shouldn't use
- come up with a systems design plan that it can reference - ideals for how the site should be organized, and future plans
- im thinking we can try to get it to comment on code that might be confusing AS its making it

# General
- when you save and link a previously unlinked image, move onto the next unlinked image
- optionally organize by timestamp
- filtering - filter for images with missing fields
- templating - apply a change to many images - some sort of menu to mass select images?
    - do we only do this for unlinked images?
- view image metadata
    - optionally delete or modify image metadata
-  Verbose mode: like not compact at all, images are displayed as the sidebar, so you can visually search through the data
    - Option to look at the images in a larger grid view (like lightroom) and select one in case you REALLY need to search for something visually

# Future changes
- Full PDF file support (storage + metadata already shipped):
    - render PDFs inline in the editor via native browser embed (`<iframe>`/`<embed>` with `application/pdf` content-type, no new deps) instead of the current icon placeholder
    - generate/serve PDF thumbnails for the grid + sidebar previews (currently a PDF icon)
    - reconsider splitting a dedicated `documents` media kind out of `images` (the `ALLOWED_IMAGE_EXTENSIONS`/`ImageEditorPane` "image" naming is now a slight misnomer)

# Things to think about
- is having default values important? other than like false for bools and 0 for ints - maybe we can just filter for empty values?


# Specific to other applications (not-important for now)
- add an option to fill out some fields based on Google Vision API (food web thing)
    - offline semantic search using the vision api-filled fields
    - vector database the fields for a fast fully local search also? (can maybe even work on exif data)
- experiment with an image grid renderer