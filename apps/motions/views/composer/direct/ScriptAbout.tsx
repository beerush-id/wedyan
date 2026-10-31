import { template } from '@airlib/react';
import { DescriptionList } from '@airlib/react-aui';

/** A fact about what a script belongs to, as its aside lists it. */
export type Fact = { label: string; value: string };

/** What a script belongs to, in its aside: its picture in its shape, its name, a line about it, and its facts. */
export const ScriptAbout = template<{ picture?: string; ratio: string; title: string; description?: string; facts: Fact[] }>(
  (props) => (
    <header className="wedyan-script-about">
      {props.picture && <img className="wedyan-direct-hero" style={{ aspectRatio: props.ratio }} src={props.picture} alt="" />}
      <div className="wedyan-direct-heading">
        <h2>{props.title}</h2>
        {props.description && <p>{props.description}</p>}
      </div>
      <DescriptionList size="sm" items={props.facts} />
    </header>
  ),
  'ScriptAbout',
);
