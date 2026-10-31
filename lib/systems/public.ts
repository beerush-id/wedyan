/*
 * What apps may use. An app never imports the running system: it declares what it can do, and asks
 * through here.
 */
export { linkTarget, linkTo } from './links.js';
export type { Command, CommandEntry, CommandHandle, CommandInput, Commands, LinkHandle, WidgetAck } from './registry.js';
export { requestLink } from './registry.js';
