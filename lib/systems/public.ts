/*
 * What apps may use. An app never imports the running system: it declares what it can do, and asks
 * through here.
 */
export { linkTarget, linkTo, mediaOf, previewLink, previewTarget } from './links.js';
export type { Command, CommandEntry, CommandHandle, CommandInput, Commands, LinkHandle, WidgetAck } from './registry.js';
export { attachCommands, attachFacts, requestLink } from './registry.js';
