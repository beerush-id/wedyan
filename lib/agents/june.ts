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
  return { name: 'june', model, tools: [], system: COMPOSER_PROMPT };
}

/** What a date picker's and a time picker's own controls read out, as AUI requires them. */
const DATE_LABELS = { previous: 'Previous month', next: 'Next month', year: 'Year' };
const TIME_LABELS = { hour: 'Hour', minute: 'Minute', period: 'Half of the day' };

/** The roles June may use, with the only props she may set; everything else goes in as children. */
const VOCABULARY = `- Text and layout: p, span, strong, em, small, code, pre, blockquote, ul, ol, li, h3, h4, h5, h6, hr, a (props href), dl, dt, dd, table, thead, tbody, tr, th, td, section
- A widget's own parts, at its top level: card-media, card-header, card-title, card-description, card-body, card-actions
- Cards inside a widget, for a set of things that are each their own card: card (props title, description; its content as children)
- Data: list, list-item, description-list, stat (props label, value, change, trend: up | down | flat, caption), badge, chip, progress, meter, alert, empty-state
- Pictures to look at, one or many: gallery (props label, items: a list of {value, src, alt, title}; value is the picture's path, src its path in the home, ~/… as given)
- A small round picture of a person, only: avatar (props src, alt). Never use it for a picture to look at.
- Structure: tab, tab-list, tab-button, tab-panel, accordion, accordion-button, accordion-panel, divider
- Form fields: field, field-label, text-input (props label, placeholder), date-picker (props label, placeholder, labels: ${JSON.stringify(DATE_LABELS)}; its value is YYYY-MM-DD), time-picker (props label, inline, labels: ${JSON.stringify(TIME_LABELS)}; its value is HH:mm; inline always true), switch, radio-group, radio (props value)
- Desktop forms, whole forms the desktop draws itself: onboarding (a new user's first form: it asks how to call them and what to call the assistant, and saves their profile)`;

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
