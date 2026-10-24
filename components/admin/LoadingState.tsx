import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface LoadingStateProps {
  /** The short label, e.g. "加载中…". */
  label?: string;
  /** A longer explanation of what is being loaded. */
  description?: ReactNode;
  /** `inline` keeps the state on one line — for a row inside a table. */
  variant?: 'block' | 'inline';
  className?: string;
}

/**
 * The loading state of a panel.
 *
 * The admin used to print a bare "加载中…" on a line, which reads like a
 * broken page rather than a page that is still working. This gives the
 * waiting state the same paper-and-ink frame as the rest of the admin.
 */
export function LoadingState({
  label = '加载中…',
  description,
  variant = 'block',
  className = '',
}: LoadingStateProps) {
  if (variant === 'inline') {
    return (
      <span className={`inline-flex items-center gap-2 text-sm text-ink-faint ${className}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}
    >
      <div className="h-11 w-11 rounded-full border border-ink/15 flex items-center justify-center text-ink-faint mb-3">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      </div>
      <p className="text-sm text-ink">{label}</p>
      {description ? (
        <p className="text-xs text-ink-faint mt-1 max-w-sm leading-relaxed">{description}</p>
      ) : null}
    </div>
  );
}
