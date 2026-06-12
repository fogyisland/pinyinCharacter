'use client';
import { useState } from 'react';
export function JsonPanel({ data }: { data: unknown }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button className="text-seal hover:underline" onClick={() => setOpen(o => !o)}>
        {open ? '收起' : '查看'} JSON
      </button>
      {open && <pre className="mt-2 p-2 bg-paper-warm rounded overflow-auto">{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
