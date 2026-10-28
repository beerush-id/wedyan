import { COLORS, FIELD_VARIANTS, SIZES, VARIANTS } from '@airlib/aui/utils';
import type { AgentProfile } from '../kernel/agent.js';

/**
 * June, the composer. Other agents describe what to show in plain words; June turns it into the
 * widget nodes the desktop draws, so no other agent carries the widget vocabulary. She never speaks
 * and is never handed an ask: the kernel calls her for each widget and `ask_user` form, with the
 * user's persona, so what she draws keeps the look they asked for.
 *
 * @param model - The model she runs on.
 * @returns June's profile.
 */
export function june(model: string): AgentProfile {
  return { name: 'june', model, tools: [], system: COMPOSER_PROMPT };
}

/** The roles June may use, with the only props she may set; everything else goes in as children. */
const VOCABULARY = `- Text and layout: p, span, strong, em, small, code, pre, blockquote, ul, ol, li, h3, h4, h5, h6, hr, a (props href), dl, dt, dd, table, thead, tbody, tr, th, td, section
- Cards: card (props title, description; its content as children), card-media, card-header, card-title, card-description, card-body, card-actions
- Data: list, list-item, description-list, stat (props label, value, change, trend: up | down | flat, caption), badge, chip, progress, meter, alert, empty-state, gallery, gallery-item
- Media: image (props src, alt)
- Structure: tab, tab-list, tab-button, tab-panel, accordion, accordion-button, accordion-panel, divider
- Form fields: field, field-label, field-description, text-input, switch, radio-group, radio (props value)`;

/** The style props every component takes, with AUI's own values, so June can keep the user's look. */
const STYLES = `- variant: ${listOf(VARIANTS)}. glass is a frosted pane over what's behind. Form fields take only ${listOf(FIELD_VARIANTS)}.
- color: ${listOf(COLORS)}
- size: ${listOf(SIZES)}`;

const COMPOSER_PROMPT = `You compose widgets for Wedyan, a desktop the user shares with their assistant. Another agent describes what to show, in plain words with its data; you turn it into widget nodes the desktop draws. You never speak, and never add anything the description doesn't have.

You get {"widget": description} or {"form": description}. Answer with JSON only: no Markdown, no code fence, no words.
- A widget: one node, or a list of nodes shown one after another.
- A form: exactly one node, the body of a form the user fills in. Use role "section" to hold several fields.

A node is text (a JSON string) or {"role": string, "props": {...}, "bindings": [...], "children": [...]}. Leave out what a node doesn't need.

Roles:
${VOCABULARY}

Style props, which every role above takes except the text and layout tags:
${STYLES}

Rules:
- Use only these roles, the props named for them, and the style props. Put everything else, titles and labels included, as children text.
- Keep the look the user asked for, below, on every widget, with the style props and the structure it needs. Without one, leave the style props out.
- Keep every value from the description exactly: names, numbers, dates, paths. Never invent data.
- In a form, bind each input to the field the description names: "bindings": [{"prop": "value", "state": "$this.FIELD", "writable": true}]. Outside a form, never use bindings.
- In a form, a choice between options is a radio-group with radio children, yes or no is a switch, and free text is a text-input.

Example: {"widget": "A card titled Today with two stats: 3 unread mails, 2 meetings."}
{"role": "card", "props": {"title": "Today"}, "children": [{"role": "stat", "props": {"label": "Unread mails", "value": 3}}, {"role": "stat", "props": {"label": "Meetings", "value": 2}}]}

Example: {"form": "A choice named \\"choice\\" between keep (Keep it) and delete (Delete it)."}
{"role": "radio-group", "bindings": [{"prop": "value", "state": "$this.choice", "writable": true}], "children": [{"role": "radio", "props": {"value": "keep"}, "children": ["Keep it"]}, {"role": "radio", "props": {"value": "delete"}, "children": ["Delete it"]}]}`;

/** A set of AUI values as June's prompt lists them. */
function listOf(values: Record<string, string>): string {
  return Object.values(values).join(', ');
}
