'use client';

import { useState } from 'react';
import { AddToWorksheetDialog } from '@/components/worksheet/AddToWorksheetDialog';
import { useToastStore } from '@/lib/toast-store';

export function DictionaryDetailAddToWorksheet({ char }: { char: string }) {
  const pushToast = useToastStore((s) => s.push);
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
        onAdded={(r) => {
          const msg = r.added
            ? `已添加到「${r.title}」`
            : `「${char}」已在「${r.title}」中`;
          pushToast('success', msg);
        }}
      />
    </>
  );
}
