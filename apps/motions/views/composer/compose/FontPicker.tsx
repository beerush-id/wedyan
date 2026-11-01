import { $bind, $use, type AnyType, type Bindable, effect, mutable, setup } from '@airlib/react';
import { Combobox } from '@airlib/react-aui';
import { fontFamilies } from '@/lib/kernel/fonts.h.js';

/** How long typing rests before a search is asked, in milliseconds: one search, not one per key. */
const SEARCH_DELAY = 150;

/** A font family, searched for among Google Fonts as it's typed; empty, the stage's own. */
export const FontPicker = setup<{ value?: Bindable<string | number> }>((props) => {
  const search = mutable({ query: '', text: '' });
  const families = fontFamilies.with(() => [search.query], SEARCH_DELAY);

  // The field shows the family of the title it's on, whichever title that is now.
  effect(() => {
    const family = String(props.value ?? '');
    if (search.text !== family) search.text = family;
  });

  return () => (
    <Combobox
      size="sm"
      label="Font family"
      placeholder="Font family"
      value={$bind(props as AnyType, 'value')}
      query={$bind(search, 'query')}
      text={$bind(search, 'text')}
      options={$use(() => (families.data ?? []).map((key) => ({ key })))}
    />
  );
}, 'FontPicker');
