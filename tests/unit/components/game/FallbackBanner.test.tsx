// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { beforeEach, it, expect } from 'vitest';

beforeEach(() => cleanup());

/**
 * The banner's wording.
 *
 * 2026-11-03: the banner used to say 「当前以 HSK N-1 字池代替」 — that the
 * game falls back to the tier BELOW. It never did. The fallback pool comes
 * from `sourceForHsk` (lib/difficulty.ts), which picks by DIFFICULTY:
 * `chars-level-1` / `chars-level-1-2` / `chars-all`. So the old wording
 * described a pool the code never used, and the reader was told a false
 * thing about what they were playing.
 *
 * The spec (2026-07-04-hsk-game-redesign-design.md §Fallback UI) fixes the
 * INTENT — "the banner is informational, not blocking; the game proceeds
 * with the fallback pool" — and only the hardcoded wording was wrong.
 */
it('renders the fallback message when unavailable', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { getByRole } = render(<FallbackBanner hskLevel={5} available={false} />);
  expect(getByRole('status').textContent).toContain('HSK 5');
  expect(getByRole('status').textContent).toContain('代替');
});

it('does not claim the game fell back to the tier below', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { getByRole } = render(<FallbackBanner hskLevel={5} available={false} />);
  // The fallback pool is the DIFFICULTY pool, not the HSK N-1 tier. Saying
  // otherwise sends the reader looking for a tier that was never used.
  expect(getByRole('status').textContent).not.toContain('HSK 4');
});

it('renders nothing when available', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { container } = render(<FallbackBanner hskLevel={5} available={true} />);
  expect(container.firstChild).toBeNull();
});

it('names the missing grading when the tier was never imported', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { getByRole } = render(
    <FallbackBanner hskLevel={5} available={false} tierMissing={true} />,
  );
  // A missing tier is a different situation from a thin one: nothing is
  // being filled in, an administrator has to run one command.
  expect(getByRole('status').textContent).toContain('尚未导入');
});

it('does not claim the grading is missing for a merely thin tier', async () => {
  const { FallbackBanner } = await import('@/components/game/FallbackBanner');
  const { getByRole } = render(<FallbackBanner hskLevel={5} available={false} />);
  expect(getByRole('status').textContent).not.toContain('尚未导入');
});
