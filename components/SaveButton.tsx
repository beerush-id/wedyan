import { template } from '@airlib/react';
import { Button } from '@airlib/react-aui';

/**
 * Saving the file a window edits, for its toolbar: one filled button, the same in every app.
 * Writing the file is the drive's to do; the button stands where it will.
 */
export const SaveButton = template<{ onClick?: () => void }>(
  ({ onClick }) => (
    <Button size="sm" variant="filled" onClick={onClick}>
      Save
    </Button>
  ),
  'SaveButton'
);
