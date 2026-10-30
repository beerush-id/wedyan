import { Snippet, template } from '@airlib/react';
import { Confirm, ConfirmAction, ConfirmCancel, ConfirmDescription, ConfirmPanel, ConfirmTitle, ConfirmTrigger } from '@airlib/react-aui';
import type { ReactNode } from 'react';

type ConfirmButtonProps = {
  /** The question, read live, e.g. "Delete Ayla?". */
  title: () => string;
  /** What answering yes does, in a line. */
  description: string;
  /** The answer that does it, e.g. "Delete". */
  action: string;
  /** The trigger's size where it sits; the dialog keeps its own. */
  size?: 'xs' | 'sm' | 'md';
  /** The trigger's look where it sits. */
  variant?: 'text' | 'tonal' | 'filled' | 'glass';
  /** Does it, once answered yes. */
  onconfirm: () => void;
  /** What the trigger shows. */
  children?: ReactNode;
};

/**
 * A destructive button that asks first. Its trigger is sized and styled for where it sits; the
 * question and its answers keep the dialog's own size, the answer that destroys in the error color.
 */
export const ConfirmButton = template<ConfirmButtonProps>(
  (props) => (
    <Confirm color="error" onconfirm={props.onconfirm}>
      <ConfirmTrigger size={props.size} variant={props.variant} color="error">
        {props.children}
      </ConfirmTrigger>
      <ConfirmPanel>
        <ConfirmTitle>
          <Snippet>{props.title}</Snippet>
        </ConfirmTitle>
        <ConfirmDescription>{props.description}</ConfirmDescription>
        <ConfirmCancel>Cancel</ConfirmCancel>
        <ConfirmAction>{props.action}</ConfirmAction>
      </ConfirmPanel>
    </Confirm>
  ),
  'ConfirmButton'
);
