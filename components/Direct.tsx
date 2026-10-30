import { $bind, type AnyType, type Bindable, Snippet, setup, template } from '@airlib/react';
import { Listbox, ListboxOption, SearchInput } from '@airlib/react-aui';
import { WindowPanel } from '@airlib/react-aui/desktop';
import type { FC } from 'react';

/** One row of a Direct list: its picture, or its kind's icon, its title, and a line about it. */
export type DirectItem = {
  key: string;
  title: string;
  description?: string;
  picture?: string;
  icon?: FC;
};

/** A run of rows of one kind, under its name; a list of one kind needs no name. */
export type DirectGroup<T extends DirectItem = DirectItem> = { label?: string; items: T[] };

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
              group.items.length ? (
                <div key={group.label ?? index} role="group" aria-label={group.label} className="wedyan-direct-group">
                  {group.label && (
                    <span className="wedyan-direct-group-label" aria-hidden="true">
                      {group.label}
                    </span>
                  )}
                  {group.items.map((item) => (
                    <ListboxOption key={item.key} value={item.key} className="wedyan-direct-row">
                      <DirectRow item={item} />
                    </ListboxOption>
                  ))}
                </div>
              ) : null
            )
          }
        </Snippet>
      </Listbox>
    </WindowPanel>
  ),
  'DirectList'
);

/** A row's face: its picture, or its kind's icon on a tinted square, its title, and a line about it. */
const DirectRow = template<{ item: DirectItem }>((props) => {
  const { item } = props;
  const Icon = item.icon;
  return (
    <>
      {item.picture ? (
        <img className="wedyan-direct-thumb" src={item.picture} alt="" />
      ) : (
        <span className="wedyan-direct-thumb" aria-hidden="true">
          {Icon && <Icon />}
        </span>
      )}
      <span className="wedyan-direct-text" title={item.description ? `${item.title}\n${item.description}` : item.title}>
        <span className="wedyan-direct-title">{item.title}</span>
        {item.description && <span className="wedyan-direct-description">{item.description}</span>}
      </span>
    </>
  );
}, 'DirectRow');
