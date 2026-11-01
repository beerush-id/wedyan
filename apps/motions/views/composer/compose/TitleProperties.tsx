import { $bind, $static, type AnyType, setup } from '@airlib/react';
import type { TimelineSegment } from '@airlib/react/timeline';
import { Stepper, StepperInput, TextInput, Toggle, ToggleGroup, Tooltip } from '@airlib/react-aui';
import {
  FormatAlignCenterIcon,
  FormatAlignLeftIcon,
  FormatAlignRightIcon,
  FormatBoldIcon,
  FormatItalicIcon,
  FormatUnderlinedIcon,
  TitleIcon,
} from '@airlib/react-aui/icons';
import type { TitleClip } from '../composition.js';
import { FontPicker } from './FontPicker.js';

/** The picked title's words and how they're set, each bound to the clip's own CSS. */
export const TitleProperties = setup<{ clip: TimelineSegment<TitleClip> }>((props) => {
  $static(() => {
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
          <div className="wedyan-compose-property-head">
            <span className="wedyan-compose-property-label" aria-hidden="true">
              Font
            </span>
          </div>
          <div className="wedyan-compose-property-row">
            <FontPicker value={$bind(style, 'fontFamily')} />
          </div>
          <div className="wedyan-compose-property-row">
            <Stepper size="xs" label="Size" step={1} min={1} value={$bind(style, 'fontSize')}>
              <TitleIcon />
              <StepperInput aria-label="Size" />
              <Tooltip>Size</Tooltip>
            </Stepper>
            <ToggleGroup aria-label="Weight" size="xs" value={$bind(style, 'fontWeight')}>
              <Toggle value="bold" aria-label="Bold">
                <FormatBoldIcon />
                <Tooltip>Bold</Tooltip>
              </Toggle>
            </ToggleGroup>
            <ToggleGroup aria-label="Slant" size="xs" value={$bind(style, 'fontStyle')}>
              <Toggle value="italic" aria-label="Italic">
                <FormatItalicIcon />
                <Tooltip>Italic</Tooltip>
              </Toggle>
            </ToggleGroup>
            <ToggleGroup aria-label="Decoration" size="xs" value={$bind(style, 'textDecoration')}>
              <Toggle value="underline" aria-label="Underline">
                <FormatUnderlinedIcon />
                <Tooltip>Underline</Tooltip>
              </Toggle>
            </ToggleGroup>
          </div>
          <div className="wedyan-compose-property-row">
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
          <div className="wedyan-compose-property-row">
            <span>Color</span>
            <div>
              <TextInput type="color" size="sm" value={$bind(style, 'color')} />
            </div>
          </div>
        </fieldset>
      </div>
    );
  };
}, 'TitleProperties');
