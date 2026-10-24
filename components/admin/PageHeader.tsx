import type { ReactNode } from 'react';

export interface PageHeaderProps {
  /** The page title. Rendered in the 楷体 face, like the site's own headings. */
  title: string;
  /** A short line under the title explaining what the page is for. */
  description?: ReactNode;
  /** Buttons or links shown on the right of the header. */
  actions?: ReactNode;
  /** A small label above the title, e.g. "用户". */
  eyebrow?: string;
}

/**
 * The header every admin page opens with.
 *
 * Before this component the 27 admin pages each wrote their own `<h1>`:
 * twenty-four of them used `text-xl font-semibold` with no ink colour,
 * two used the serif face, one used 楷体, and one used `font-bold`. The
 * title also had no shared bottom rule, so the pages drifted apart as soon
 * as the viewport changed.
 *
 * This is the one place that decides what an admin page header looks like.
 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-ink/10 pb-3">
      <div className="min-w-0">
        {eyebrow ? (
          <div className="text-[11px] tracking-[0.2em] text-ink-faint mb-1">{eyebrow}</div>
        ) : null}
        <h1 className="font-kai text-2xl text-ink leading-tight">{title}</h1>
        {description ? (
          <p className="text-sm text-ink-soft mt-1.5 max-w-2xl">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
    </header>
  );
}
