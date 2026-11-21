// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { DictationRunner } from '@/components/dictation/DictationRunner';
import type { DictationItem } from '@/lib/dictation';

/**
 * The classroom dictation runner.
 *
 * The screen's whole job is four things: SPEAK, COUNT DOWN, REVEAL,
 * RECORD. The student writes on paper — there is no handwriting on
 * screen. A TTS failure must never stop the lesson: the teacher can
 * always reveal and advance by hand.
 *
 * The word is hidden until the reveal on purpose: showing it would turn
 * dictation into copying.
 */

const { speakMock, stopSpeakingMock } = vi.hoisted(() => ({
  speakMock: vi.fn(async () => {}),
  stopSpeakingMock: vi.fn(),
}));

vi.mock('@/lib/tts', () => ({
  speak: speakMock,
  stopSpeaking: stopSpeakingMock,
}));

function item(word: string, pinyin = ''): DictationItem {
  return { word, pinyin, chars: Array.from(word) };
}

const ITEMS: DictationItem[] = [item('你好', 'nǐ hǎo'), item('世界', 'shì jiè')];

beforeEach(() => {
  speakMock.mockClear();
  stopSpeakingMock.mockClear();
  speakMock.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Start the round (the click is also the browser's audio-gesture). */
function start(): void {
  fireEvent.click(screen.getByRole('button', { name: /开始报听写/ }));
}

describe('DictationRunner', () => {
  it('speaks the current item when the round starts', () => {
    render(<DictationRunner items={ITEMS} />);
    expect(speakMock).not.toHaveBeenCalled();
    start();
    expect(speakMock).toHaveBeenCalledWith('你好', expect.anything());
  });

  it('hides the word until it is revealed', () => {
    render(<DictationRunner items={ITEMS} />);
    start();
    // During the listening the word must not be on screen — that would
    // turn dictation into copying.
    expect(screen.queryByText('你好')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /揭晓/ }));
    expect(screen.getByText('你好')).toBeTruthy();
  });

  it('auto-advances after the interval', async () => {
    vi.useFakeTimers();
    render(<DictationRunner items={ITEMS} intervalSec={5} />);
    start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5100);
    });
    expect(speakMock).toHaveBeenCalledWith('世界', expect.anything());
  });

  it('manual mode does not auto-advance', async () => {
    vi.useFakeTimers();
    render(<DictationRunner items={ITEMS} intervalSec={null} />);
    start();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Still on item 1 after a minute: the rhythm belongs to the teacher.
    expect(speakMock).toHaveBeenCalledTimes(1);
  });

  it('marks wrong items and collects them', () => {
    render(<DictationRunner items={ITEMS} intervalSec={null} />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /错/ }));
    // The wrong word is collected for the re-test round.
    expect(screen.getByText(/错词/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /错/ }));
    // Round over: the summary lists both wrong words.
    expect(screen.getByTestId('dictation-wrong-list').textContent).toContain('你好');
    expect(screen.getByTestId('dictation-wrong-list').textContent).toContain('世界');
  });

  it('advances on 对 without collecting the word', () => {
    render(<DictationRunner items={ITEMS} intervalSec={null} />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /对/ }));
    expect(screen.getByTestId('dictation-progress').textContent).toContain('2');
  });

  it('regenerates a round from the wrong items only, renumbering from 1', () => {
    render(<DictationRunner items={ITEMS} intervalSec={null} />);
    start();
    fireEvent.click(screen.getByRole('button', { name: /错/ })); // 你好 wrong
    fireEvent.click(screen.getByRole('button', { name: /对/ })); // 世界 right
    fireEvent.click(screen.getByRole('button', { name: /用错词再出卷/ }));
    // The new round holds exactly the wrong word, numbered 1 of 1.
    expect(screen.getByTestId('dictation-progress').textContent).toContain('1 / 1');
    fireEvent.click(screen.getByRole('button', { name: /揭晓/ }));
    expect(screen.getByText('你好')).toBeTruthy();
    expect(screen.queryByText('世界')).toBeNull();
  });

  it('survives a speak failure without blocking the lesson', async () => {
    speakMock.mockRejectedValueOnce(new Error('no network'));
    render(<DictationRunner items={ITEMS} intervalSec={null} />);
    start();
    await act(async () => {});
    // The failure is reported...
    expect(screen.getByText(/朗读失败/)).toBeTruthy();
    // ...but the teacher can still reveal and advance by hand.
    fireEvent.click(screen.getByRole('button', { name: /揭晓/ }));
    expect(screen.getByText('你好')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /下一条/ }));
    expect(screen.getByTestId('dictation-progress').textContent).toContain('2');
  });

  it('shows the empty state when there are no items', () => {
    render(<DictationRunner items={[]} />);
    expect(screen.getByText(/还没有词条/)).toBeTruthy();
  });
});
