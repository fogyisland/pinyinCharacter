'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { AdminButton, type ButtonSize, type ButtonVariant } from '@/components/admin/AdminButton';

/**
 * How long the button keeps saying "copied" before it goes back to its
 * usual label. Long enough to read, short enough not to be stale.
 */
const RESET_AFTER_MS = 2000;

export interface CopyButtonProps {
  /** The text that goes onto the clipboard. */
  text: string;
  /** The button's label. */
  label: string;
  /** The label shown for a moment after a successful copy. */
  copiedLabel?: string;
  /** The button's look. */
  variant?: ButtonVariant;
  /** The button's size. */
  size?: ButtonSize;
}

/**
 * A button that puts a piece of text on the clipboard.
 *
 * The admin pages had three different copy buttons, each with its own
 * success message and its own way of reporting a failure — and one of
 * them swallowed the failure entirely, leaving the operator wondering
 * whether the copy had worked. This one always says what happened.
 *
 * The clipboard is only available on a secure origin, and a browser can
 * refuse the write for other reasons too (the page is not focused, the
 * permission was denied). A refusal is a message, not a crash: the text
 * stays on screen to be selected by hand.
 */
export function CopyButton({
  text,
  label,
  copiedLabel = '已复制',
  variant = 'secondary',
  size = 'sm',
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The timer outlives the button unless it is cleared, and a state
  // update on an unmounted component is a warning the console should
  // not have to carry.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch (err) {
      console.error('[admin] could not copy to the clipboard', err);
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), RESET_AFTER_MS);
  }, [text]);

  const icon =
    state === 'copied' ? (
      <Check className="h-3.5 w-3.5" />
    ) : state === 'failed' ? (
      <TriangleAlert className="h-3.5 w-3.5" />
    ) : (
      <Copy className="h-3.5 w-3.5" />
    );

  return (
    <AdminButton variant={variant} size={size} icon={icon} onClick={() => void copy()}>
      {state === 'copied' ? copiedLabel : state === 'failed' ? '复制失败' : label}
    </AdminButton>
  );
}
