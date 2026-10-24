import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: 'bg-ink/8 text-ink-soft border-ink/15',
  primary: 'bg-seal/12 text-seal border-seal/25',
  success: 'bg-success/12 text-success border-success/25',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/12 text-danger border-danger/25',
  info: 'bg-info/12 text-info border-info/25',
};

export interface StatusBadgeProps {
  /** The badge's tone. Defaults to neutral. */
  tone?: BadgeTone;
  children: ReactNode;
  className?: string;
}

/**
 * A small status pill.
 *
 * The admin pages spelled their status pills out by hand, and they were
 * not even in the same palette: the users page used `bg-seal/15 text-seal`
 * for both "管理员" and "禁用", the notes page used Tailwind's default
 * `text-red-600` and `text-green-700`, and the AI page used `bg-green-100`.
 * A reader could not tell the states apart by colour.
 *
 * The six tones are drawn from the site's own tokens — ink, seal, and the
 * success / warning / danger / info hues declared in `globals.css` — so the
 * pills sit in the same palette as the rest of the page.
 */
export function StatusBadge({ tone = 'neutral', children, className = '' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs border whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
