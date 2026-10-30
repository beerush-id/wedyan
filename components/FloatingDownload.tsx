import { AUI_CLASS } from '@airlib/aui/utils';
import { template } from '@airlib/react';
import { Button, Tooltip } from '@airlib/react-aui';
import { downloadImage } from '@/lib/systems/download.js';
import { DownloadIcon } from './icons.js';

/**
 * Downloading the image a preview shows: a glass icon button floating at the picture's top end
 * corner, for whatever holds the picture to place. It saves the image named after what it is.
 */
export const FloatingDownload = template<{ src: string; name: string; className?: string }>(
  ({ src, name, className }) => (
    <span className={className ? `wedyan-floating-download ${className}` : 'wedyan-floating-download'}>
      <Button aria-label="Download" size="sm" variant="glass" className={AUI_CLASS.CONTROL_ICON} onClick={() => downloadImage(src, name)}>
        <DownloadIcon />
        <Tooltip>Download</Tooltip>
      </Button>
    </span>
  ),
  'FloatingDownload'
);
