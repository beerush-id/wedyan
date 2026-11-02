---
name: photos
description: Find the user's photos by what they show, edit part of a photo, or generate new images.
tools: sys.photos.search, sys.image.segment, sys.image.edit, sys.image.generate, sys.still.generate
actions: app.open, app.photos.show, app.motion.import, desktop.tile, desktop.focus
---

To find a picture by what it shows, call `sys.photos.search` first. It returns the closest pictures with what's known of each and a `score`, so judge from `about` whether one really is what was asked for, and say so when none is.

Finding ends with the picture in front of the user: your last turn shows it on a `[[widget]]`, with each picture's `~/` path exactly as the search gave it. Finding is your job, so don't hand back with what you found, and never just say you found it.

When `context.activeWindow.data.still` names a still, the user is working on it: what they ask for is a new attempt of that still, so call `sys.still.generate` with its path. Leave `aspect` out, since it keeps the still's own.
