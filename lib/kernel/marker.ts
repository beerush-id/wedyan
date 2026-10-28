/** A marker's opener: its type and its `key=value` attributes. */
export interface MarkerTag {
  type: string;
  attrs: Record<string, string>;
}

/** What the parser reports, in stream order. It reports grammar only; what a type means is the caller's. */
export interface MarkerEvents {
  /** Text outside any marker. */
  text(chunk: string): void;
  /** A marker opened. */
  open(tag: MarkerTag): void;
  /** Body text of the open marker, as it arrives. */
  body(tag: MarkerTag, chunk: string): void;
  /** The open marker closed; `body` is its whole body. */
  close(tag: MarkerTag, body: string): void;
  /** The stream ended while a marker was open; `body` is what arrived of it. */
  discard(tag: MarkerTag, body: string): void;
}

export interface MarkerParser {
  /** Feeds the next chunk of the model's output. */
  push(chunk: string): void;
  /** Ends the stream: an unfinished opener becomes text, an open marker is discarded. */
  end(): void;
}

/** Longest opener the parser waits for before treating the brackets as plain text. */
const MAX_OPENER_LENGTH = 512;

/**
 * Creates a streaming parser for the marker grammar `[[type key=value …]]body[[/type]]`. Markers are
 * flat: inside a body only that marker's own closer is recognized. A possible opener or closer split
 * across chunks is held back no further than the bracket that starts it, so text never stalls.
 *
 * @param events - Receives the text, marker and body events.
 * @returns The parser to push chunks into.
 */
export function createMarkerParser(events: MarkerEvents): MarkerParser {
  let pending = '';
  let open: { tag: MarkerTag; body: string } | undefined;

  const emitBody = (chunk: string) => {
    if (!open || !chunk) return;
    open.body += chunk;
    events.body(open.tag, chunk);
  };

  const emitText = (chunk: string) => {
    if (chunk) events.text(chunk);
  };

  const scanText = (): boolean => {
    const start = pending.indexOf('[');
    if (start < 0) {
      emitText(pending);
      pending = '';
      return false;
    }

    emitText(pending.slice(0, start));
    pending = pending.slice(start);

    const opener = scanOpener(pending);
    if (opener.kind === 'match') {
      pending = pending.slice(opener.length);
      open = { tag: { type: opener.type, attrs: opener.attrs }, body: '' };
      events.open(open.tag);
      return true;
    }
    if (opener.kind === 'partial' && pending.length <= MAX_OPENER_LENGTH) return false;

    emitText('[');
    pending = pending.slice(1);
    return true;
  };

  const scanBody = (current: { tag: MarkerTag; body: string }): boolean => {
    const start = pending.indexOf('[');
    if (start < 0) {
      emitBody(pending);
      pending = '';
      return false;
    }

    emitBody(pending.slice(0, start));
    pending = pending.slice(start);

    const closer = scanCloser(pending, current.tag.type);
    if (closer.kind === 'match') {
      pending = pending.slice(closer.length);
      open = undefined;
      events.close(current.tag, current.body);
      return true;
    }
    if (closer.kind === 'partial') return false;

    emitBody('[');
    pending = pending.slice(1);
    return true;
  };

  return {
    push(chunk) {
      pending += chunk;
      let progressing = true;
      while (progressing && pending) {
        progressing = open ? scanBody(open) : scanText();
      }
    },

    end() {
      if (open) {
        emitBody(pending);
        events.discard(open.tag, open.body);
        open = undefined;
      } else {
        emitText(pending);
      }
      pending = '';
    },
  };
}

type CloserScan = { kind: 'match'; length: number } | { kind: 'partial' } | { kind: 'fail' };

/** Most `[` and `/` a closer may carry before its type, as in `[/[/say]]`. */
const MAX_CLOSER_LEAD = 3;

/**
 * Scans the start of `source` for the closer of the open marker. Besides `[[/type]]` it accepts the
 * malformed closers models write (`[/type]]`, `[/[type]]`, `[/[/type]]`, `[[/type]`): a `[`, up to
 * three `[` or `/` with at least one `/`, the type, then one or two `]`.
 *
 * @param source - Text starting with `[`.
 * @param type - The open marker's type.
 * @returns `match` with the closer's length, `partial` when more input could still complete it, or
 * `fail` when it can never close this marker.
 */
function scanCloser(source: string, type: string): CloserScan {
  const partial: CloserScan = { kind: 'partial' };
  const fail: CloserScan = { kind: 'fail' };
  let i = 1;
  let slashed = false;

  while (i < source.length && (source[i] === '[' || source[i] === '/') && i <= MAX_CLOSER_LEAD) {
    if (source[i] === '/') slashed = true;
    i += 1;
  }
  if (i >= source.length) return partial;
  if (!slashed) return fail;

  for (const char of type) {
    if (i >= source.length) return partial;
    if (source[i] !== char) return fail;
    i += 1;
  }

  if (i >= source.length) return partial;
  if (source[i] !== ']') return fail;
  i += 1;
  if (i >= source.length) return partial;
  return { kind: 'match', length: source[i] === ']' ? i + 1 : i };
}

type OpenerMatch = { kind: 'match'; length: number; type: string; attrs: Record<string, string> };
type OpenerScan = OpenerMatch | { kind: 'partial' } | { kind: 'fail' };

const TYPE_START = /[a-z]/;
const TYPE_CHAR = /[a-z0-9_-]/;
const KEY_START = /[a-zA-Z_]/;
const KEY_CHAR = /[\w.-]/;
const SPACE = /\s/;

/**
 * Scans the start of `source` for a marker opener.
 *
 * @param source - Text starting with `[`.
 * @returns `match` with the opener's parts, `partial` when more input could still complete it,
 * or `fail` when it can never be an opener.
 */
function scanOpener(source: string): OpenerScan {
  const partial: OpenerScan = { kind: 'partial' };
  const fail: OpenerScan = { kind: 'fail' };
  let i = 0;

  for (const bracket of '[[') {
    if (i >= source.length) return partial;
    if (source[i] !== bracket) return fail;
    i += 1;
  }

  if (i >= source.length) return partial;
  if (!TYPE_START.test(source[i])) return fail;
  const typeStart = i;
  while (i < source.length && TYPE_CHAR.test(source[i])) i += 1;
  const type = source.slice(typeStart, i);
  const attrs: Record<string, string> = {};

  for (;;) {
    if (i >= source.length) return partial;

    if (source[i] === ']') {
      if (i + 1 >= source.length) return partial;
      return source[i + 1] === ']' ? { kind: 'match', length: i + 2, type, attrs } : fail;
    }

    if (!SPACE.test(source[i])) return fail;
    while (i < source.length && SPACE.test(source[i])) i += 1;
    if (i >= source.length) return partial;
    if (source[i] === ']') continue;

    if (!KEY_START.test(source[i])) return fail;
    const keyStart = i;
    while (i < source.length && KEY_CHAR.test(source[i])) i += 1;
    if (i >= source.length) return partial;
    if (source[i] !== '=') return fail;
    const key = source.slice(keyStart, i);
    i += 1;
    if (i >= source.length) return partial;

    if (source[i] === '"') {
      const quoteEnd = source.indexOf('"', i + 1);
      if (quoteEnd < 0) return partial;
      attrs[key] = source.slice(i + 1, quoteEnd);
      i = quoteEnd + 1;
    } else {
      const valueStart = i;
      while (i < source.length && !SPACE.test(source[i]) && source[i] !== '"' && source[i] !== ']') i += 1;
      if (i === valueStart) return fail;
      if (i >= source.length) return partial;
      if (source[i] === '"') return fail;
      attrs[key] = source.slice(valueStart, i);
    }
  }
}
