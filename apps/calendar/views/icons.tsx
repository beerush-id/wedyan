import { SymbolIcon } from '@/components/SymbolIcon.js';

/** Calendar's glyphs for its views and actions: Material Symbols, weight 200. */

export { CalendarIcon as LibraryIcon } from '@airlib/react-aui/icons';
export {
  DeleteIcon,
  OpenIcon,
  PreviewPanelIcon as PreviewIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
} from '@/components/icons.js';

/** `mail`: the invites waiting on a reply. */
export const InvitesIcon = () => (
  <SymbolIcon d="M184.62-200q-27.62 0-46.12-18.5Q120-237 120-264.62v-430.76q0-27.62 18.5-46.12Q157-760 184.62-760h590.76q27.62 0 46.12 18.5Q840-723 840-695.38v430.76q0 27.62-18.5 46.12Q803-200 775.38-200H184.62ZM480-473.85 160-684.62v420q0 10.77 6.92 17.7 6.93 6.92 17.7 6.92h590.76q10.77 0 17.7-6.92 6.92-6.93 6.92-17.7v-420L480-473.85ZM480-520l310.77-200H169.23L480-520Z" />
);
