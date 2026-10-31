import { $bind, template } from '@airlib/react';
import { DescriptionList, TextInput } from '@airlib/react-aui';

/** A fact about what a script belongs to, as its aside lists it. */
export type Fact = { label: string; value: string };

/**
 * What a script belongs to, in its aside: its picture in its shape, its title and a line about it,
 * edited right there and saved with the document, and its facts. Its file stays where it is.
 */
export const ScriptAbout = template<{ picture?: string; ratio: string; document: { name: string; description?: string }; facts: Fact[] }>(
  (props) => (
    <header className="wedyan-script-about">
      {props.picture && <img className="wedyan-direct-hero" style={{ aspectRatio: props.ratio }} src={props.picture} alt="" />}
      <div className="wedyan-direct-heading">
        <TextInput size="sm" label="Title" value={$bind(props.document, 'name')} className="wedyan-rename" />
        <TextInput size="sm" multiline label="Description" placeholder="What it's about" value={$bind(props.document, 'description')} className="wedyan-rename" />
      </div>
      <DescriptionList size="sm" items={props.facts} />
    </header>
  ),
  'ScriptAbout',
);
