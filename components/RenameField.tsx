import { $bind, $static, microtask, mutable, setup } from '@airlib/react';
import { TextInput } from '@airlib/react-aui';

/** How long, in ms, a new name rests before it's saved, so typing it is one rename. */
const RENAME_DELAY = 600;

type RenameFieldProps = {
  /** The name it has. */
  name: string;
  /** Takes the caret as it appears, for something just made. */
  autoFocus?: boolean;
  /** Saves a new name. */
  onrename: (name: string) => void;
  /** Hears the caret leave. */
  onleave?: () => void;
};

/**
 * A name that's changed by typing it, for what has no live document to bind to: a folder, an upload.
 * Give each thing named its own, by `key`: what's typed belongs to it.
 */
export const RenameField = setup<RenameFieldProps>((props) => {
  const draft = mutable({ value: $static(() => props.name) });
  const [schedule] = microtask(RENAME_DELAY);
  const name = {
    get value() {
      return draft.value;
    },
    set value(next: string) {
      draft.value = next;
      schedule(() => {
        const title = next.trim();
        if (title) props.onrename(title);
      });
    },
  };

  return () => <TextInput size="sm" label="Name" value={$bind(name, 'value')} autoFocus={props.autoFocus} onBlur={() => props.onleave?.()} className="wedyan-rename" />;
}, 'RenameField');
