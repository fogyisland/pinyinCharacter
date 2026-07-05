'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { NavGroup } from '@/lib/design';

interface HeaderNavDropdownProps {
  group: NavGroup;
  /** Called when a link is picked (mobile drawer uses this to auto-close). */
  onNavigate?: () => void;
}

/**
 * Top-tier nav item with hover/click dropdown. Single-item groups are
 * rendered as plain links — no dropdown, no ChevronDown.
 *
 * Behavior:
 * - Desktop (md+): open on hover with a small grace period so cursor can
 *   travel from trigger into the panel without flicker; also open on
 *   focus / Enter / Space for keyboard users.
 * - Touch / mobile: rendered as inline-expanded list (no hover). The
 *   mobile drawer handles its own click-outside via the parent overlay.
 *
 * Closes on: Escape, click outside, route change, or selecting a link.
 */
export function HeaderNavDropdown({ group, onNavigate }: HeaderNavDropdownProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Single-item group → render as plain link, no dropdown.
  if (group.items.length === 1) {
    const only = group.items[0];
    return (
      <Link
        href={only.href}
        onClick={onNavigate}
        className="text-ink-soft hover:text-seal transition-colors text-sm font-medium flex items-baseline gap-1.5 border-b-2 border-transparent hover:border-seal pb-0.5"
      >
        <span className="font-kai text-xs text-ink-soft/70">{group.numeral}</span>
        <span>{group.label}</span>
      </Link>
    );
  }

  function scheduleClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }
  function cancelClose() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function openNow() {
    cancelClose();
    setOpen(true);
  }

  // Click-outside to close (desktop dropdown)
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={openNow}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onFocus={openNow}
        className={
          'text-ink-soft hover:text-seal transition-colors text-sm font-medium flex items-baseline gap-1.5 ' +
          'border-b-2 pb-0.5 ' +
          (open ? 'text-ink border-seal' : 'border-transparent hover:border-seal')
        }
      >
        <span className="font-kai text-xs text-ink-soft/70">{group.numeral}</span>
        <span>{group.label}</span>
        <ChevronDown
          size={12}
          className={'transition-transform ' + (open ? 'rotate-180' : '')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full pt-2 z-30"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="min-w-[160px] bg-paper-soft border border-paper-warm rounded-md shadow-paper-lg overflow-hidden">
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onNavigate?.();
                }}
                className="block px-4 py-2 text-sm text-ink-soft hover:bg-paper-warm hover:text-ink transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}