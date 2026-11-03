import { toast } from '@airlib/react-aui';
import type { MouseEvent } from 'react';
import { requestLink } from '@/lib/systems/registry.js';

/** What an announcement says, and what it opens. */
export type Announcement = { text?: string; link?: string };

/**
 * Says finished work is done, in a notice the user sees wherever they are, even past the chat: work
 * can finish after the answer it began in. It stays until it's read, with a link to open what was
 * made.
 *
 * @param announcement - What it says, and what it opens.
 */
export function announce({ text, link }: Announcement): void {
  if (!text?.trim()) throw new Error('desktop.announce needs the text to show');
  const notice = toast.success(() => <Announced text={text} link={link} onopen={() => notice.dismiss()} />, { duration: 0 });
}

/** An announcement's words, and a link to what was made when there is one; opening it is reading it. */
function Announced({ text, link, onopen }: { text: string; link?: string; onopen: () => void }) {
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    void requestLink(link as string);
    onopen();
  };
  return (
    <span>
      {text}
      {link && (
        <>
          {' '}
          <a href={link} onClick={open}>
            Open
          </a>
        </>
      )}
    </span>
  );
}
