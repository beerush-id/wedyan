import type { TimelineSegment } from '@airlib/react/timeline';
import type { ClipNode, HtmlClip } from './composition.js';

/**
 * Finds a node anywhere under some nodes.
 *
 * @param nodes - The nodes.
 * @param id - The node's id.
 * @returns The node, and the list it's in; nothing when it isn't there.
 */
export function findNode(nodes: ClipNode[] | undefined, id: string): { node: ClipNode; siblings: ClipNode[] } | undefined {
  for (const node of nodes ?? []) {
    if (node.id === id) return { node, siblings: nodes as ClipNode[] };
    const found = findNode(node.props.children, id);
    if (found) return found;
  }
}

/**
 * A node as a clip: its own values and keyframes on its host's timing, so whatever reads and keys a
 * clip does the same to a node. It starts, ends, trims and plays at its host's speed, with it.
 *
 * @param host - The clip it's under.
 * @param node - The node.
 * @returns The node, read and written like a clip.
 */
export function nodeClip(host: TimelineSegment, node: ClipNode): TimelineSegment {
  const clip = {
    id: node.id,
    type: 'html',
    get name() {
      return node.name;
    },
    props: node.props,
    get track() {
      return host.track;
    },
    get timeline() {
      return host.timeline;
    },
    get scenes() {
      node.scenes ??= [];
      return node.scenes;
    },
    get startFrame() {
      return host.startFrame;
    },
    get endFrame() {
      return host.endFrame;
    },
    get offsetFrame() {
      return host.offsetFrame;
    },
    get speed() {
      return host.speed;
    },
    addScene(options: { atFrame: number; meta?: Record<string, unknown> }, data: Record<string, unknown>) {
      clip.scenes.push({ id: crypto.randomUUID(), atFrame: options.atFrame, meta: options.meta, data });
    },
    removeScene(scene: ClipNode['scenes'] extends (infer K)[] | undefined ? K : never) {
      clip.scenes.splice(clip.scenes.indexOf(scene), 1);
    },
    sortScenes() {
      clip.scenes.sort((a, b) => a.atFrame - b.atFrame);
    },
  };
  return clip as unknown as TimelineSegment;
}

/**
 * Puts a new node under a clip or a node, placed in its box.
 *
 * @param parent - The values of what it goes under.
 * @param name - What it's called.
 * @param props - Its values.
 * @returns The node, as kept.
 */
export function addNode(parent: HtmlClip, name: string, props: HtmlClip): ClipNode {
  parent.children ??= [];
  parent.children.push({ id: crypto.randomUUID(), name, props, scenes: [] });
  return parent.children[parent.children.length - 1];
}
