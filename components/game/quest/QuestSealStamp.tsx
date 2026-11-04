'use client';

import { useEffect, useState } from 'react';

/**
 * The 朱红 seal.
 *
 * It is stamped over the char card when the learner answers correctly, and
 * it is the big mark on the 通关 screen. The stamp is a rotated square in
 * the seal red, and `visible` toggles a scale + fade transition - Tailwind's
 * transition utilities only, no new CSS file.
 *
 * ## The seal does not cover the character
 *
 * The stamp used to be `absolute inset-0` with `items-center`, so it sat
 * **dead centre over the glyph** - a 52x40 opaque red square on top of a
 * 72 px character. For every character that read as a decorative stamp,
 * but for 通 it was catastrophic: the seal's own glyph IS 通, so a red 通
 * covered the black 通 and the character looked like it had never been
 * revealed. The seal is `pointer-events-none` and `aria-hidden`, so nothing
 * in the DOM said the character was hidden either.
 *
 * The stamp is now anchored to the card's **top-right corner**, clear of
 * the glyph. The character is always readable, whatever it is.
 *
 * ## The seal is transient
 *
 * The seal is the spec's answer **feedback** ("clicking the right option
 * locks the question and shows the seal"), not a state the character
 * carries. It fades in when the answer lands and fades out again, so it
 * cannot sit over the card for the rest of the level.
 */
export interface QuestSealStampProps {
  visible: boolean;
  text?: string;
  /**
   * How long the seal stays up, in milliseconds. The char card passes a
   * short one; the 通关 screen passes `null` to keep its seal up for as
   * long as the screen is shown.
   */
  autoHideMs?: number | null;
  /**
   * Where the seal sits inside its positioned parent.
   *
   * `corner` puts it in the top-right corner - the char card uses it, so the
   * seal never sits on the character. `center` puts it in the middle - the
   * 通关 screen uses it, because there the seal IS the picture.
   */
  placement?: 'corner' | 'center';
}

const PLACEMENT_CLASS: Record<'corner' | 'center', string> = {
  corner: 'right-0 top-0 items-start justify-end',
  center: 'inset-0 items-center justify-center',
};

export function QuestSealStamp({
  visible,
  text = '通',
  autoHideMs = 1400,
  placement = 'corner',
}: QuestSealStampProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (!visible) {
      setEntered(false);
      return;
    }
    // One frame later, so the transition has a start value to move from.
    const enterTimer = window.setTimeout(() => setEntered(true), 20);
    // The auto-hide: the seal fades back out so the character is left
    // clear. `autoHideMs === null` keeps it up for good.
    const hideTimer =
      autoHideMs === null ? null : window.setTimeout(() => setEntered(false), autoHideMs);
    return () => {
      window.clearTimeout(enterTimer);
      if (hideTimer !== null) window.clearTimeout(hideTimer);
    };
  }, [visible, autoHideMs]);

  if (!visible) return null;

  return (
    <span
      data-seal=""
      aria-hidden="true"
      className={`pointer-events-none absolute flex transition-all duration-300 ease-out ${PLACEMENT_CLASS[placement]} ${
        entered ? 'scale-100 opacity-100' : 'scale-150 opacity-0'
      }`}
    >
      <span className="-rotate-12 rounded border-2 border-seal bg-seal px-3 py-1 font-kai text-2xl text-paper-soft shadow">
        {text}
      </span>
    </span>
  );
}
