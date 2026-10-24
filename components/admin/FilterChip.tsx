import Link from 'next/link';
import type { ReactNode } from 'react';

export interface FilterChipProps {
  /** Where the chip leads. */
  href: string;
  /** Whether this chip is the one currently applied. */
  active: boolean;
  children: ReactNode;
}

/**
 * One of the filter chips above a list — "全部", "管理员", "禁用".
 *
 * The chips are links, not buttons, because each one is a different view of
 * the same list and should be linkable and bookmarkable. The active chip
 * is marked with `aria-current` as well as by colour, so the state is not
 * carried by colour alone.
 */
export function FilterChip({ href, active, children }: FilterChipProps) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`text-xs px-3 py-1.5 rounded border transition-colors ${
        active ? 'bg-ink text-paper border-ink' : 'border-ink/20 text-ink hover:bg-paper-deep'
      }`}
    >
      {children}
    </Link>
  );
}
