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

/**
 * Answers provider requests from the queue in order; anything past the queue fails with 500.
 *
 * @returns The parsed request bodies, in order, and the fetch spy.
 */
export function mockVendor(...responses: Response[]) {
  const bodies: Record<string, unknown>[] = [];
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input instanceof Request ? input : String(input), init);
    bodies.push(await request.clone().json());
    return responses.shift() ?? new Response('no more turns', { status: 500 });
  });
  return { bodies, spy };
}

/** The messages the provider received on the given request. */
export function messagesOf(bodies: Record<string, unknown>[], index: number): ChatMessage[] {
  return bodies[index].messages as ChatMessage[];
}
