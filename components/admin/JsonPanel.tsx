'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function JsonPanel({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-seal hover:underline inline-flex items-center gap-1"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {open ? '收起' : '查看'} JSON
      </button>
      {open && (
        <pre className="mt-2 p-2 bg-paper-deep/40 border border-ink/10 rounded overflow-auto">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}
