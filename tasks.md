# Cursor Specific
- figure out if using `$bindable` is ok, it seems weird?
- make a plan on what svelte features it should and shouldn't use
- come up with a systems design plan that it can reference - ideals for how the site should be organized, and future plans
- im thinking we can try to get it to comment on code that might be confusing AS its making it

# General
- add a last-modified timestamp to the metadata - then we can optionally organize by this
- search/filter results
    - add an option to search by field
    - make this fast
    - make sure prev/next buttons go through this - this needs some state reorganization to make it work, I don't know if using a store is ok or messy just yet
- filtering - filter for images with missing fields
- templating - apply a change to many images - some sort of menu to mass select images?
    - do we only do this for unlinked images?
- view image metadata
    - optionally delete or modify image metadata
    - able to grab metadata from image (eg camera information)
    - able to display metadata also
- Some kind of way to preview images on list
    - Show thumbnail on hover or just on the side already
-  Verbose mode: like not compact at all, images are displayed as the sidebar, so you can visually search through the data
    - Option to look at the images in a larger grid view (like lightroom) and select one in case you REALLY need to search for something visually
- Upload images through the webapp
- non deletable name field, either togglable name/filename display, or just always display name if fileld is nonempty
- Schema separate from image data json

# Things to think about
- is having default values important? other than like false for bools and 0 for ints - maybe we can just filter for empty values?


# Specific to other applications (not-important for now)
- add an option to fill out some fields based on Google Vision API (food web thing)
    - offline semantic search using the vision api-filled fields
    - vector database the fields for a fast fully local search also? (can maybe even wortk on exif data)
- experiment with an image grid renderer