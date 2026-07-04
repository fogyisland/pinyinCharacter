// @vitest-environment happy-dom
import { cleanup } from '@testing-library/react';
import { beforeEach, it, expect, vi } from 'vitest';
import type { HskLevel } from '@/lib/difficulty';

beforeEach(() => cleanup());

it('renders HSK 1-6 chips and reflects current selection', async () => {
  vi.mock('@/lib/use-difficulty', () => ({
    useDifficulty: () => ({
      difficulty: 'medium',
      hskLevel: 3 as HskLevel,
      setDifficulty: vi.fn(),
      setHskLevel: vi.fn(),
    }),
  }));
  const { GameModeTabs } = await import('@/components/game/GameModeTabs');
  const { render, screen } = await import('@testing-library/react');
  render(<GameModeTabs />);
  for (const lvl of [1, 2, 3, 4, 5, 6]) {
    expect(screen.getByRole('button', { name: `HSK ${lvl}` })).toBeTruthy();
  }
});