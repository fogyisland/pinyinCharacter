'use client';
import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Collapsible card group used on /init/execute to organize the 9 init
 *  phases into 3 named sections (数据库结构 / 数据导入 / 账号与激活). */
export function StepGroup({
  title,
  completedCount,
  total,
  children,
  defaultOpen = true,
}: {
  title: string;
  completedCount: number;
  total: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const allDone = completedCount === total;
  return (
    <div
      className={`rounded-md border-2 ${
        allDone ? 'border-green-300' : 'border-ink/15'
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          {open ? (
            <ChevronDown className="h-4 w-4 text-ink-soft" />
          ) : (
            <ChevronRight className="h-4 w-4 text-ink-soft" />
          )}
          <span className="font-medium text-ink">{title}</span>
          <span className="text-sm text-ink-faint">
            ({completedCount}/{total} 完成)
          </span>
        </div>
      </button>
      {open && <div className="space-y-2 p-3 pt-0">{children}</div>}
    </div>
  );
}