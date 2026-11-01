import { $bind, $use, type AnyType, type Bindable, mutable, setup } from '@airlib/react';
import { Combobox } from '@airlib/react-aui';
import { fontFamilies } from '@/lib/kernel/fonts.h.js';

/** How long typing rests before a search is asked, in milliseconds: one search, not one per key. */
const SEARCH_DELAY = 150;

/** A font family, searched for among Google Fonts as it's typed; empty, the stage's own. */
export const FontPicker = setup<{ value?: Bindable<string | number> }>((props) => {
  const search = mutable({ query: '' });
  const families = fontFamilies.with(() => [search.query], SEARCH_DELAY);

  return () => (
    <Combobox
      size="sm"
      label="Font family"
      placeholder="Font family"
      value={$bind(props as AnyType, 'value')}
      query={$bind(search, 'query')}
      options={$use(() => (families.data ?? []).map((key) => ({ key })))}
    />
  );
}, 'FontPicker');
