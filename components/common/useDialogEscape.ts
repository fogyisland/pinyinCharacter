'use client';

import { useEffect } from 'react';

/**
 * Shared dialog a11y behaviour: Escape closes the open overlay.
 *
 * Each dialog still owns its own `role="dialog"`, `aria-modal` and label —
 * this hook only centralises the keyboard handling so the four overlays
 * cannot drift apart the way they did before (three had no Escape at all).
 */
export function useDialogEscape(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
}
