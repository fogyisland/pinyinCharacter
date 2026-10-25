'use client';

import { useEffect, useState } from 'react';

/**
 * The 朱红 seal.
 *
 * It is stamped over the glyph of a char the learner has answered correctly,
 * and it is the big mark on the 通关 screen. The stamp is a rotated square in
 * the seal red, and `visible` toggles a scale + fade transition - Tailwind's
 * transition utilities only, no new CSS file.
 */
export interface QuestSealStampProps {
  visible: boolean;
  text?: string;
}

export function QuestSealStamp({ visible, text = '通' }: QuestSealStampProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    // One frame later, so the transition has a start value to move from.
    const timer = window.setTimeout(() => setEntered(true), 20);
    return () => window.clearTimeout(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <span
      data-seal=""
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 flex items-center justify-center transition-all duration-300 ease-out ${
        entered ? 'scale-100 opacity-100' : 'scale-150 opacity-0'
      }`}
    >
      <span className="-rotate-12 rounded border-2 border-seal bg-seal px-3 py-1 font-kai text-2xl text-paper-soft shadow">
        {text}
      </span>
    </span>
  );
}
