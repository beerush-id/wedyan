import type { DockWidgetEntry } from '@airlib/react-aui/desktop';
import { describe, expect, it } from 'vitest';
import type { AskPart } from '../../lib/kernel/agent.h.js';
import type { AgentMessage, ConversationMessage, UserMessage } from '../../lib/kernel/chat.h.js';
import { createWidgets } from '../../lib/share/widgets.js';

// The conversation as the dock's list: only what the dock is given, as the dock takes it.

const words = (id: string, text: string): UserMessage => ({ id, role: 'user', created: '', text, client: 'tab' });

const answer = (id: string, parts: AskPart[], status: AgentMessage['status'] = 'running'): AgentMessage => ({
  id,
  role: 'agent',
  created: '',
  status,
  agent: 'wendy',
  turn: 1,
  parts,
  actions: [],
});

/** A list, drawing the user's words with their picks, as the desktop's own does. */
const list = () =>
  createWidgets(({ id, text, selections }) => ({
    id,
    from: 'user',
    view: `${text} (${selections?.length ?? 0} picked)`,
  }));

const composed = (fields = {}): AskPart => ({
  type: 'widget',
  id: 'w1',
  status: 'ready',
  intent: 'A meeting form',
  nodes: [{ role: 'card-header' }],
  ...fields,
});

describe('the dock’s list', () => {
  it('draws the user’s words as a turn, once, with what they picked', () => {
    const { widgets, sync } = list();
    const messages: ConversationMessage[] = [{ ...words('u1', 'generate from @xyz'), selections: [{ label: 'xyz' }] }];

    sync(messages);
    sync(messages);

    expect(widgets).toEqual([{ id: 'u1', from: 'user', view: 'generate from @xyz (1 picked)' }]);
  });

  it('adds an answer once it has something to show, and grows it in place', () => {
    const { widgets, sync } = list();
    const parts: AskPart[] = [];
    const message = answer('a1', parts);

    sync([message]);
    expect(widgets).toHaveLength(0);

    parts.push({ type: 'text', chunks: ['Hel'], spoken: true });
    sync([message]);
    const entry = widgets[0];
    const part = entry.children?.[0];
    expect(part).toEqual({ type: 'text', text: 'Hel' });

    (parts[0] as { chunks: string[] }).chunks.push('lo');
    sync([message]);
    expect(widgets).toHaveLength(1);
    expect(widgets[0]).toBe(entry);
    expect(part).toEqual({ type: 'text', text: 'Hello' });
  });

  it('adds a widget whole, once it’s composed, and leaves out what never was', () => {
    const { widgets, sync } = list();
    const parts: AskPart[] = [composed({ status: 'pending', nodes: [] })];
    const message = answer('a1', parts);

    sync([message]);
    expect(widgets).toHaveLength(0);

    Object.assign(parts[0], { status: 'ready', nodes: [{ role: 'card-header' }] });
    sync([message]);
    expect(widgets[0].children).toEqual([
      { type: 'widget', id: 'w1', status: 'pending', children: [{ role: 'card-header' }] },
    ]);

    const failed = answer('a2', [composed({ id: 'w2', status: 'error' })]);
    sync([message, failed]);
    expect(widgets).toHaveLength(1);
  });

  it('marks a form as waiting on the user until it’s settled, with its facts', () => {
    const { widgets, sync } = list();
    const form = composed({ form: { title: 'Draft' }, formAction: 'system.calendar.createEvent', once: true });
    const message = answer('a1', [form], 'done');

    sync([message]);
    expect(widgets[0].important).toBe(true);
    expect(widgets[0].children?.[0]).toMatchObject({
      status: 'pending',
      form: { title: 'Draft' },
      formAction: 'system.calendar.createEvent',
      once: true,
    });

    Object.assign(form, { form: { title: 'Trailer review' }, settled: '2026-11-01T10:00:00Z' });
    sync([message]);
    expect(widgets[0].important).toBe(false);
    expect(widgets[0].children?.[0]).toMatchObject({ status: 'settled', form: { title: 'Trailer review' } });
  });

  it('shows why an answer failed as words', () => {
    const { widgets, sync } = list();

    sync([{ ...answer('a1', [], 'error'), reason: 'No answer from the model' }]);

    expect(widgets[0].children).toEqual([{ type: 'text', text: 'No answer from the model' }]);
  });

  it('lets the desktop keep its own entries, and never brings back what was dismissed', () => {
    const { widgets, sync } = list();
    const messages: ConversationMessage[] = [words('u1', 'Hello')];
    sync(messages);

    (widgets as DockWidgetEntry[]).push({ id: 'local', view: 'Copied' });
    widgets.splice(0, 1);
    sync(messages);

    expect(widgets.map(({ id }) => id)).toEqual(['local']);
  });
});
