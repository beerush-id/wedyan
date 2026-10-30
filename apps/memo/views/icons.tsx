import { SymbolIcon } from '@/components/SymbolIcon.js';

/** Memo's glyphs for its views, albums, and memos: Material Symbols. */

export { ClockIcon as RemindersIcon, CloseIcon, VisibilityIcon as ReadIcon } from '@airlib/react-aui/icons';
export {
  AlbumIcon,
  DeleteIcon,
  NoteIcon as MemosIcon,
  SetIcon as WriteIcon,
  SidebarCloseIcon,
  SidebarOpenIcon,
} from '@/components/icons.js';

/** `push_pin`: the pinned memos, and pinning one. */
export const PinIcon = () => (
  <SymbolIcon d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Zm-286 80h252l-46-46v-314H400v314l-46 46Zm126 0Z" />
);

/** `push_pin`, filled: a memo that's pinned. */
export const PinnedIcon = () => <SymbolIcon d="m640-480 80 80v80H520v240l-40 40-40-40v-240H240v-80l80-80v-280h-40v-80h400v80h-40v280Z" />;
