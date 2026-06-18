'use client';

import { useToastStore } from '@/lib/toast-store';

const kindStyles: Record<string, string> = {
  success: 'bg-emerald-700 text-paper',
  error: 'bg-red-700 text-paper',
  info: 'bg-ink-soft text-paper',
};

export function ToastViewport() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded shadow-lg px-4 py-2 text-sm flex items-center gap-3 min-w-[200px] max-w-md ${kindStyles[t.kind] ?? kindStyles.info}`}
        >
          <span className="flex-1">{t.text}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="text-paper/80 hover:text-paper text-xs"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
