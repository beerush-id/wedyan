import { describe, expect, it } from 'vitest';
import { createMarkerParser, type MarkerEvents, type MarkerTag } from '../../lib/kernel/marker.js';

type Event =
  | ['text', string]
  | ['open', MarkerTag]
  | ['body', string, string]
  | ['close', string, string]
  | ['discard', string, string];

/** Records every event, merging consecutive text and body chunks so assertions read as the stream does. */
function setup() {
  const events: Event[] = [];
  const merge = (event: Event) => {
    const last = events.at(-1);
    if (last && last[0] === 'text' && event[0] === 'text') last[1] += event[1];
    else if (last && last[0] === 'body' && event[0] === 'body' && last[1] === event[1]) last[2] += event[2];
    else events.push(event);
  };
  const handlers: MarkerEvents = {
    text: (chunk) => merge(['text', chunk]),
    open: (tag) => merge(['open', tag]),
    body: (tag, chunk) => merge(['body', tag.type, chunk]),
    close: (tag, body) => merge(['close', tag.type, body]),
    discard: (tag, body) => merge(['discard', tag.type, body]),
  };
  return { events, parser: createMarkerParser(handlers) };
}

describe('marker parser', () => {
  it('passes plain text through', () => {
    const { events, parser } = setup();
    parser.push('Good morning. ');
    parser.push('Two things finished.');
    parser.end();

    expect(events).toEqual([['text', 'Good morning. Two things finished.']]);
  });

  it('opens, streams the body of, and closes a marker', () => {
    const { events, parser } = setup();
    parser.push('Hi.[[say]]Opening it.[[/say]] Done.');
    parser.end();

    expect(events).toEqual([
      ['text', 'Hi.'],
      ['open', { type: 'say', attrs: {} }],
      ['body', 'say', 'Opening it.'],
      ['close', 'say', 'Opening it.'],
      ['text', ' Done.'],
    ]);
  });

  it('streams a body as it arrives, before the marker closes', () => {
    const { events, parser } = setup();
    parser.push('[[say]]Open');
    expect(events).toEqual([
      ['open', { type: 'say', attrs: {} }],
      ['body', 'say', 'Open'],
    ]);

    parser.push('ing.[[/say]]');
    expect(events.at(-1)).toEqual(['close', 'say', 'Opening.']);
  });

  it('parses the same stream identically when every character arrives alone', () => {
    const stream = 'A.[[action name=app.open]]{"app":"motion"}[[/action]][[say]]B.[[/say]]';
    const whole = setup();
    whole.parser.push(stream);
    whole.parser.end();

    const split = setup();
    for (const char of stream) split.parser.push(char);
    split.parser.end();

    expect(split.events).toEqual(whole.events);
  });

  it('holds back only a possible opener, never the text before it', () => {
    const { events, parser } = setup();
    parser.push('Opening it [');
    expect(events).toEqual([['text', 'Opening it ']]);

    parser.push('[wid');
    expect(events).toEqual([['text', 'Opening it ']]);
  });

  it('releases brackets that cannot start a marker', () => {
    const { events, parser } = setup();
    parser.push('array [x] and [');
    parser.push(' y]');
    parser.end();

    expect(events).toEqual([['text', 'array [x] and [ y]']]);
  });

  it('treats malformed openers as text', () => {
    const { events, parser } = setup();
    parser.push('[[ spaced ]] and [[Upper]] and [[a b=]]');
    parser.end();

    expect(events).toEqual([['text', '[[ spaced ]] and [[Upper]] and [[a b=]]']]);
  });

  it('gives up on an opener longer than the limit', () => {
    const { events, parser } = setup();
    const long = `[[widget title="${'x'.repeat(600)}"`;
    parser.push(long);

    expect(events).toEqual([['text', long]]);
  });

  it('reads quoted and unquoted attributes', () => {
    const { events, parser } = setup();
    parser.push('[[action name=app.open label="Two words"]]{}[[/action]]');
    parser.end();

    expect(events[0]).toEqual(['open', { type: 'action', attrs: { name: 'app.open', label: 'Two words' } }]);
  });

  it('keeps markers flat: an opener or foreign closer inside a body is body text', () => {
    const { events, parser } = setup();
    parser.push('[[show]]Use [[widget]] and [[/widget]] here[[/show]]');
    parser.end();

    expect(events.at(-1)).toEqual(['close', 'show', 'Use [[widget]] and [[/widget]] here']);
  });

  it('accepts the malformed closers models write for the open marker', () => {
    for (const closer of ['[/say]]', '[/[say]]', '[/[/say]]', '[[/say]']) {
      const { events, parser } = setup();
      parser.push(`[[say]]Done.${closer} After.`);
      parser.end();

      expect(events, closer).toEqual([
        ['open', { type: 'say', attrs: {} }],
        ['body', 'say', 'Done.'],
        ['close', 'say', 'Done.'],
        ['text', ' After.'],
      ]);
    }
  });

  it('accepts a malformed closer split across chunks', () => {
    const { events, parser } = setup();
    for (const char of '[[say]]Hi.[/[/say]]Next') parser.push(char);
    parser.end();

    expect(events.at(-2)).toEqual(['close', 'say', 'Hi.']);
    expect(events.at(-1)).toEqual(['text', 'Next']);
  });

  it('takes its own opener for the closer when nothing comes after it, so it never shows', () => {
    const whole = setup();
    whole.parser.push('[[say]]Want one?[[say]]');
    whole.parser.end();
    expect(whole.events.at(-1)).toEqual(['close', 'say', 'Want one?']);

    const split = setup();
    for (const char of '[[say]]Want one?[[say]]') split.parser.push(char);
    split.parser.end();
    expect(split.events.at(-1)).toEqual(['close', 'say', 'Want one?']);
  });

  it('does not take a bracket without a slash, or another type, for a closer', () => {
    const { events, parser } = setup();
    parser.push('[[say]]a [[say]] b [/show]] c[[/say]]');
    parser.end();

    expect(events.at(-1)).toEqual(['close', 'say', 'a [[say]] b [/show]] c']);
  });

  it('holds back a possible closer inside a body', () => {
    const { events, parser } = setup();
    parser.push('[[show]]Line one [[/sh');
    expect(events.at(-1)).toEqual(['body', 'show', 'Line one ']);

    parser.push('ow]]');
    expect(events.at(-1)).toEqual(['close', 'show', 'Line one ']);
  });

  it('flushes an unfinished opener as text when the stream ends', () => {
    const { events, parser } = setup();
    parser.push('Almost [[wid');
    parser.end();

    expect(events).toEqual([['text', 'Almost [[wid']]);
  });

  it('discards a marker still open when the stream ends, with the body received so far', () => {
    const { events, parser } = setup();
    parser.push('[[action name=fs.write]]{"path":"~/a.txt"');
    parser.end();

    expect(events.at(-1)).toEqual(['discard', 'action', '{"path":"~/a.txt"']);
  });
});
