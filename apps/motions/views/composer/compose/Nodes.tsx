import { AUI_CLASS } from '@airlib/aui/utils';
import { $bind, For, setup, template } from '@airlib/react';
import type { TimelineSegment } from '@airlib/react/timeline';
import { Button, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import { ImageIcon, ShapesIcon, TitleIcon } from '@airlib/react-aui/icons';
import { DeleteIcon } from '@/components/icons.js';
import { AddIcon, LayerIcon, TextIcon } from '../../icons.js';
import type { ClipNode, HtmlClip } from '../composition.js';
import { type Composer, composerCtx } from '../context.js';
import { addNode, findNode } from '../nodes.js';
import { edited } from './Groups.js';

/** What a new element starts as, within what holds it, in stage units. */
const NEW_BOX: HtmlClip = { x: 40, y: 40, width: 240, height: 160, style: { background: '#ffffff' } };
const NEW_TEXT: HtmlClip = { x: 40, y: 40, text: 'Text', style: { color: '#ffffff', fontSize: 48 } };

/**
 * The elements of the picked clip, as a tree. Picking one is picking what's edited, as picking a
 * clip is: the panels and the ruler then show it, and picking the clip's own row goes back to it.
 */
export const Nodes = setup(() => {
  const composer = composerCtx.get() as Composer;
  const host = () => composer.hostClip() as TimelineSegment<HtmlClip>;

  // A new element goes inside what's picked, and is picked. A picture holds nothing, so it goes in the clip.
  const add = (name: string, props: HtmlClip) => {
    const picked = (composer.pickedClip() as TimelineSegment<HtmlClip>).props;
    const parent = picked.element === 'img' ? host().props : picked;
    composer.node = addNode(parent, name, structuredClone(props)).id;
    edited(composer);
  };

  const remove = () => {
    const found = findNode(host().props.children, composer.node);
    if (!found) return;
    found.siblings.splice(found.siblings.indexOf(found.node), 1);
    composer.node = '';
    edited(composer);
  };

  return () => (
    <div className="wedyan-compose-nodes">
      <div className="wedyan-compose-property-head">
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
        <For each={() => [...(host().props.children ?? [])]}>{(node) => <NodeRow node={node} depth={1} />}</For>
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

/** One element's row, in from the edge by how deep it sits, and the rows of what's nested in it. */
const NodeRow = setup<{ node: ClipNode; depth: number }>((props) => {
  return () => (
    <>
      <Toggle value={props.node.id} style={{ '--wedyan-node-depth': props.depth } as never}>
        <NodeIcon clip={props.node.props} />
        {props.node.name ?? 'Element'}
      </Toggle>
      <For each={() => [...(props.node.props.children ?? [])]}>{(node) => <NodeRow node={node} depth={props.depth + 1} />}</For>
    </>
  );
}, 'NodeRow');
