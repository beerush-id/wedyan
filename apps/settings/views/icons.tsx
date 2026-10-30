import { SymbolIcon } from '@/components/SymbolIcon.js';

/** Settings' glyphs for its pages, on the Material Symbols grid, weight 200. */

export { SidebarCloseIcon, SidebarOpenIcon } from '@/components/icons.js';
export { SettingsIcon as GeneralIcon, PlayArrowIcon as PreviewIcon } from '@airlib/react-aui/icons';

/** `person`: the user's own page. */
export const AccountIcon = () => (
  <SymbolIcon d="M350-620a130 130 0 1 0 260 0a130 130 0 1 0-260 0ZM370-620a110 110 0 1 1 220 0a110 110 0 1 1-220 0ZM180-160v-90q0-80 80-120q110-50 220-50t220 50q80 40 80 120v90H180Zm20-20h560v-70q0-68-68-102q-107-48-212-48t-212 48q-68 34-68 102v70Z" />
);
