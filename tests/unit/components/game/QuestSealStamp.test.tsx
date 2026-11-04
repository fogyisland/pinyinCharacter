// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { QuestSealStamp } from '@/components/game/quest/QuestSealStamp';

/**
 * The seal component on its own.
 *
 * The runner's test file drives the seal through a whole question flow; this
 * file drives the component's own contract - the `autoHideMs` backstop and the
 * `null` "stay up" mode of the 通关 screen.
 *
 * The backstop matters: the seal is answer feedback, so it must clear
 * itself even if the caller keeps saying `visible` (a stale flag). Without
 * it, a red ✓ would sit on the char card for the rest of the level - which
 * is exactly the defect this component was written to remove.
 */
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The seal's own class list - the transition state is on the wrapper. */
function sealClass(): string {
  const seal = document.querySelector('[data-seal]');
  if (!seal) throw new Error('the seal is not rendered');
  return seal.className;
}

describe('the seal stamp', () => {
  it('fades out on its own after the auto-hide delay', () => {
    vi.useFakeTimers();
    render(<QuestSealStamp visible autoHideMs={1400} />);

    // One frame later the seal has entered.
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(sealClass()).toContain('opacity-100');

    // The auto-hide fires and the seal fades back out.
    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(sealClass()).toContain('opacity-0');
  });

  it('stays up when the auto-hide is turned off', () => {
    // The 通关 screen passes `autoHideMs={null}`: its seal is the mark of
    // the level being passed, not feedback for one answer.
    vi.useFakeTimers();
    render(<QuestSealStamp visible text="通" autoHideMs={null} />);

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(sealClass()).toContain('opacity-100');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(sealClass()).toContain('opacity-100');
  });

  it('renders nothing at all when it is not visible', () => {
    render(<QuestSealStamp visible={false} />);
    expect(document.querySelector('[data-seal]')).toBeNull();
  });

  it('carries the text it is given', () => {
    render(<QuestSealStamp visible text="通" />);
    expect(document.querySelector('[data-seal]')?.textContent).toBe('通');
  });

  it('sits in the corner by default and in the middle when asked', () => {
    // The char card's seal must not sit on the character, so it goes to the
    // corner. The 通关 screen has no character, and there the seal is the
    // picture - so it is centred.
    const { unmount } = render(<QuestSealStamp visible />);
    expect(sealClass()).toContain('right-0');
    expect(sealClass()).toContain('top-0');
    unmount();

    render(<QuestSealStamp visible placement="center" />);
    expect(sealClass()).toContain('inset-0');
    expect(sealClass()).toContain('items-center');
  });
});
