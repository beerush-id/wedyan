import type { ChatMessage } from '@irpclib/ai-kit';
import { vi } from 'vitest';

// The model provider is the only thing kernel tests mock: every request to it is answered from a
// queue of Chat Completions streams in the provider's wire format.

type Delta = Record<string, unknown>;

/** A Chat Completions SSE stream of the given deltas, ending with the finish reason and `[DONE]`. */
export function sse(deltas: Delta[], finish: string): Response {
  const events = [
    ...deltas.map((delta) => ({ choices: [{ index: 0, delta, finish_reason: null }] })),
    { choices: [{ index: 0, delta: {}, finish_reason: finish }] },
  ];
  return new Response(`${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/** A model turn that only speaks, streamed in the given parts. */
export function says(...parts: string[]): Response {
  return sse(
    parts.map((content) => ({ content })),
    'stop',
  );
}

/** A model turn that makes calls; names are as the provider sees them (`sys__fs__read`). */
export function calls(...list: Array<{ id: string; name: string; args: unknown }>): Response {
  return sse([{ tool_calls: list.map((call, index) => toolCall(call.id, call.name, call.args, index)) }], 'tool_calls');
}

/** One streamed tool-call delta. */
export function toolCall(id: string, name: string, args: unknown, index = 0) {
  return { index, id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** One item of a Responses API turn: a message (commentary or answer), or a completed function call. */
type ResponsesItem = { text: string; phase?: 'commentary' } | { call: { id: string; name: string; args: unknown } };

/**
 * A Responses API turn in the provider's wire format: each message streams its text, each call
 * arrives whole, then the response completes. No items gives an empty turn.
 */
export function responses(...items: ResponsesItem[]): Response {
  const events: Record<string, unknown>[] = [];
  for (const [index, item] of items.entries()) {
    if ('call' in item) {
      events.push({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: item.call.id,
          name: item.call.name,
          arguments: JSON.stringify(item.call.args),
        },
      });
      continue;
    }
    const id = `msg_${index}`;
    events.push(
      {
        type: 'response.output_item.added',
        item: { id, type: 'message', ...(item.phase ? { phase: item.phase } : {}) },
      },
      { type: 'response.output_text.delta', item_id: id, delta: item.text },
    );
  }
  events.push({ type: 'response.completed' });
  return new Response(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Answers provider requests from the queue in order; anything past the queue fails with 500. An entry
 * may be a function of the request's body, for a reply only known at run time.
 *
 * @returns The parsed request bodies, in order, and the fetch spy.
 */
export function mockVendor(...responses: Array<Response | ((body: Record<string, unknown>) => Response)>) {
  const bodies: Record<string, unknown>[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    const body = await request.clone().json();
    bodies.push(body);
    // A function answers from what was asked, for replies only known at run time.
    const next = responses.shift();
    return (typeof next === 'function' ? next(body) : next) ?? new Response('no more turns', { status: 500 });
  });
  return { bodies, spy };
}

/** The messages the provider received on the given request. */
export function messagesOf(bodies: Record<string, unknown>[], index: number): ChatMessage[] {
  return bodies[index].messages as ChatMessage[];
}
