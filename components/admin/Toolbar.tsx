import type { ReactNode } from 'react';

export interface ToolbarProps {
  children: ReactNode;
  className?: string;
}

/**
 * The row of filters and actions that sits between a page header and its
 * list.
 *
 * The filter bars on the users, logs, downloads and AI pages were each
 * written from scratch — different gaps, different backgrounds, and in one
 * case a search field that was 64 characters wide on a phone. This gives
 * them one bar with one rhythm: controls sit on a common baseline, the
 * bar wraps on a narrow screen, and the whole bar reads as one object.
 */
export function Toolbar({ children, className = '' }: ToolbarProps) {
  return (
    <div
      className={`flex flex-wrap items-end gap-2 rounded-lg border border-ink/10 bg-paper-deep/40 px-3 py-2.5 ${className}`}
    >
      {children}
    </div>
  );
}
