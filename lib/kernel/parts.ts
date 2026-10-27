import type { IRPCData } from '@irpclib/irpc';
import type { AskAction, AskPart, TextPart } from './agent.h.js';
import type { MarkerEvents, MarkerTag } from './marker.js';

/** Where the writer sends what isn't a part: actions to run, and problems the model must hear about. */
export interface PartWriterHooks {
  onAction(action: AskAction): void;
  onInvalid(problem: string): void;
}

/** Marker events in, parts out. `flush` pushes the text gathered since the last flush as one chunk. */
export interface PartWriter extends MarkerEvents {
  flush(): void;
  end(): void;
}

/** Longest stretch of a bad body quoted back to the model. */
const QUOTE_LIMIT = 200;

/**
 * Translates the model's markers into the answer's parts. Text outside markers and `show` become
 * silent text parts, `say` a spoken one; their text streams as chunks. A `widget` is added whole when
 * it closes; an `action` goes to `onAction`, anchored after the part before it. Anything malformed
 * goes to `onInvalid` instead of the answer. Unknown marker types are shown as silent text.
 *
 * @param parts - The answer's parts; mutated in place, so a reactive list streams each push.
 * @param hooks - Receives actions and problems.
 * @returns The writer to give the marker parser.
 */
export function createPartWriter(parts: AskPart[], hooks: PartWriterHooks): PartWriter {
  let current: TextPart | undefined;
  let explicit = false;
  let pending = '';

  const flush = () => {
    if (!current || !pending) return;
    current.chunks.push(pending);
    pending = '';
  };

  const openText = (spoken: boolean, fromMarker: boolean) => {
    parts.push({ type: 'text', chunks: [], spoken });
    // Mutate through the stored element, so a reactive list sees every later change.
    current = parts[parts.length - 1] as TextPart;
    explicit = fromMarker;
  };

  const closeText = () => {
    if (!current) return;
    flush();
    current.text = current.chunks.join('');
    current = undefined;
    explicit = false;
  };

  const addWidget = (body: string) => {
    const node = parseJson(body);
    if (!isRecord(node) || typeof node.role !== 'string') {
      hooks.onInvalid(`A widget needs a JSON object with a "role"; got: ${quote(body)}`);
      return;
    }
    parts.push({ ...node, type: 'widget', role: node.role });
  };

  const addAction = (tag: MarkerTag, body: string) => {
    const name = tag.attrs.name;
    if (!name) {
      hooks.onInvalid('An action needs a name attribute');
      return;
    }
    const args = body.trim() ? parseJson(body) : {};
    if (args === undefined) {
      hooks.onInvalid(`Action ${name} needs JSON arguments; got: ${quote(body)}`);
      return;
    }
    hooks.onAction({ name, args, after: parts.length - 1 });
  };

  return {
    text(chunk) {
      if (!current) {
        const start = chunk.trimStart();
        if (!start) return;
        openText(false, false);
        pending += start;
        return;
      }
      pending += chunk;
    },

    open(tag) {
      closeText();
      if (tag.type !== 'widget' && tag.type !== 'action') openText(tag.type === 'say', true);
    },

    body(_tag, chunk) {
      if (current && explicit) pending += chunk;
    },

    close(tag, body) {
      if (tag.type === 'widget') addWidget(body);
      else if (tag.type === 'action') addAction(tag, body);
      else closeText();
    },

    discard(tag) {
      if (tag.type !== 'widget' && tag.type !== 'action') closeText();
    },

    flush,
    end: closeText,
  };
}

/** Parses JSON, or undefined when it isn't JSON. */
function parseJson(text: string): IRPCData | undefined {
  try {
    return JSON.parse(text) as IRPCData;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, IRPCData> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A body as quoted back to the model, clipped. */
function quote(body: string): string {
  return body.length > QUOTE_LIMIT ? `${body.slice(0, QUOTE_LIMIT)}…` : body;
}
