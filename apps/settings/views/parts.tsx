import { AUI_CLASS } from '@airlib/aui/utils';
import { template } from '@airlib/react';
import type { ReactNode } from 'react';
import type { SettingsFocus } from './profile.js';

const CLASS = {
  GROUP: 'wedyan-settings-group',
  GROUP_HEAD: 'wedyan-settings-group-head',
  GROUP_TITLE: 'wedyan-settings-group-title',
  GROUP_DESCRIPTION: 'wedyan-settings-group-description',
  ROW: 'wedyan-settings-row',
  ROW_TEXT: 'wedyan-settings-row-text',
  ROW_LABEL: 'wedyan-settings-row-label',
  ROW_DESCRIPTION: 'wedyan-settings-row-description',
  ROW_CONTROL: 'wedyan-settings-row-control',
};

/** The element ids of the groups Settings can be opened at, so each can be brought into view. */
const ANCHORS: Record<SettingsFocus, string> = {
  idle: 'wedyan-settings-idle',
};

/**
 * One group of settings on a page, on a frosted panel: its title, what it's for, and its rows.
 * A group Settings can be opened at carries an anchor.
 */
export const SettingsGroup = template<{ title: string; description?: ReactNode; anchor?: SettingsFocus; children?: ReactNode }>(
  ({ title, description, anchor, children }) => (
    <section id={anchor && anchorOf(anchor)} className={`${CLASS.GROUP} ${AUI_CLASS.GLASS_PANEL}`} aria-label={title}>
      <div className={CLASS.GROUP_HEAD}>
        <h3 className={CLASS.GROUP_TITLE}>{title}</h3>
        {description && <p className={CLASS.GROUP_DESCRIPTION}>{description}</p>}
      </div>
      {children}
    </section>
  ),
  'SettingsGroup'
);

/**
 * One setting: its name and what it does, then its control, beside them or, when `stacked`, under
 * them. The control names itself by `labelId` and describes itself by `descriptionOf(labelId)`.
 */
export const SettingsRow = template<{ label: string; labelId: string; description?: ReactNode; stacked?: boolean; children?: ReactNode }>(
  ({ label, labelId, description, stacked, children }) => (
    <div className={CLASS.ROW} data-stacked={stacked || undefined}>
      <div className={CLASS.ROW_TEXT}>
        <span id={labelId} className={CLASS.ROW_LABEL}>
          {label}
        </span>
        {description && (
          <span id={descriptionOf(labelId)} className={CLASS.ROW_DESCRIPTION}>
            {description}
          </span>
        )}
      </div>
      <div className={CLASS.ROW_CONTROL}>{children}</div>
    </div>
  ),
  'SettingsRow'
);

/**
 * The element id of a group Settings can be opened at.
 *
 * @param focus - The group.
 * @returns Its element id.
 */
export function anchorOf(focus: SettingsFocus): string {
  return ANCHORS[focus];
}

/**
 * The element id of a setting's description, for its control's `aria-describedby`.
 *
 * @param labelId - The setting's label id.
 * @returns The description's id.
 */
export function descriptionOf(labelId: string): string {
  return `${labelId}-description`;
}
