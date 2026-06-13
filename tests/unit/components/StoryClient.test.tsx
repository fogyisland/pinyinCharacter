// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { StoryClient } from '@/app/stories/StoryClient';

vi.mock('@/lib/api-stories', () => ({
  fetchRandomStory: vi.fn(),
}));

vi.mock('@/lib/tts', () => ({
  speak: vi.fn(),
  stopSpeaking: vi.fn(),
  pickChineseVoice: vi.fn(() => null),
}));

vi.mock('@/lib/story-history', () => ({
  getReadChars: vi.fn(() => ['龘']),
  addReadChar: vi.fn(),
  clearReadHistory: vi.fn(),
}));

import { fetchRandomStory } from '@/lib/api-stories';
import { speak, stopSpeaking } from '@/lib/tts';

const mockedFetch = fetchRandomStory as unknown as ReturnType<typeof vi.fn>;
const mockedSpeak = speak as unknown as ReturnType<typeof vi.fn>;
const mockedStop = stopSpeaking as unknown as ReturnType<typeof vi.fn>;

const INITIAL = {
  char: '龘', pinyin: 'dá', meaning: '古龙', story: '从前有一条龙',
  needsReview: true, generatedBy: 'openai:gpt-4o-mini',
  generatedAt: '2026-05-12T08:30:00Z', createdAt: '2026-05-12T08:00:00Z',
};

const NEXT = {
  char: '好', pinyin: 'hǎo', meaning: 'good', story: '好事发生',
  needsReview: true, generatedBy: 'openai:gpt-4o-mini',
  generatedAt: '2026-05-12T08:30:00Z', createdAt: '2026-05-12T08:00:00Z',
};

beforeEach(() => {
  mockedFetch.mockReset();
  mockedSpeak.mockReset();
  mockedStop.mockReset();
  mockedFetch.mockResolvedValue(NEXT);
});

describe('StoryClient', () => {
  it('renders initial char, pinyin, meaning, story', () => {
    render(<StoryClient initialChar={INITIAL} />);
    expect(screen.getByText('龘')).toBeInTheDocument();
    expect(screen.getByText('dá')).toBeInTheDocument();
    expect(screen.getByText('古龙')).toBeInTheDocument();
    expect(screen.getByText('从前有一条龙')).toBeInTheDocument();
  });

  it('shows "已读 1" after mount (initial char written)', () => {
    render(<StoryClient initialChar={INITIAL} />);
    expect(screen.getByText(/已读 1/)).toBeInTheDocument();
  });

  it('上一步 button is disabled when history is empty', () => {
    render(<StoryClient initialChar={INITIAL} />);
    const prevBtn = screen.getByRole('button', { name: /上一个/ });
    expect(prevBtn).toBeDisabled();
  });

  it('点 下一个 fetches new char and replaces current', async () => {
    render(<StoryClient initialChar={INITIAL} />);
    const nextBtn = screen.getByRole('button', { name: /下一个/ });
    fireEvent.click(nextBtn);
    await waitFor(() => expect(screen.getByText('好')).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('龘')).not.toBeInTheDocument();
  });

  it('点 上一个 (after a next) goes back without API call', async () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: /下一个/ }));
    await waitFor(() => expect(screen.getByText('好')).toBeInTheDocument());
    mockedFetch.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /上一个/ }));
    await waitFor(() => expect(screen.getByText('龘')).toBeInTheDocument());
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('键盘 → triggers next', async () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByText('好')).toBeInTheDocument());
  });

  it('键盘 ← triggers previous (no-op when empty)', () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByText('龘')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('点 朗读 calls speak with current story', () => {
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: /朗读/ }));
    expect(mockedSpeak).toHaveBeenCalledWith(expect.stringContaining('从前有一条龙'), expect.any(Object));
  });

  it('点 加字帖 link has correct href', () => {
    render(<StoryClient initialChar={INITIAL} />);
    const link = screen.getByRole('link', { name: /加字帖/ });
    expect(link).toHaveAttribute('href', `/worksheet?prefill=${encodeURIComponent('龘')}`);
  });

  it('fetch 失败 shows error and keeps current char', async () => {
    mockedFetch.mockRejectedValueOnce(new Error('network down'));
    render(<StoryClient initialChar={INITIAL} />);
    fireEvent.click(screen.getByRole('button', { name: /下一个/ }));
    await waitFor(() => expect(screen.getByText(/network down/)).toBeInTheDocument());
    expect(screen.getByText('龘')).toBeInTheDocument();
  });
});