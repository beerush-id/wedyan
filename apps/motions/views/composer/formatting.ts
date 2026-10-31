/** A way to format the Markdown selected in a text field. */
export type Formatting = 'bold' | 'italic' | 'heading' | 'list';

/**
 * Formats the Markdown selected in a text field, or takes the formatting off when it's already
 * there: bold and italic wrap the selected words in their marks; a heading and a list mark each line
 * the selection touches. The words stay selected, and each change is made as if typed: it can be
 * undone, and whatever the field's value is bound to keeps up.
 *
 * @param field - The field holding the selection.
 * @param formatting - What to do with it.
 */
export function formatSelection(field: HTMLTextAreaElement | HTMLInputElement, formatting: Formatting): void {
  if (formatting === 'bold') wrap(field, 2);
  else if (formatting === 'italic') wrap(field, 1);
  else if (formatting === 'heading') markLines(field, /^#+\s+/, '## ');
  else markLines(field, /^[-*+]\s+/, '- ');
}

/**
 * Wraps the selected words in stars — two for bold, one for italic — or unwraps them when those stars
 * are already there, just inside the selection's edges or just outside them. Both marks are stars, so
 * a run of them reads as bold from two, and as italic when odd: `***` is both.
 *
 * @param field - The field holding the selection.
 * @param stars - How many stars the mark is.
 */
function wrap(field: HTMLTextAreaElement | HTMLInputElement, stars: 1 | 2): void {
  const { value } = field;
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  const text = value.slice(start, end);
  const has = (run: number) => (stars === 2 ? run >= 2 : run % 2 === 1);
  const inner = Math.min(leadingStars(text), trailingStars(text));
  const outer = Math.min(trailingStars(value.slice(0, start)), leadingStars(value.slice(end)));

  if (text.length > inner * 2 && has(inner)) {
    replace(field, text.slice(stars, -stars), start, end);
    field.setSelectionRange(start, end - stars * 2);
  } else if (has(outer)) {
    replace(field, text, start - stars, end + stars);
    field.setSelectionRange(start - stars, end - stars);
  } else {
    const mark = '*'.repeat(stars);
    replace(field, `${mark}${text}${mark}`, start, end);
    field.setSelectionRange(start + stars, end + stars);
  }
}

/**
 * Marks each line the selection touches — as a heading, as a list item — or, when every line with
 * words on it is marked already, takes the mark off them all. Blank lines are left as they are.
 *
 * @param field - The field holding the selection.
 * @param pattern - What the mark looks like at a line's start, in any of its forms.
 * @param mark - The mark to put there.
 */
function markLines(field: HTMLTextAreaElement | HTMLInputElement, pattern: RegExp, mark: string): void {
  const { value } = field;
  const start = field.selectionStart ?? 0;
  const selectionEnd = field.selectionEnd ?? 0;
  // A selection ending just past a line break ends on the line before it.
  const end = selectionEnd > start && value[selectionEnd - 1] === '\n' ? selectionEnd - 1 : selectionEnd;
  const from = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
  const next = value.indexOf('\n', end);
  const to = next < 0 ? value.length : next;

  const lines = value.slice(from, to).split('\n');
  const marked = lines.every((line) => !line.trim() || pattern.test(line));
  const text = lines
    .map((line) => (!line.trim() ? line : marked ? line.replace(pattern, '') : mark + line))
    .join('\n');
  replace(field, text, from, to);
  field.setSelectionRange(from, from + text.length);
}

/**
 * Puts text in place of part of a field's value the way typing does, so the change lands in the
 * field's undo history and the field hears an input. Only `execCommand` reaches that history; where
 * a browser no longer runs it, the text is put in directly, and the input is sent by hand.
 *
 * @param field - The field, which has focus.
 * @param text - The text to put in.
 * @param from - Where the part replaced starts in the value.
 * @param to - Where it ends.
 */
function replace(field: HTMLTextAreaElement | HTMLInputElement, text: string, from: number, to: number): void {
  field.setSelectionRange(from, to);
  if (document.execCommand('insertText', false, text)) return;
  field.setRangeText(text, from, to);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/** How many stars a piece of text starts with. */
function leadingStars(text: string): number {
  return text.match(/^\**/)![0].length;
}

/** How many stars a piece of text ends with. */
function trailingStars(text: string): number {
  return text.match(/\**$/)![0].length;
}
