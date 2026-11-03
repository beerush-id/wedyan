import { COLORS, FIELD_VARIANTS, SIZES, VARIANTS } from '@airlib/aui/utils';
import type { AgentProfile } from '../kernel/agent.js';
import juneSkill from '../skills/june.md?raw';
import { fill } from './format.js';

/**
 * June, the composer. Other agents send a brief: the objective and the data, never how it looks;
 * June designs for that objective, so no other agent carries the widget vocabulary. She never speaks
 * and is never handed an ask: the kernel calls her for each widget and `ask_user` form, with the
 * user's persona, so what she draws keeps the look they asked for.
 *
 * @param model - The model she runs on.
 * @returns June's profile.
 */
export function june(model: string): AgentProfile {
  return { name: 'june', model, tools: [], json: true, system: COMPOSER_PROMPT };
}

/** What a date picker's and a time picker's own controls read out, as AUI requires them. */
const DATE_LABELS = { previous: 'Previous month', next: 'Next month', year: 'Year' };
const TIME_LABELS = { hour: 'Hour', minute: 'Minute', period: 'Half of the day' };

/**
 * Every role June may use: the props she may set, what it holds, and how it looks and behaves. It
 * says what each role is and never what it's for, because choosing is her work. A role that only
 * works with a function, or only as part of a page, isn't here.
 */
const VOCABULARY = `Each entry gives a role, its props, then how it looks and behaves. "Holds" says what goes in its children. "Binds" says which prop a binding fills and what that prop holds. size and color go on any role with a look, and options are always a list of {key, label} or an object of key to label.

**Text**

- Plain tags: p, span, strong, em, s, del, sup, sub, small, code, pre, blockquote, ul, ol, li, h3, h4, h5, h6, br, hr, a (href), dl, dt, dd, table, thead, tbody, tr, th, td.

**The card's parts**, at the widget's top level, in this order, each used only when there's something for it:

- card-media: reaches the card's side edges, and its top edge when it comes first.
- card-header: a tight stack. Holds card-title, the card's one heading, and card-description, one muted line under it.
- card-body: a stack with even gaps. Holds anything.
- card-actions: a row aligned to the end, wrapping when it's full, with the main action last. Holds anything.

**Arrangement**

- section: label. A plain group with no look and no gaps of its own. Holds anything.
- card: title, description, variant. A smaller card inside the widget, with its title and description drawn at its top. Holds anything. variant "outlined" is a hairline with no fill, "tonal" a soft wash of its color, "elevated" raised, "text" no fill at all, "glass" a frosted pane.
- divider: orientation, inset, variant. A line. inset stops it short of both ends, and variant "ghost" keeps its room and draws no line.
- toolbar: label, orientation, variant. A row: what it holds sits side by side at its own width, centered on one line. It never wraps, so what doesn't fit is cut off at the card's edge. Holds anything. With no variant it has no surface; "filled", "tonal", "outlined", "elevated" or "glass" give it one, shrunk to what it holds. orientation "vertical" stacks instead.
- grid: label, colcount, selectionMode. Rows and columns, side by side, in a rounded frame with lines between the rows. Holds grid-rows. A grid-row (name) holds its cells: grid-cell (name, unique in the grid; disabled; holds anything), and the tinted grid-column-header (name; sort, "ascending" or "descending" draws an arrow) and grid-row-header (name). Without colcount, a row's cells share its width evenly and long words break. With colcount, the number of columns, all rows line up on one set of columns as wide as their content, and what doesn't fit scrolls sideways. Pressing a cell picks it and fills it with the color; headers can't be picked. selectionMode "row" picks and fills whole rows instead and leaves cells plain. Binds value: the picked cell's or row's name.

**Rows**

- list: label. Rows drawn as segments of one run on a faint tint, rounded at its two ends. Holds list-items.
- list-item: title (required), description, meta, image, href. A bold title over a muted line, each cut to one line with an ellipsis, meta muted at the row's end, and a round picture leading it when image is given. Holds what sits at the row's end after meta. With href, pressing anywhere on the row follows it and the row tints under the pointer; that press lies over the whole row, so a control in it can't be reached.
- description-list: items, a list of {label, value}; layout. Quiet labels and strong values. layout "inline" (default) puts each label beside its value, in two columns; "stacked" puts it above. Long values wrap.
- stat: label, value (both required), change, trend ("up", "down" or "flat"), caption. A quiet label, a large number, and under them how it moved in a pill colored by trend, with caption beside the pill saying against what. change always comes with trend.
- feed: label, busy. A stack of soft rounded entries. Holds feed-articles. feed-article: title, meta; holds its body. The title, a quiet line under it, then the body, tinting under the pointer. With busy, a skeleton entry stands at the end. PageUp and PageDown move between entries.
- tree: label, items, multiple, required. Nested rows, each branch with an arrow that opens and closes it and a guide line down its children. items is a list of {name, label, disabled, expanded, children}; children makes it a branch, and expanded starts it open. Pressing a row picks it and fills it with the color. Binds value: the picked name, or a list of names with multiple. Rows that hold more than a label are written by hand instead of items: tree holds tree-items (name; on a branch label and expanded); a tree-item holds a span for its row and, on a branch, a tree-group of more tree-items.

**Pictures**

A picture's src is its address or ~/ path, as given, always ending in its size: ?s=512 at most, or ?s=256 where it shows small, like a gallery tile, a list row or an avatar. Never leave it off, and never go above 512. An item's value and an href keep the plain path, with no size.

- image: src, alt. A picture at its own shape, as wide as what holds it, or the initials of alt when there's none. In card-media it reaches the card's edges, and it may sit in an a that opens it.
- avatar: src, alt (required). A round picture, or initials when there's none. Holds what sits on it, such as a badge with count or dot.
- avatar-group: label, items, a list of {alt, src}; max. A row of overlapping avatars. Past max, the rest collapse into a "+N".
- gallery: label, items, multiple, checkable, required. Square picture tiles side by side, wrapping into rows, two to a row at the card's width, each at least 160 pixels wide. Each item is {value, src, alt, title, description, meta, href, disabled}: value is the picture's path. Under the picture, the title on one line, then description and meta at either end, all cut with an ellipsis. The picture eases in under the pointer. Pressing a tile picks it, with a tint and a ring, and with href pressing the picture opens it. checkable puts a check on each tile, and checking one switches to picking several. Binds value: the picked value, or a list with multiple.
- image-viewer: label, items, a list of {src, alt, caption}, the only pictures it draws, never children; loop, maxZoom, zoomStep, labels. One picture at a time, whole, on a dark 4:3 stage, with a glass toolbar floating over its lower edge: previous, a count like "2 / 5", next, zoom out, the zoom in percent, zoom in, full screen. caption shows under the stage. Arrow keys step, + and - and the wheel zoom, and a magnified picture drags. labels names those buttons, as {previous, next, zoomIn, zoomOut, fullscreen}, in the language of the data. Binds index: the picture on show, from 0.

**Parts that open or take turns**

- tab: value, orientation. Holds one tab-list and one tab-panel per tab. tab-list (label) holds the tab-buttons, on a toned strip that scrolls sideways when it's full. Each tab-button takes a name and its label as a child; the tab-panel with the same name holds what shows, anything at all. The first opens by itself, or the one value names. orientation "vertical" stands the strip beside the panels.
- accordion: value, multiple, required. A toned sheet of header rows with a chevron, each opening its panel below it; an open header takes the color. Holds accordion-button and accordion-panel pairs joined by the same name. The panel holds anything. value is the name open at the start, or a list of names with multiple, which lets several stay open. required keeps one open.
- disclosure: label, expanded. One header row with a chevron on the same sheet, showing what it holds when opened. expanded starts it open. Without label it holds a disclosure-trigger, whatever it holds being the header, and a disclosure-panel.
- carousel: label (required), keys, value, loop, autoplay, interval, arrowNav. One slide at a time. keys lists every slide's name and value is the name showing first; set both. loop wraps from the last slide to the first, and autoplay turns the slides every interval milliseconds. Holds a carousel-viewport (label), a rounded surface with wide padding at least 144 pixels tall, which holds the carousel-slides (name; each a stack holding anything). What moves it goes beside the viewport, each on its own line unless a row holds them: carousel-nav (direction, -1 or 1; label), a round button with an arrow, off at the ends without loop; carousel-picker (name, label), a dot that jumps to its slide, stretched to a pill while it's current; carousel-player (label, playingLabel; its text as a child), which starts and stops the turning.
- dialog: title, label, description, closeLabel, modality, dismissable. label is a button that opens a sheet over the whole desktop with a scrim behind it: title, description, what it holds, and a filled close button named closeLabel. Escape and a press outside close it unless dismissable is false; modality "nonmodal" has no scrim and leaves the desktop live. Without title it holds a dialog-trigger (its label as a child) and a dialog-panel, which holds dialog-title, dialog-description, anything else, and dialog-close (its label as a child).
- drawer: title, label, description, closeLabel, side, modality, dismissable. The same, as a sheet that slides in from a screen edge, side "start", "end" (default), "top" or "bottom", with what it holds in a scrolling body.
- popover: mode, dismissable, xDir, yDir. A floating panel that opens from the control it sits in. Write it as a child of that control, after its label. Pressing the control opens it. Holds anything.
- tooltip: mode, delay, xDir, yDir. A small floating note for the control around it, written as a child of that control, showing when it's pointed at or focused. Its text as a child.

**Marks**

- badge: variant ("filled" or "tonal"); its text as a child. A small pill. With count (and max, showZero, label) or dot, it pins itself to the corner of the role it sits in, at position "top-end" or "bottom-end".
- chip: variant; its text as a child. A static tag with square-ish corners. With pressed, it's a button that stays on or off and shows a check while on: it binds pressed, true or false, and in a toggle-group it takes a value instead of a binding.
- alert: title, description, variant ("tonal" or "filled"), dismissable, dismissLabel. A notice with an icon that fits its color: "info", "success", "warning" or "error". Holds a body in place of description. dismissable adds a close button.
- progress: value, min, max, label. A bar filling up.
- meter: value, min, max, label (required). A gauge of a reading within bounds.
- spinner: label (required). A small turning ring.
- empty-state: title, description. A calm centered heading with a line under it. Holds what sits below them.

**Going somewhere**

- link: href, current, disabled; its text as a child. Underlined text in the color.
- breadcrumb: label. A quiet trail on one wrapping row. Holds links with a breadcrumb-separator between each, a "/" unless it holds another mark. A link with current reads in full ink as where the trail ends.
- navigation: label. A stack of link rows that tint under the pointer. Holds links. The one with current is filled with the color.
- pagination: label, total, siblings, previousLabel, nextLabel. Round page numbers in a wrapping row between two arrows: the first, the last, siblings either side of the current one filled with the color, and "…" where pages are skipped. Pressing only moves the number it holds; nothing else changes unless something reads it. Binds page: a number from 1.
- app-icon: alt (required), src, action, once; a caption as a child. A pressable tile on raised glass with a picture or initials, and the caption under it. app-icon-tile: alt, src. The same tile, not pressable.

**Controls**

- button: variant, type, action, once, disabled; its label as a child. It runs an action and has no href: what opens something is a link or an a.
- toggle: name, value, variant; its label as a child. A text button that stays on or off, filled with the color while on. Binds pressed: true or false.
- toggle-group: aria-label, multiple, required, orientation, variant ("filled" or "glass"), collapsible. A toned track of toggles side by side; the tint glides to the one that's on. Holds toggles, each with a value. multiple lets several be on, each tinted. required keeps one on. orientation "vertical" stacks them. collapsible shows only what's on until it's pointed at. Binds value: the value that's on, or a list with multiple.
- segment-group: aria-label. The same track, where each toggle owns one key of the widget's form: a toggle with name and value is on while that key holds that value, pressing it sets the key or clears it, and toggles sharing a name are one choice. So one track sets several keys. Holds toggles. Binds the form itself: {"prop": "value", "state": "$this.form", "writable": true}.
- switch: aria-label (required). An on/off slider with no text of its own, so a person reads what it does from what's beside it, like the title of the list-item it ends. Binds checked: true or false.
- checkbox: aria-label (required), value, indeterminate. A box with no text of its own, read the same way as a switch. Binds checked: true or false.
- checkbox-group: label. A stack whose checkboxes each hold their value in one list, at any depth inside it. Binds value: the list of checked values.
- radio-group: aria-label. A stack of radios, always top to bottom, all in view. Holds radios: radio takes value, and its label as a child. Binds value.
- select: options, label, placeholder, multiple, required, variant. A trigger that opens a floating list, with its label on its face before the choice, so it needs no field-label. Several chosen show as the first, cut with an ellipsis, and "+2". Binds value: the chosen key, or a list with multiple. Rows that hold more than a label are written by hand instead of options: select holds a select-trigger (label, placeholder) and a select-panel of select-options (value; holds anything).
- combobox: options, label, placeholder, multiple, required, variant. A field you type in, with a floating list that narrows to what's typed. Only what's in options can be chosen. Binds value: the chosen key, or a list with multiple.
- listbox: options, label, multiple, checkable, required. An always-open toned sheet of rows; the picked one ends with a check. checkable leads each row with a check, and checking one switches to picking several. Binds value: the picked key, or a list with multiple. Rows that hold more than a label are written by hand instead of options: listbox holds listbox-options (value; holds anything).
- tag-input: options, label, placeholder, required, variant. A field of chips with a floating list under it that narrows as you type. Picking adds a chip, and a chip's x takes it out. Only what's in options can be chosen. Binds value: a list of keys.
- slider: aria-label, min, max, step, page, orientation. A wide toned track, filled up to a thumb you drag. It shows no number itself. Binds value: a number, or a pair [low, high], which draws two thumbs.
- stepper: label, min, max, step, page, decrementLabel, incrementLabel, readonly, required, variant. A number in a field with a - and + at its ends. Binds value: a number.
- number-stepper: label, min, max, step, readonly, required, variant. A plain number field with the browser's own spinner. Binds value: a number.
- code-input: label, length, kind ("numeric" or "alphanumeric"), masked, readonly, variant. A row of square cells side by side, one large character each, 6 by default. masked hides what's typed. Binds value: the whole string.
- text-input: label, placeholder, kind ("text", "password", "search", "email", "tel" or "url"), required, readonly, variant; multiline with rows. One line, or a text area that wraps. Binds value.
- search-input: label, placeholder, required, readonly, variant. The same with the search look. Binds value.
- date-picker: label, placeholder, min, max, inline, variant, labels. A field with a calendar button that opens a floating month. inline draws the month in place, always showing, with no field. Binds value: YYYY-MM-DD.
- date-range-picker: label, placeholder, min, max, inline, variant, labels. One field holding both ends with an arrow between them, or with inline a month in place. The first day pressed starts the range and the second ends it. labels also takes start and end, naming the two ends. Binds value: a pair [start, end], each YYYY-MM-DD.
- time-picker: label, inline, hourCycle (12 or 24), step (minutes), variant, labels. Hour and minute segments, captioned, with AM/PM on a 12-hour clock. Arrows, the wheel and a drag step a segment, and typing sets it. inline is always true. Binds value: HH:mm on a 24-hour clock.
- reorder: label, items, orientation. Rows you drag by a quiet grip at their end; the held row lifts and follows the pointer, and arrow keys move it from the grip. Items are {name, label, disabled}, or an object of name to label. orientation "horizontal" sets them side by side in equal widths. Binds value: the list of names in order.
- field: holds a field-label, one control, and any field-description, a quiet helper line. The label sits above the control. A control's own label is read by screen readers only, so a person sees no label on it without this; give the control the same label. It captions a progress or meter the same way.`;

/** The style props every component takes, with AUI's own values, so June can keep the user's look. */
const STYLES = `- variant: ${listOf(VARIANTS)}. glass is a frosted pane over what's behind. Form fields take only ${listOf(FIELD_VARIANTS)}.
- color: ${listOf(COLORS)}
- size: ${listOf(SIZES)}`;

const COMPOSER_PROMPT = fill(juneSkill, {
  vocabulary: VOCABULARY,
  styles: STYLES,
  date_labels: JSON.stringify(DATE_LABELS),
  time_labels: JSON.stringify(TIME_LABELS),
});

/** A set of AUI values as June's prompt lists them. */
function listOf(values: Record<string, string>): string {
  return Object.values(values).join(', ');
}
