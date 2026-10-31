import { $bind, type AnyType, type Bindable, Snippet, setup, template } from '@airlib/react';
import { Listbox, ListboxOption, SearchInput } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { FC, ReactNode } from 'react';

/** One row of a Direct list: its picture, or its kind's icon, its title, and a line about it. */
export type DirectItem = {
  key: string;
  title: string;
  description?: string;
  picture?: string;
  icon?: FC;
};

/** A run of rows of one kind, under its name; a list of one kind needs no name. */
export type DirectGroup<T extends DirectItem = DirectItem> = {
  label?: string;
  items: T[];
  /** What sits at the end of its name, e.g. a button adding one; a group with one shows even while it has no rows. */
  action?: () => ReactNode;
};

type DirectListProps = {
  /** What the side is, as a place to go. */
  label: string;
  /** What the list holds, for screen readers. */
  listLabel: string;
  /** The groups, read live, so rows come and go as what they show does; a group without rows doesn't show. */
  groups: () => DirectGroup[];
  /** The picked row's key, which the view keeps. */
  value?: Bindable<string>;
  /** What the rows are searched for; given, a search field sits above them, and the view narrows its groups by it. */
  query?: Bindable<string>;
};

/**
 * The side of a Direct view: what the view holds, in named groups, each row its picture, title, and
 * a line about it, on a glass panel, under a search field when the view searches it. Picking a row
 * — or moving through the list by keyboard — sets the view's picked key; the view shows that row in
 * full beside it.
 */
export const DirectList = setup<DirectListProps>(
  (props) => () => (
    <WindowPanel role="navigation" aria-label={props.label} className="wedyan-direct-list">
      {props.query !== undefined && (
        <SearchInput size="sm" label="Search" placeholder="Search" value={$bind(props as AnyType, 'query')} className="wedyan-direct-search" />
      )}
      <Listbox label={props.listLabel} value={$bind(props as AnyType, 'value')} required>
        <Snippet>
          {() =>
            props.groups().map((group, index) =>
              group.items.length || group.action ? (
                <DirectSection key={group.label ?? index} label={group.label} action={group.action}>
                  {group.items.map((item) => (
                    <ListboxOption key={item.key} value={item.key} className="wedyan-direct-row">
                      <DirectRow title={item.title} description={item.description} picture={item.picture} icon={item.icon} />
                    </ListboxOption>
                  ))}
                </DirectSection>
              ) : null
            )
          }
        </Snippet>
      </Listbox>
    </WindowPanel>
  ),
  'DirectList'
);

/** The side of a Direct view whose rows each say whether they're picked, so it holds no value of its own. */
export const DirectPanel = template<{ label: string; listLabel: string; children: ReactNode }>(
  (props) => (
    <WindowPanel role="navigation" aria-label={props.label} className="wedyan-direct-list">
      <Listbox label={props.listLabel} required>
        {props.children}
      </Listbox>
    </WindowPanel>
  ),
  'DirectPanel'
);

/** Rows of one kind, under their name, with what sits at the end of it. */
export const DirectSection = template<{ label?: string; action?: () => ReactNode; children: ReactNode }>(
  (props) => (
    <div role="group" aria-label={props.label} className="wedyan-direct-group">
      {props.label && (
        <div className="wedyan-direct-group-head">
          <span className="wedyan-direct-group-label" aria-hidden="true">
            {props.label}
          </span>
          {props.action?.()}
        </div>
      )}
      {props.children}
    </div>
  ),
  'DirectSection'
);

/** A row's face: its picture, or its kind's icon on a tinted square, its title, and a line about it. */
export const DirectRow = template<Omit<DirectItem, 'key'>>((props) => {
  const Icon = props.icon;
  return (
    <>
      {props.picture ? (
        <img className="wedyan-direct-thumb" src={props.picture} alt="" />
      ) : (
        <span className="wedyan-direct-thumb" aria-hidden="true">
          {Icon && <Icon />}
        </span>
      )}
      <span className="wedyan-direct-text" title={props.description ? `${props.title}\n${props.description}` : props.title}>
        <span className="wedyan-direct-title">{props.title}</span>
        {props.description && <span className="wedyan-direct-description">{props.description}</span>}
      </span>
    </>
  );
}, 'DirectRow');

/** What a Direct view shows in full, on its solid panel. */
export const DirectContent = template<{ children: ReactNode }>(
  (props) => (
    <WindowPanel surface="solid" role="region" aria-label="Picked" className="wedyan-direct-content">
      {props.children}
    </WindowPanel>
  ),
  'DirectContent'
);
