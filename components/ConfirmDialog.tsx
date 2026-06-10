'use client';

import { useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open, title, description, confirmLabel = '确认', cancelLabel = '取消',
  destructive = false, onConfirm, onClose, children,
}: Props) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  async function go() {
    setBusy(true);
    try { await onConfirm(); } finally { setBusy(false); onClose(); }
  }
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-sm p-5">
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-4">{description}</p>
        {children}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} disabled={busy}
            className="px-3 py-1.5 text-sm border rounded hover:bg-gray-50">{cancelLabel}</button>
          <button type="button" onClick={go} disabled={busy}
            className={`px-3 py-1.5 text-sm text-white rounded disabled:opacity-50 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}>
            {busy ? '处理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
