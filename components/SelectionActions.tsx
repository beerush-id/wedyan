import { AUI_CLASS } from '@airlib/aui/utils';
import { template } from '@airlib/react';
import { Button, Divider, Toolbar, Tooltip } from '@airlib/react-aui';
import { Fragment, type ReactNode } from 'react';
import type { ActionConfirm } from './confirm.js';
import { ConfirmButton } from './ConfirmButton.js';

/**
 * One thing to do with what's picked: its name (its tooltip, and its name for screen readers), its
 * glyph, and what it does — asked first when it can't be undone, as deleting is.
 */
export type SelectionAction = { label: string; icon: ReactNode; run?: () => void; confirm?: ActionConfirm };

export type SelectionActionsProps = {
  /** Names the actions for screen readers, e.g. "Selected photos". */
  label: string;
  /** How many are checked, shown before the actions while several are, e.g. "3 selected". */
  count?: string;
  /** The actions, in groups set apart from each other: opening, keeping, sending, removing. */
  groups: SelectionAction[][];
};

/**
 * What can be done with what's picked, beside a window's title: how many are checked while
 * several are, then the actions, each an icon button with its name in a tooltip, in groups set
 * apart by a divider. An action that asks first — deleting — confirms before it runs.
 */
export const SelectionActions = template<SelectionActionsProps>(
  (props) => (
    <Toolbar label={props.label} variant="text" className="wedyan-selection">
      {props.count && <span className="wedyan-selection-count">{props.count}</span>}
      {props.groups.map((group, at) => (
        <Fragment key={group.map((action) => action.label).join()}>
          {at > 0 && <Divider orientation="vertical" size="sm" />}
          {group.map((action) =>
            action.confirm ? (
              <span key={action.label} className="wedyan-selection-confirm">
                <ConfirmButton
                  label={action.label}
                  size="sm"
                  variant="text"
                  title={() => action.confirm?.title ?? ''}
                  description={action.confirm.description}
                  action={action.confirm.action}
                  onconfirm={() => action.run?.()}
                >
                  {action.icon}
                  <Tooltip>{action.label}</Tooltip>
                </ConfirmButton>
              </span>
            ) : (
              <Button
                key={action.label}
                aria-label={action.label}
                size="sm"
                variant="text"
                className={AUI_CLASS.CONTROL_ICON}
                onClick={action.run}
              >
                {action.icon}
                <Tooltip>{action.label}</Tooltip>
              </Button>
            )
          )}
        </Fragment>
      ))}
    </Toolbar>
  ),
  'SelectionActions'
);
