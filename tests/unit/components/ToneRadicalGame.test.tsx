// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { GlobalWindow } from 'happy-dom';
import { render, waitFor, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToneRadicalGame } from '@/components/game/ToneRadicalGame';

beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

vi.mock('@/lib/api-game', () => ({
  fetchGameRound: vi.fn(),
}));

import { fetchGameRound } from '@/lib/api-game';
const mockedFetch = fetchGameRound as unknown as ReturnType<typeof vi.fn>;

// Mock round pinned to 'tone' mode so tests are deterministic.
const ROUND = {
  mode: 'tone' as const,
  chars: [
    { char: '妈', pinyin: 'mā', meaning: 'mother' },
    { char: '好', pinyin: 'hǎo', meaning: 'good' },
    { char: '花', pinyin: 'huā', meaning: 'flower' },
    { char: '你', pinyin: 'nǐ', meaning: 'you' },
  ],
  charToAnswer: {
    '妈': { tone: 1, radical: '女', pinyin: 'mā' },
    '好': { tone: 3, radical: '女', pinyin: 'hǎo' },
    '花': { tone: 1, radical: '艹', pinyin: 'huā' },
    '你': { tone: 3, radical: '亻', pinyin: 'nǐ' },
  },
  toneChoices: [1, 2, 3, 4],
  radicalChoices: ['女', '艹', '亻'],
  pinyinChoices: ['mā', 'hǎo', 'huā', 'nǐ'],
};

beforeEach(() => {
  mockedFetch.mockReset();
  mockedFetch.mockResolvedValue(ROUND);
});

describe('ToneRadicalGame', () => {
  it('starts in loading state, then shows the tone-mode heading', async () => {
    render(<ToneRadicalGame />);
    expect(screen.getByText(/加载中/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/把声调拖到对应的字上/)).toBeInTheDocument());
  });

  it('renders all 4 chars', async () => {
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.getByText('妈')).toBeInTheDocument();
      expect(screen.getByText('好')).toBeInTheDocument();
      expect(screen.getByText('花')).toBeInTheDocument();
      expect(screen.getByText('你')).toBeInTheDocument();
    });
  });

  it('shows the mode subject badge (声调)', async () => {
    render(<ToneRadicalGame />);
    await waitFor(() => {
      expect(screen.getByText(/本轮:声调/)).toBeInTheDocument();
    });
  });
});
