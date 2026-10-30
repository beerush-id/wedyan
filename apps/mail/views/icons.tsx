import { SymbolIcon } from '@/components/SymbolIcon.js';

/** Mail's glyphs for its views, labels and what's done with a message, on the symbols' 960 grid, weight 200. */

/** `inbox`: the inbox, where mail lands. */
export const InboxIcon = () => (
  <SymbolIcon d="M160-800h640v640H160Zm40 40v320h160q0 50 35 85t85 35q50 0 85-35t35-85h160v-320Zm0 560h560v-200H640q-12 52-58 86t-102 34q-56 0-102-34t-58-86H200Z" />
);

/** `mail`: a message. */
export const MailIcon = () => (
  <SymbolIcon d="M120-760h720v560H120Zm40 40v480h640v-480Zm24 0 296 204 296-204h-70L480-564 254-720Z" />
);

/** `mark_email_unread`: what's not read yet, and marking a message so. */
export const UnreadIcon = () => (
  <SymbolIcon d="M120-760h720v560H120Zm40 40v480h640v-480Zm24 0 296 204 296-204h-70L480-564 254-720Zm576-80a80 80 0 1 1 0 160a80 80 0 1 1 0-160Z" />
);

/** `drafts`: an opened message, for marking messages read. */
export const ReadIcon = () => (
  <SymbolIcon d="M120-200v-400l360-240 360 240v400Zm40-40h640v-338L480-791 160-578Zm12-308 308 196 308-196-22-32-286 182-286-182Z" />
);

/** `flag`: what's kept flagged, and flagging it. */
export const FlagIcon = () => (
  <SymbolIcon d="M200-120v-680h40v680Zm40-680h520l-80 170 80 170H240Zm40 40v260h416l-62-130 62-130Z" />
);

/** `flag`, filled: messages that are all flagged already. */
export const FlaggedIcon = () => <SymbolIcon d="M200-120v-680h40v680Zm40-680h520l-80 170 80 170H240Z" />;

/** `label`: a label, the messages carrying its tag. */
export const LabelIcon = () => (
  <SymbolIcon d="M160-240v-480h460l180 240-180 240Zm40-440v400h400l150-200-150-200Z" />
);

export { DeleteIcon } from '@/components/icons.js';
