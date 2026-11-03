import { untrack } from '@airlib/react';
import type { ClipNode, HtmlClip } from './composition.js';

/**
 * Finds a node anywhere under some nodes. An id never changes, so finding one by it watches nothing
 * it passes: whoever looks watches the id it's looking for, and the node it finds.
 *
 * @param nodes - The nodes.
 * @param id - The node's id.
 * @returns The node, and the list it's in; nothing when it isn't there.
 */
export function findNode(nodes: ClipNode[] | undefined, id: string): { node: ClipNode; siblings: ClipNode[] } | undefined {
  return untrack(() => search(nodes, id));
}

/** Walks the nodes for one by its id. */
function search(nodes: ClipNode[] | undefined, id: string): { node: ClipNode; siblings: ClipNode[] } | undefined {
  for (const node of nodes ?? []) {
    if (node.id === id) return { node, siblings: nodes as ClipNode[] };
    const found = search(node.props.children, id);
    if (found) return found;
  }
}

/**
 * Moves a node beside another, into that one's list when it's elsewhere. Later in a list is nearer
 * the front, as the DOM paints it. A node can't move into what it holds.
 *
 * @param nodes - The clip's nodes.
 * @param id - The node that moves.
 * @param target - The node it moves beside.
 * @param front - Whether it lands in front of the target rather than behind it.
 */
export function moveNode(nodes: ClipNode[] | undefined, id: string, target: string, front: boolean): void {
  const moving = findNode(nodes, id);
  const beside = findNode(nodes, target);
  if (!moving || !beside || id === target || findNode(moving.node.props.children, target)) return;
  const [node] = moving.siblings.splice(moving.siblings.indexOf(moving.node), 1);
  beside.siblings.splice(beside.siblings.indexOf(beside.node) + (front ? 1 : 0), 0, node);
}

/**
 * Puts a new node under a clip or a node, placed in its box.
 *
 * @param parent - The values of what it goes under.
 * @param name - What it's called.
 * @param props - Its values.
 * @returns The node.
 */
export function addNode(parent: HtmlClip, name: string, props: HtmlClip): ClipNode {
  const node = { id: crypto.randomUUID(), name, props, scenes: [] };
  if (parent.children) parent.children.push(node);
  else parent.children = [node];
  return node;
}
