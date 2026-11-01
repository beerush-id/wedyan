import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, For, setup, template } from '@airlib/react';
import type { TimelineSegment } from '@airlib/react/timeline';
import { Button, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import { ImageIcon, ShapesIcon, TitleIcon } from '@airlib/react-aui/icons';
import type { DragEvent } from 'react';
import { DeleteIcon } from '@/components/icons.js';
import { AddIcon, LayerIcon, TextIcon } from '../../icons.js';
import type { ClipNode, HtmlClip } from '../composition.js';
import { type Composer, composerCtx } from '../context.js';
import { addNode, findNode, moveNode } from '../nodes.js';

/** What a new element starts as, within what holds it, in stage units. */
const NEW_BOX: HtmlClip = { x: 40, y: 40, width: 240, height: 160, style: { background: '#ffffff' } };
const NEW_TEXT: HtmlClip = { x: 40, y: 40, text: 'Text', style: { color: '#ffffff', fontSize: 48 } };

/** How a dragged row names itself to the row it's let go on. */
const NODE_DRAG = 'application/x-wedyan-node';

/** Where a dragged row lands against the row under it, for the row to show. */
const LANDING = { FRONT: 'front', BEHIND: 'behind' };

/**
 * The elements of the picked clip, as a tree. Picking one is picking what's edited, as picking a
 * clip is: the panels and the ruler then show it, and picking the clip's own row goes back to it.
 */
export const Nodes = setup(() => {
  const composer = composerCtx.get() as Composer;
  const host = () => composer.hostClip() as TimelineSegment<HtmlClip>;

  // A new element goes inside what's picked, and is picked. A picture holds nothing, so it goes in the clip.
  const add = (name: string, props: HtmlClip) => {
    const picked = (composer.picked() as ClipNode).props;
    const parent = picked.element === 'img' ? host().props : picked;
    composer.node = addNode(parent, name, structuredClone(props)).id;
    composer.edited();
  };

  const remove = () => {
    const found = findNode(host().props.children, composer.node);
    if (!found) return;
    found.siblings.splice(found.siblings.indexOf(found.node), 1);
    composer.node = '';
    composer.edited();
  };

  return () => (
    <div className="wedyan-compose-nodes">
      <div className="wedyan-compose-property-head pi-sm">
        <span className="wedyan-compose-property-label">Elements</span>
        <span className="wedyan-compose-nodes-actions">
          <Button aria-label="Add box" size="xs" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => add('Box', NEW_BOX)}>
            <AddIcon />
            <Tooltip>Add box</Tooltip>
          </Button>
          <Button aria-label="Add text" size="xs" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={() => add('Text', NEW_TEXT)}>
            <TextIcon />
            <Tooltip>Add text</Tooltip>
          </Button>
          <Button aria-label="Remove element" size="xs" variant="text" className={AUI_CLASS.CONTROL_ICON} onClick={remove}>
            <DeleteIcon />
            <Tooltip>Remove element</Tooltip>
          </Button>
        </span>
      </div>
      <ToggleGroup aria-label="Elements" size="xs" orientation="vertical" required value={$bind(composer, 'node')}>
        <Toggle value="">
          <NodeIcon clip={host().props} />
          {host().name}
        </Toggle>
        <For each={() => frontFirst(host().props.children)}>{(node) => <NodeRow node={node} depth={1} />}</For>
      </ToggleGroup>
    </div>
  );
}, 'Nodes');

/** What an element is, at a glance: a picture, words, a shape by its SVG element, or a box. */
const NodeIcon = template<{ clip: HtmlClip }>(({ clip }) => {
  if (clip.element === 'img') return <ImageIcon />;
  if (clip.text !== undefined) return <TitleIcon />;
  return clip.element && clip.element !== 'div' ? <ShapesIcon /> : <LayerIcon />;
}, 'NodeIcon');

/**
 * One element's row, in from the edge by how deep it sits, and the rows of what's nested in it. It
 * drags: let go on the top half of a row to land in front of it, the bottom half to land behind.
 */
const NodeRow = setup<{ node: ClipNode; depth: number }>((props) => {
  const composer = composerCtx.get() as Composer;

  const start = (event: DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.setData(NODE_DRAG, props.node.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const over = (event: DragEvent<HTMLButtonElement>) => {
    if (!event.dataTransfer.types.includes(NODE_DRAG)) return;
    event.preventDefault();
    const row = event.currentTarget;
    const { top, height } = row.getBoundingClientRect();
    row.dataset.landing = event.clientY < top + height / 2 ? LANDING.FRONT : LANDING.BEHIND;
  };

  const leave = (event: DragEvent<HTMLButtonElement>) => {
    delete event.currentTarget.dataset.landing;
  };

  const drop = (event: DragEvent<HTMLButtonElement>) => {
    const row = event.currentTarget;
    const front = row.dataset.landing === LANDING.FRONT;
    delete row.dataset.landing;
    const host = composer.hostClip() as TimelineSegment<HtmlClip>;
    moveNode(host.props.children, event.dataTransfer.getData(NODE_DRAG), props.node.id, front);
    composer.edited();
  };

  return () => (
    <>
      <Toggle
        value={props.node.id}
        draggable
        style={{ '--wedyan-node-depth': props.depth } as never}
        onDragStart={start}
        onDragOver={over}
        onDragLeave={leave}
        onDrop={drop}
      >
        <NodeIcon clip={props.node.props} />
        {props.node.name ?? 'Element'}
      </Toggle>
      <For each={() => frontFirst(props.node.props.children)}>{(node) => <NodeRow node={node} depth={props.depth + 1} />}</For>
    </>
  );
}, 'NodeRow');

/** Nodes as the tree lists them, frontmost first, as the timeline lists its tracks. */
function frontFirst(nodes?: ClipNode[]): ClipNode[] {
  return [...(nodes ?? [])].reverse();
}
