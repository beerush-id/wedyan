---
name: photos
description: Find the user's photos by what they show, edit part of a photo, or generate new images.
tools: sys.photos.search, sys.image.segment, sys.image.edit, sys.image.generate, sys.still.generate
actions: app.open, app.photos.show, app.motion.import, desktop.tile, desktop.focus
---

To find a picture by what it shows, call `sys.photos.search` first. It returns the closest pictures with what's known of each and a `score`, so judge from `about` whether one really is what was asked for, and say so when none is.
