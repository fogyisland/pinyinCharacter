import { Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** The one-line reason the list is empty. */
  title: string;
  /** A longer explanation or a suggestion. */
  description?: ReactNode;
  /** The icon shown above the title. */
  icon?: LucideIcon;
  /** A button or link that starts the thing that would fill the list. */
  action?: ReactNode;
  className?: string;
}

/**
 * The empty state of a list.
 *
 * The admin tables used to print a bare "暂无数据" on a line, with no
 * indication of whether the list was empty because nothing has happened
 * yet or because the filter matched nothing. This gives the list a proper
 * empty state, and lets the page say which of the two it is.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}
    >
      <div className="h-11 w-11 rounded-full border border-ink/15 flex items-center justify-center text-ink-faint mb-3">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-ink">{title}</p>
      {description ? (
        <p className="text-xs text-ink-faint mt-1 max-w-sm leading-relaxed">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
