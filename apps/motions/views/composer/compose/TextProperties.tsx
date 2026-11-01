import { $bind, type AnyType, effect, setup } from '@airlib/react';
import {
  SegmentGroup,
  Stepper,
  StepperAdjuster,
  StepperInput,
  TextInput,
  Toggle,
  ToggleGroup,
  Tooltip,
} from '@airlib/react-aui';
import {
  FormatAlignCenterIcon,
  FormatAlignLeftIcon,
  FormatAlignRightIcon,
  FormatBoldIcon,
  FormatItalicIcon,
  FormatUnderlinedIcon,
  TitleIcon,
} from '@airlib/react-aui/icons';
import type { Picked } from '../context.js';
import { FontPicker } from './FontPicker.js';
import { KeyedStyle } from './Groups.js';

/** How big the words are: on its own, with no relation to their colour. */
const SIZE = { label: 'Size', fields: [{ key: 'fontSize', step: 1 }] };

/** What colour the words are. */
const COLOR = { label: 'Color', fields: [{ key: 'color' }] };

/**
 * Picked words and how they're set, on a title or an element, each bound to its own CSS. What has a
 * between is keyed on its own; the rest of how it's set doesn't move.
 */
export const TextProperties = setup<{ clip: Picked }>((props) => {
  effect(() => {
    if (!props.clip.props.style) {
      props.clip.props.style = {};
    }
  });

  return ({ clip: { props } }) => {
    const { style } = props as AnyType;

    return (
      <div className="wedyan-compose-properties-fields">
        <TextInput size="sm" label="Words" multiline rows={3} value={$bind(props, 'text')} />
        <fieldset aria-label="Font" className="wedyan-compose-property-group">
          <div className="wedyan-compose-property-head pi-sm">
            <span className="wedyan-compose-property-label" aria-hidden="true">
              Font
            </span>
          </div>
          <div className="wedyan-compose-property-row">
            <FontPicker value={$bind(style, 'fontFamily')} />
          </div>
          <div className="wedyan-compose-property-row pis-sm">
            <span>Format</span>
            <SegmentGroup aria-label="Format" size="xs" value={style}>
              <Toggle name="fontWeight" value="bold" aria-label="Bold">
                <FormatBoldIcon />
                <Tooltip>Bold</Tooltip>
              </Toggle>
              <Toggle name="fontStyle" value="italic" aria-label="Italic">
                <FormatItalicIcon />
                <Tooltip>Italic</Tooltip>
              </Toggle>
              <Toggle name="textDecoration" value="underline" aria-label="Underline">
                <FormatUnderlinedIcon />
                <Tooltip>Underline</Tooltip>
              </Toggle>
            </SegmentGroup>
          </div>
          <div className="wedyan-compose-property-row pis-sm">
            <span>Align</span>
            <ToggleGroup aria-label="Align" size="xs" value={$bind(style, 'textAlign')} required>
              <Toggle value="left" aria-label="Left">
                <FormatAlignLeftIcon />
                <Tooltip>Left</Tooltip>
              </Toggle>
              <Toggle value="center" aria-label="Center">
                <FormatAlignCenterIcon />
                <Tooltip>Center</Tooltip>
              </Toggle>
              <Toggle value="right" aria-label="Right">
                <FormatAlignRightIcon />
                <Tooltip>Right</Tooltip>
              </Toggle>
            </ToggleGroup>
          </div>
        </fieldset>
        <KeyedStyle group={SIZE} style={style}>
          {(value, edit) => (
            <Stepper size="xs" label="Size" step={1} min={1} value={value} onInput={edit}>
              <StepperAdjuster rate={2}>
                <TitleIcon />
              </StepperAdjuster>
              <StepperInput aria-label="Size" />
              <Tooltip>Size</Tooltip>
            </Stepper>
          )}
        </KeyedStyle>
        <KeyedStyle group={COLOR} style={style}>
          {(value, edit) => <TextInput type="color" size="xs" value={value} onInput={edit} />}
        </KeyedStyle>
      </div>
    );
  };
}, 'TextProperties');
