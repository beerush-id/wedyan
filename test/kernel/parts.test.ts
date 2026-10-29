import { mutable } from '@airlib/react';
import { describe, expect, it } from 'vitest';
import type { AskAction, AskPart, WidgetPart } from '../../lib/kernel/agent.h.js';
import { createMarkerParser } from '../../lib/kernel/marker.js';
import { createPartWriter } from '../../lib/kernel/parts.js';

function setup() {
  const state = mutable<{ parts: AskPart[] }>({ parts: [] });
  const actions: AskAction[] = [];
  const widgets: { part: WidgetPart; intent: string }[] = [];
  const problems: string[] = [];
  const writer = createPartWriter(state.parts, {
    onWidget: (part, intent) => widgets.push({ part, intent }),
    onAction: (action) => actions.push(action),
    onInvalid: (problem) => problems.push(problem),
  });
  const parser = createMarkerParser(writer);
  /** Pushes each chunk the way the loop does: parse, then flush once. */
  const feed = (...chunks: string[]) => {
    for (const chunk of chunks) {
      parser.push(chunk);
      writer.flush();
    }
  };
  const end = () => {
    parser.end();
    writer.end();
  };
  return { state, actions, widgets, problems, feed, end };
}

describe('part writer', () => {
  it('turns text outside markers into a silent text part', () => {
    const { state, feed, end } = setup();
    feed('| a | b |\n', '|---|---|');
    end();

    expect(state.parts).toEqual([
      { type: 'text', chunks: ['| a | b |\n', '|---|---|'], text: '| a | b |\n|---|---|', spoken: false },
    ]);
  });

  it('turns say into a spoken text part that streams before it closes', () => {
    const { state, feed, end } = setup();
    feed('[[say]]Two things ');
    expect(state.parts).toEqual([{ type: 'text', chunks: ['Two things '], spoken: true }]);

    feed('finished.[[/say]]');
    expect(state.parts[0]).toEqual({
      type: 'text',
      chunks: ['Two things ', 'finished.'],
      text: 'Two things finished.',
      spoken: true,
    });
    end();
  });

  it('turns show into a silent text part', () => {
    const { state, feed, end } = setup();
    feed('[[show]]# Mail[[/show]]');
    end();

    expect(state.parts).toEqual([{ type: 'text', chunks: ['# Mail'], text: '# Mail', spoken: false }]);
  });

  it('pushes one chunk per fed chunk, however the parser split it', () => {
    const { state, feed, end } = setup();
    feed('[[say]]a [', 'x] b[[/say]]');
    end();

    expect((state.parts[0] as { chunks: string[] }).chunks).toEqual(['a ', '[x] b']);
  });

  it('adds a pending widget when it closes, and hands its part over with what it should show', () => {
    const { state, widgets, feed, end } = setup();
    feed('[[widget]]A card titled Ma');
    expect(state.parts).toEqual([]);

    feed('il, with 3 unread.[[/widget]]');
    end();
    expect(state.parts).toEqual([
      { type: 'widget', status: 'pending', intent: 'A card titled Mail, with 3 unread.', nodes: [] },
    ]);
    expect(widgets).toEqual([{ part: state.parts[0], intent: 'A card titled Mail, with 3 unread.' }]);
    // The stored element itself, so filling it later reaches the reactive list.
    expect(widgets[0].part).toBe(state.parts[0]);
  });

  it('splits text around markers into separate parts, in order', () => {
    const { state, feed, end } = setup();
    feed('Intro [[say]]Hi.[[/say]] middle [[widget]]A card[[/widget]] outro');
    end();

    expect(state.parts.map((part) => [part.type, part.type === 'text' ? part.text : part.status])).toEqual([
      ['text', 'Intro '],
      ['text', 'Hi.'],
      ['text', 'middle '],
      ['widget', 'pending'],
      ['text', 'outro'],
    ]);
  });

  it('drops whitespace-only text between markers', () => {
    const { state, feed, end } = setup();
    feed('[[say]]A.[[/say]]\n\n  [[say]]B.[[/say]]\n');
    end();

    expect(state.parts.map((part) => (part as { text: string }).text)).toEqual(['A.', 'B.']);
  });

  it('reports an action anchored after the part before it', () => {
    const { state, actions, feed, end } = setup();
    feed('[[say]]Opening Photos[[/say]][[action name=app.open]]{"app":"photos"}[[/action]]');
    feed('[[say]]then Motion.[[/say]][[action name=app.open]]{"app":"motion"}[[/action]]');
    end();

    expect(state.parts).toHaveLength(2);
    expect(actions).toEqual([
      { name: 'app.open', args: { app: 'photos' }, after: 0 },
      { name: 'app.open', args: { app: 'motion' }, after: 1 },
    ]);
  });

  it('anchors an action before any part at -1, and closes open text first', () => {
    const { actions, feed, end } = setup();
    feed('[[action name=desktop.tile]][[/action]]Tiled [[action name=desktop.focus]]{}[[/action]]');
    end();

    expect(actions).toEqual([
      { name: 'desktop.tile', args: {}, after: -1 },
      { name: 'desktop.focus', args: {}, after: 0 },
    ]);
  });

  it('reports a widget that describes nothing, and drops it', () => {
    const { state, widgets, problems, feed, end } = setup();
    feed('[[widget]]  [[/widget]]');
    end();

    expect(state.parts).toEqual([]);
    expect(widgets).toEqual([]);
    expect(problems).toEqual(['A widget needs a description of what to show']);
  });

  it('reports an action without a name or with arguments that are not JSON', () => {
    const { actions, problems, feed, end } = setup();
    feed('[[action]]{}[[/action]][[action name=app.open]]{bad[[/action]]');
    end();

    expect(actions).toEqual([]);
    expect(problems).toEqual(['An action needs a name attribute', 'Action app.open needs JSON arguments; got: {bad']);
  });

  it('keeps the text of a say cut off by the end of the stream, and drops a cut-off widget or action', () => {
    const { state, actions, feed, end } = setup();
    feed('[[say]]Half a sen');
    end();

    expect(state.parts).toEqual([{ type: 'text', chunks: ['Half a sen'], text: 'Half a sen', spoken: true }]);

    const second = setup();
    second.feed('[[widget]]A card titled Ma');
    second.end();
    expect(second.state.parts).toEqual([]);
    expect(second.widgets).toEqual([]);
    expect(actions).toEqual([]);
  });

  it('reports an ask_user with its form described, as an ask anchored like an action', () => {
    const { state, actions, feed, end } = setup();
    feed('[[say]]Which one?[[/say]]', '[[ask_user]] A choice named "choice" between keep and delete. [[/ask_user]]');
    end();

    expect(state.parts).toHaveLength(1);
    expect(actions).toEqual([
      { name: 'ask_user', args: 'A choice named "choice" between keep and delete.', after: 0, ask: true },
    ]);
  });

  it('reports an ask_app by its name, with its arguments', () => {
    const { state, actions, feed, end } = setup();
    feed('[[ask_app name=app.photos.selection]]{"album":"cats"}[[/ask_app]]');
    end();

    expect(state.parts).toEqual([]);
    expect(actions).toEqual([{ name: 'app.photos.selection', args: { album: 'cats' }, after: -1, ask: true }]);
  });

  it('reports an ask_user that describes no form, and an ask_app without a name', () => {
    const { actions, problems, feed, end } = setup();
    feed('[[ask_user]][[/ask_user]]', '[[ask_app]]{}[[/ask_app]]');
    end();

    expect(actions).toEqual([]);
    expect(problems).toEqual(['ask_user needs a description of the form', 'An ask_app needs a name attribute']);
  });

  it('shows the body of an unknown marker as silent text', () => {
    const { state, feed, end } = setup();
    feed('[[note]]Remember this[[/note]]');
    end();

    expect(state.parts).toEqual([{ type: 'text', chunks: ['Remember this'], text: 'Remember this', spoken: false }]);
  });
});
