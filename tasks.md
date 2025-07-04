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

# Things to think about
- is having default values important? other than like false for bools and 0 for ints - maybe we can just filter for empty values?


# Specific to other applications (not-important for now)
- add an option to fill out some fields based on Google Vision API (food web thing)
- experiment with an image grid renderer