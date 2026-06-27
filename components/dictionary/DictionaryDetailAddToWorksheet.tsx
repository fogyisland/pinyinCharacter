'use client';

import { useState } from 'react';
import { AddToWorksheetDialog } from '@/components/worksheet/AddToWorksheetDialog';

export function DictionaryDetailAddToWorksheet({ char }: { char: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-3 py-2 text-sm text-ink-soft hover:text-ink"
      >
        + 字帖
      </button>
      <AddToWorksheetDialog
        open={open}
        chars={[char]}
        onClose={() => setOpen(false)}
      />
    </>
  );
}