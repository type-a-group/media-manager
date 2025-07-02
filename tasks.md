# General
- better UI - I'm thinking photo on the right, fields on the left
    - in mobile, photo above, obv
- add a last-modified timestamp to the metadata - then we can optionally organize by this
- add option to add/remove fields
    - needs API to add a field to all objects
    - needs API to remove a field from all objects
    - add buttons for it, add an are you sure prompt (not alert, but in state - this is less ugly)
- add json schema
    - define types of each param
    - make a custom field editor based on the type
- search/filter results
    - add an option to search by field
    - make this fast
    - make sure prev/next buttons go through this
- filtering - filter for images with missing fields
- templating - apply a change to many images - some sort of menu to mass select images?
    - do we only do this for unlinked images?

# Things to think about
- is having default values important? other than like false for bools and 0 for ints - maybe we can just filter for empty values?


# Specific to other applications (not-important for now)
- add an option to fill out some fields based on Google Vision API (food web thing)
- experiment with an image grid renderer