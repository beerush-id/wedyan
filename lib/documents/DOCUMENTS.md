# Motion project format

How a Motion project is written, file by file, so a tool outside Wedyan can write one that opens and plays in Wedyan. Everything here is plain JSON and Markdown.

## Layout

A project is one folder, named by the project's `id`, holding the `.motion`, its stages and its scripts. Anything else may live anywhere in the home.

```
~/Motions/a1b2c3d4e5f6/
  a1b2c3d4e5f6.motion        the project
  7f3e9a0b1c2d.stage         a stage, beside its project, always
  5e6f7a8b9c0d.md            a script
  9a8b7c6d5e4f.still         an asset; it may also live elsewhere
  9a8b7c6d5e4f/              what the still made: one picture per attempt
    0d9c8b7a-….webp
~/People/00112233aabb.persona
~/People/00112233aabb/Head.still
```

- **Names.** A file is named by an id: 12 lowercase hex characters is what Wedyan makes. What a document is called is its `name`, which can change without moving it.
- **Paths inside a document.** A path written in a document is either a home path, `~/Motions/…`, or relative to the document's own folder, `5e6f7a8b9c0d.md`, `../People/00112233aabb.persona`. Both resolve; never leave the home.
- **Addresses.** A picture, video or sound a clip plays is an address: the home path behind `/`, as in `/~/Motions/a1b2c3d4e5f6/9a8b7c6d5e4f/0d9c….webp`, or an `https://` URL that allows CORS.
- **Media.** Pictures are `.webp`, `.png`, `.jpg`, `.jpeg` or `.avif`; anything else a video or sound clip plays is read by its own decoder.

## Every document

Every `.motion`, `.stage`, `.persona`, `.still`, `.take` and `.sound` starts with the same header.

| Field | Type | Meaning |
|---|---|---|
| `type` | string | `motion`, `stage`, `persona`, `still`, `take` or `sound`, matching the extension. |
| `version` | `1` | The shape of the content. |
| `id` | string | Unique; a UUID is fine. |
| `name` | string | What it's called. |
| `description` | string? | One line, under 256 characters. |
| `created`, `updated` | string | ISO dates. |
| `author` | object | `{ "kind": "user" }`, or `{ "kind": "agent", "ask": "…" }` with the words it was made from. |
| `assignee` | string? | An `.agent` that may work on it, by path. |
| `tags` | string[]? | |

## `.motion`: the project

| Field | Type | Meaning |
|---|---|---|
| `id` | string | The same id as its folder and file name. Stages name their project by it. |
| `aspect` | string | `16:9`, `9:16` or `1:1`. A new stage is 1920 × 1080, 1080 × 1920 or 1080 × 1080. |
| `cover` | string | A picture's address, or `""`. |
| `status` | string | `draft` or `rendered`. |
| `script` | object? | `{ "path": "5e6f7a8b9c0d.md" }`: the bible and outline, as Markdown. `revisions` and `histories` are kept by Wedyan. |
| `casts` | string[]? | Who's in it, each a `.persona` path. |
| `assets` | string[] | What its stages are made from: `.still`, `.take` and `.sound` paths. |
| `album`, `favourite`, `chats`, `memos` | | Optional; the library uses them. |

A project holds no list of its stages. A stage belongs to it by sitting in its folder and naming its `id`.

## `.stage`: one playable part, such as an episode

| Field | Type | Meaning |
|---|---|---|
| `projectId` | string | The `.motion`'s `id`. |
| `order` | number | Its place in the project, from `0`. |
| `script` | string? | Its own Markdown script, by path. |
| `casts` | string[]? | Who's in it, each a `.persona` path. |
| `composition` | object | Its timeline: below. |

### `composition`

```json
{
  "id": "c0",
  "options": { "frameRate": 30 },
  "props": { "width": 1920, "height": 1080, "background": "#000000" },
  "tracks": []
}
```

- `options.frameRate`: frames a second. Wedyan writes `30`; every frame count below is at this rate.
- `props`: the stage's size in stage units, which are pixels at render size, and the colour behind every clip.
- `tracks`: drawn in order, so a later track draws over an earlier one. The timeline lists the last picture track at the top.
- `markers`: optional bookmarks on the stage, each like `{ "id": "m1", "options": { "atFrame": 90, "name": "Beat" } }`.

A stage runs to the end of its last clip.

### Track

```json
{ "id": "t1", "options": { "type": "video", "name": "Video 1", "meta": {} }, "props": {}, "segments": [] }
```

| Field | Meaning |
|---|---|
| `id` | Unique on the stage. |
| `options.type` | What it holds: see the table below. |
| `options.name` | What it's called on the timeline. A `title` track named `Subtitles` is where subtitles go. |
| `options.meta` | `{ "locked": true }` keeps its clips from being edited; `{ "muted": true }` silences it. Both are optional. |
| `options.disabled` | `true` hides it: the stage leaves its clips off. |
| `props` | Values every clip on it reads where the clip doesn't say its own. A title track's are how its words look, so its clips only need `text`. |
| `segments` | Its clips. |

| Track `type` | Clip `type`s it holds |
|---|---|
| `video` | `video`, `image` |
| `audio` | `audio` |
| `title` | `title` |
| `html` | `html`, `svg` |
| `painter` | `particle` |

A clip on a track that doesn't hold its type isn't drawn. Clips on one track shouldn't overlap: put overlapping clips on another track of the same type.

### Clip (segment)

```json
{
  "id": "s1",
  "options": { "type": "video", "name": "Wide river", "speed": 1, "duration": 2.4, "startFrame": 0, "meta": {} },
  "props": { "src": "/~/…/shot.webp", "fit": "cover", "x": 0, "y": 0, "width": 1920, "height": 1080 },
  "scenes": []
}
```

| Field | Meaning |
|---|---|
| `id` | Unique on the stage. |
| `options.type` | What it is. It has to fit its track. |
| `options.name` | What it's called on the timeline. |
| `options.startFrame` | Where it starts on the stage, in frames. |
| `options.duration` | How long it runs, in **seconds**. Any length: `0.1` is fine. |
| `options.speed` | `1`. Footage plays at this rate. |
| `options.offsetFrame` | How far into its content it starts, in frames: a clip trimmed at its head. `0` when unset. |
| `options.contentFrames` | How long its content is, in frames, e.g. a video's length: it can't run past it. No limit when unset. |
| `options.repeat`, `options.disabled` | Optional. |
| `options.meta` | What Wedyan knows about it; below. |
| `props` | What it is and draws; by type, below. |
| `scenes` | Its keyframes; below. |

#### `meta`

| Key | Meaning |
|---|---|
| `source` | The `.still`, `.take` or `.sound` it shows, by path. This is what links a clip to what it's generated from, and opens its prompt beside the timeline. |
| `thumbnail` | A picture's address, for the timeline and the stage's poster. |
| `shows` | What the shot shows, in words. |
| `guide` | The caption guide. While the clip has no picture, the stage shows it in place of one, so the cut can be watched before anything is drawn. |
| `who` | Who's in it, by name. |
| `speaker` | Who speaks, by name. |

A clip's `props.src` is what plays; `meta.source` is where it came from. Wedyan never derives one from the other while playing, so write both.

#### What a clip draws: `props`

A clip's `props` depend on its `type`. Each type is described below on its own.

Any key a clip doesn't set is read from its track's `props`. So a value every clip on a track shares, like a subtitle's font, can be written once on the track. A clip that sets the key overrides it for itself only.

##### The box

Every clip that draws something has a box. It's in stage units, measured from the stage's top-left corner. The stage places the box and moves it, so these keys work the same on every type.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `x` | number | `0` | Distance of its left edge from the stage's left edge. |
| `y` | number | `0` | Distance of its top edge from the stage's top edge. |
| `width` | number | none | Its width. |
| `height` | number | none | Its height. |
| `scale` | number | `1` | How much bigger or smaller it's drawn, about its centre. `2` is twice its size. |
| `rotate` | number | `0` | How far it's turned, in degrees, about its centre. |
| `opacity` | number | `1` | `0` is invisible, `1` is solid. |

Set `width` and `height` on every clip that draws, either on the clip or on its track. The only exception is an `svg` clip, which covers the whole stage when it has no box.

A box can be larger than the stage and placed partly off it. On a picture, that frames part of it, so one picture can act as several shots.

##### `video`

Footage, or a still picture, filling its box. A picture plays for the clip's whole length. This is how a shot shows its storyboard picture before its video exists.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `src` | string | none | The video or picture to show, as an address. |
| `fit` | string | `"cover"` | `"cover"` fills the box and crops what doesn't fit. `"contain"` fits the whole picture inside the box. |
| `muted` | boolean | `false` | `true` silences the footage's own sound. |
| `volume` | number | `1` | How loud its sound is, from `0` (silent) to `2` (twice its own level). |
| `pan` | number | `0` | Where its sound sits, from `-1` (left) to `1` (right). |

Plus the box.

```json
{ "src": "/~/Motions/a1b2c3d4e5f6/9a8b7c6d5e4f/0d9c8b7a.webp", "fit": "cover", "x": 0, "y": 0, "width": 1920, "height": 1080 }
```

##### `image`

A picture filling its box.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `src` | string | none | The picture, as an address. |
| `fit` | string | `"cover"` | `"cover"` or `"contain"`, as on `video`. |

Plus the box.

##### `audio`

A sound. It draws nothing, so it has no box.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `src` | string | none | The sound file, as an address. |
| `muted` | boolean | `false` | `true` silences it. |
| `volume` | number | `1` | From `0` to `2`. |
| `pan` | number | `0` | From `-1` (left) to `1` (right). |

```json
{ "src": "/~/Sounds/5d115fd31140/line.wav", "volume": 1 }
```

##### `title`

Words filling the box.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `text` | string | none | The words. |

Plus the box, plus any CSS property. A CSS property is written by its camel-case name, such as `fontFamily`, `fontSize`, `fontWeight`, `fontStyle`, `color`, `textAlign`, `lineHeight`, `background` or `borderRadius`.

A title is usually laid out by its track, so the clip only needs `text`:

```json
{ "text": "Who calls me from the water?" }
```

on a track whose `props` are:

```json
{ "x": 154, "y": 864, "width": 1613, "height": 138, "display": "grid", "alignItems": "center", "textAlign": "center", "color": "#ffffff", "fontSize": 43 }
```

##### `html`

One HTML element in its box, which can hold more elements inside it.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `element` | string | `"div"` | Which element it is, e.g. `"div"`, `"span"`, `"img"`. |
| `text` | string | none | The words inside it. |
| `attrs` | object | none | Its fixed HTML attributes, e.g. `{ "src": "…" }` on an `img`. |
| `children` | array | none | Elements nested inside it. See below. |

Plus the box, plus any CSS property by its camel-case name, as on a title.

```json
{ "element": "div", "x": 160, "y": 120, "width": 400, "height": 400, "background": "#f4c070", "borderRadius": 200 }
```

##### `svg`

One SVG element, in stage units.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `element` | string | required | Which SVG element it is, e.g. `"circle"`, `"rect"`, `"path"`, `"text"`, `"image"`. |
| `text` | string | none | The words, on a `text` element. |
| `attrs` | object | none | Its fixed SVG attributes, e.g. `{ "cx": 960, "cy": 540 }`. |

Plus any other key, which is written onto the element as an SVG attribute, e.g. `r`, `fill`, `stroke`, `strokeWidth`, `d`. Unlike `attrs`, these can be keyframed.

It can have a box. With one, its scale and rotation turn around that box. Without one, it covers the whole stage.

```json
{ "element": "circle", "attrs": { "cx": 960, "cy": 540, "fill": "none" }, "stroke": "#f4c070", "strokeWidth": 6, "r": 40 }
```

##### `particle`

Particles drifting across its box: embers or lights rising, snow falling, dust hanging. It goes on a `painter` track.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `count` | number | `24` | How many particles. |
| `color` | string | `"255, 196, 120"` | Their colour, as three numbers from `0` to `255`: red, green, blue. |
| `size` | number | `18` | How big each particle is, in stage units. |
| `speed` | number | `60` | How fast they travel, in stage units a second. |
| `direction` | string | `"up"` | `"up"` or `"down"`. |
| `sway` | number | `2` | How far each swings side to side, in its own sizes. |
| `glow` | number | `1` | `0` is a plain dot, `1` is a soft light. |

Plus the box, which is the area they drift in.

```json
{ "x": 0, "y": 0, "width": 1920, "height": 1080, "count": 30, "color": "255, 196, 120", "size": 10, "speed": 50 }
```

##### How values are written

- **CSS numbers.** On a title or HTML clip, a number is a length in stage units. `fontSize: 48` is 48 units. These properties take a number as it is instead: `opacity`, `zIndex`, `fontWeight`, `lineHeight`, `flex`, `flexGrow`, `flexShrink`, `order`.
- **SVG names.** A camel-case key becomes a kebab-case attribute, so `strokeWidth` is written as `stroke-width`. These stay as they are: `preserveAspectRatio`, `viewBox`, `gradientUnits`, `patternUnits`, `textLength`.
- **Fonts.** `fontFamily` is the name of one Google Fonts family, e.g. `"Cinzel"`, not a CSS font list. The stage loads it before drawing. A family that doesn't load falls back to the stage's own font.

#### Elements nested in an HTML clip: `children`

```json
{ "id": "n1", "name": "Label", "props": { "element": "span", "text": "Day 1", "x": 40, "y": 40, "fontSize": 48 }, "scenes": [] }
```

| Field | Meaning |
|---|---|
| `id` | Unique on the stage. |
| `name` | What it's called. Optional. |
| `props` | The same keys as an `html` clip, including its own `children`, nested as deep as needed. |
| `scenes` | Its keyframes, written flat: `{ "id", "atFrame", "meta"?, "data" }`, not under `options`. `atFrame` counts from its host clip's start. |

A nested element moves, scales and fades with whatever holds it. Its `x` and `y` are measured inside its parent. Without `x` or `y`, it flows inside its parent as HTML normally does.

#### Keyframes: `scenes`

```json
{ "id": "k1", "options": { "atFrame": 0, "meta": { "ease": "power2.out" } }, "data": { "opacity": 0, "scale": 1.1 } }
```

- `atFrame` counts from the clip's own start, in frames, plus its `offsetFrame`.
- `data` holds any of its values, box and motion included, as they are at that moment.
- **Interpolation.** Each value follows only the keyframes that set it. It holds its first value until then and its last from then on. In between, it eases from each keyframe to the next by the earlier one's `meta.ease`.
- **Eases.** `meta.ease` is any GSAP ease name: `none`, `power1.in`, `power2.inOut`, `sine.out`, `back.out(1.7)`, `elastic.out(1, 0.3)`, and so on. `none` when unset.
- **What eases.** Numbers and colours (`#rrggbb`, `rgb()`, `hsl()`) ease. Anything else, words or `transparent`, switches at its keyframe.
- **Unkeyed values.** A value no keyframe sets is the clip's `props`, then its track's.

## What a project holds

### `.persona`: someone or something that appears or speaks

| Field | Meaning |
|---|---|
| `kind` | `person`, `character` or `mascot`. |
| `head` | `{ "main": "00112233aabb/Head.still", "poses"?: [...] }`: their face, a `.still` by path. |
| `body` | Optional, the same shape: their whole figure. |
| `wardrobe` | Optional: `{ "main", "outfits"?: [...] }`, each a `.still`. |
| `attachDefault` | `true` sends their face, figure and outfit along whenever they're cast in a picture. |
| `voice` | Optional: `{ "name", "sample"? }`. |
| `notes` | Optional: a Markdown file, by path. |

### `.still`: a generated picture

| Field | Meaning |
|---|---|
| `prompt` | What it shows. |
| `settings` | Optional: `{ "model"?, "aspect"?, "batch"? }`. |
| `references` | What it's made from, by path or address. Never itself. |
| `casts` | Who's in it, by `.persona` path. |
| `castPictures` | Optional: which of each cast's pictures it's made from, by the path it casts them under. |
| `attempts` | Every picture made: `{ "id", "src", "prompt", "settings", "created" }`, with `src` by path from the still, e.g. `9a8b7c6d5e4f/0d9c….webp`. |
| `chosen` | The attempt it shows, by `id`; `""` with none. |
| `edits` | `[]`, or the edits made to the chosen picture. |

### `.take`: a generated video, before and after it exists

Like a still, with:

- `prompt`: the video prompt, what moves and how the camera moves.
- `settings`: `{ "mode": "image" | "video", "model"?, "aspect"?, "seconds"? }`.
- `attempts`: each with its `seconds`, and a `poster` when `src` is footage.

A take with no attempts is a video still to be made. Its clip plays the first picture among its `references` until then, and its clip's `props.src` should say so.

### `.sound`: generated sound

| Field | Meaning |
|---|---|
| `kind` | `speech`, `music`, `sfx` or `ambience`. |
| `prompt` | How it sounds. For speech, how its words are said. |
| `text` | For speech: its words. |
| `voice` | For speech: who says them, a `.persona` path. |
| `settings` | Optional: `{ "model"?, "seconds"? }`. |
| `references` | Optional. |
| `attempts` | Each with its `seconds`. |
| `chosen` | The attempt it plays. |

## A whole stage

This stage plays as it is, with no media: a shot not yet drawn, showing its guide, a title that fades in, a circle that grows, embers, and a subtitle.

```json
{
  "type": "stage",
  "version": 1,
  "id": "6b1f0c3e-2c1a-4d8e-9b7a-3f2e1d0c9b8a",
  "name": "Episode 1: The Lake",
  "created": "2026-11-03T00:00:00.000Z",
  "updated": "2026-11-03T00:00:00.000Z",
  "author": { "kind": "user" },
  "projectId": "a1b2c3d4e5f6",
  "order": 0,
  "composition": {
    "id": "c1",
    "options": { "frameRate": 30 },
    "props": { "width": 1920, "height": 1080, "background": "#0b0b10" },
    "tracks": [
      {
        "id": "video",
        "options": { "type": "video", "name": "Video", "meta": {} },
        "props": {},
        "segments": [
          {
            "id": "shot1",
            "options": { "type": "video", "name": "Wide lake", "speed": 1, "duration": 4, "startFrame": 0, "meta": { "shows": "A still lake at dusk", "guide": "Wide: the lake at dusk" } },
            "props": { "fit": "cover", "x": 0, "y": 0, "width": 1920, "height": 1080 },
            "scenes": []
          }
        ]
      },
      {
        "id": "html",
        "options": { "type": "html", "name": "HTML", "meta": {} },
        "props": {},
        "segments": [
          {
            "id": "ring",
            "options": { "type": "svg", "name": "Ring", "speed": 1, "duration": 4, "startFrame": 0, "meta": {} },
            "props": { "element": "circle", "attrs": { "cx": 960, "cy": 540, "fill": "none" }, "stroke": "#f4c070", "strokeWidth": 6, "r": 40 },
            "scenes": [
              { "id": "r0", "options": { "atFrame": 0, "meta": { "ease": "power2.out" } }, "data": { "r": 40 } },
              { "id": "r1", "options": { "atFrame": 90 }, "data": { "r": 320 } }
            ]
          }
        ]
      },
      {
        "id": "embers",
        "options": { "type": "painter", "name": "Embers", "meta": {} },
        "props": {},
        "segments": [
          {
            "id": "glow",
            "options": { "type": "particle", "name": "Embers", "speed": 1, "duration": 4, "startFrame": 0, "meta": {} },
            "props": { "x": 0, "y": 0, "width": 1920, "height": 1080, "count": 30, "color": "255, 196, 120", "size": 10, "speed": 50 },
            "scenes": []
          }
        ]
      },
      {
        "id": "title",
        "options": { "type": "title", "name": "Title", "meta": {} },
        "props": { "x": 192, "y": 432, "width": 1536, "height": 216, "display": "grid", "alignItems": "center", "textAlign": "center", "color": "#ffffff", "fontSize": 86, "fontWeight": "bold", "fontFamily": "Cinzel" },
        "segments": [
          {
            "id": "name",
            "options": { "type": "title", "name": "Title", "speed": 1, "duration": 2.5, "startFrame": 15, "meta": {} },
            "props": { "text": "The Lake" },
            "scenes": [
              { "id": "t0", "options": { "atFrame": 0, "meta": { "ease": "sine.out" } }, "data": { "opacity": 0, "y": 470 } },
              { "id": "t1", "options": { "atFrame": 20 }, "data": { "opacity": 1, "y": 432 } }
            ]
          }
        ]
      },
      {
        "id": "subtitles",
        "options": { "type": "title", "name": "Subtitles", "meta": {} },
        "props": { "x": 154, "y": 864, "width": 1613, "height": 138, "display": "grid", "alignItems": "center", "textAlign": "center", "color": "#ffffff", "fontSize": 43, "lineHeight": 1.25, "background": "rgba(0, 0, 0, 0.45)", "borderRadius": 17 },
        "segments": [
          {
            "id": "line1",
            "options": { "type": "title", "name": "Subtitle", "speed": 1, "duration": 1.5, "startFrame": 75, "meta": {} },
            "props": { "text": "Who calls me from the water?" },
            "scenes": []
          }
        ]
      }
    ]
  }
}
```

Its project, saved as `~/Motions/a1b2c3d4e5f6/a1b2c3d4e5f6.motion`:

```json
{
  "type": "motion",
  "version": 1,
  "id": "a1b2c3d4e5f6",
  "name": "The Lake",
  "created": "2026-11-03T00:00:00.000Z",
  "updated": "2026-11-03T00:00:00.000Z",
  "author": { "kind": "user" },
  "aspect": "16:9",
  "cover": "",
  "status": "draft",
  "assets": []
}
```
