import type { ReactNode } from 'react';

export interface PanelProps {
  /** The panel's heading. Rendered in the 楷体 face. */
  title?: ReactNode;
  /** A short line under the heading. */
  description?: ReactNode;
  /** Buttons or links shown on the right of the heading row. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /**
   * Drop the body padding, for a panel that holds a full-bleed table.
   */
  flush?: boolean;
}

/**
 * A titled section on a paper card.
 *
 * The admin pages used to reach for three different containers for the same
 * idea — `card-paper rounded p-4`, `rounded-lg border border-paper-warm
 * bg-paper p-4`, and `rounded border border-ink/20 p-4 bg-paper-warm/40` —
 * which is why the same kind of box looked different on every page. This
 * component is the one box, and its header row is the one place a section
 * title and its actions can live.
 */
export function Panel({
  title,
  description,
  actions,
  children,
  className = '',
  flush = false,
}: PanelProps) {
  const hasHeader = title != null || actions != null;
  return (
    <section className={`card-paper rounded-lg ${className}`}>
      {hasHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 border-b border-ink/10">
          <div className="min-w-0">
            {title != null ? <h2 className="font-kai text-base text-ink">{title}</h2> : null}
            {description ? (
              <p className="text-xs text-ink-faint mt-0.5">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? '' : 'p-4'}>{children}</div>
    </section>
  );
}
