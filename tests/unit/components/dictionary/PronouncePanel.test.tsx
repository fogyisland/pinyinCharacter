// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * 跟读面板。
 *
 * 它把三样东西接起来：浏览器的语音识别（听）、读音判定（比）、和学生的
 * 听觉记忆（再听一遍范读）。测试不碰麦克风 —— 识别器是假的，只要面板
 * 在拿到文字后做出正确的判断与反馈即可。
 *
 * 三个必须守住的点：
 *   1. 读完给出分数与「哪一笔/哪个调不对」的具体提示；
 *   2. 失败时说清楚要做什么（麦克风权限、重试），不是一句「失败」；
 *   3. 没有识别能力的浏览器不显示麦克风按钮，而不是显示一个按不动的。
 */

const { recogniseOnceMock, isSpeechSupportedMock } = vi.hoisted(() => ({
  recogniseOnceMock: vi.fn(),
  isSpeechSupportedMock: vi.fn(),
}));

vi.mock('@/lib/pronunciation-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pronunciation-client')>(
    '@/lib/pronunciation-client',
  );
  return {
    ...actual,
    recogniseOnce: recogniseOnceMock,
    isSpeechSupported: isSpeechSupportedMock,
  };
});

vi.mock('@/components/ReadAloudButton', () => ({
  ReadAloudButton: ({ text }: { text: string }) => (
    <button type="button" data-read-aloud>
      朗读：{text}
    </button>
  ),
}));

import { PronouncePanel } from '@/components/dictionary/PronouncePanel';

beforeEach(() => {
  recogniseOnceMock.mockReset();
  isSpeechSupportedMock.mockReset();
  isSpeechSupportedMock.mockReturnValue(true);
  recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '学生' });
});

afterEach(() => {
  cleanup();
});

const WORD = {
  word: '学生',
  pinyin: 'xué shēng',
  chars: [
    { char: '学', pinyin: 'xué' },
    { char: '生', pinyin: 'shēng' },
  ],
};

describe('PronouncePanel', () => {
  it('shows the word and a microphone button', () => {
    render(<PronouncePanel {...WORD} />);
    expect(screen.getByText('学生')).toBeTruthy();
    expect(screen.getByRole('button', { name: /跟读/ })).toBeTruthy();
  });

  it('hides the microphone when the browser cannot listen', () => {
    isSpeechSupportedMock.mockReturnValue(false);
    render(<PronouncePanel {...WORD} />);
    expect(screen.queryByRole('button', { name: /跟读/ })).toBeNull();
    // It still says why, instead of leaving an empty panel.
    expect(screen.getByText(/不支持语音识别/)).toBeTruthy();
  });

  it('scores a correct reading as perfect', async () => {
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => expect(screen.getByTestId('pronounce-score').textContent).toContain('100'));
    expect(screen.getByText(/读对了/)).toBeTruthy();
  });

  it('says the tone is wrong when only the tone differed', async () => {
    // 学生 read as 雪生: right syllables, wrong tone on the first.
    recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '雪生' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => expect(screen.getByTestId('pronounce-advice').textContent).toContain('声调'));
  });

  it('marks which character was wrong, not just the score', async () => {
    recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '学天' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => {
      const marks = screen.getAllByTestId('pronounce-char-mark');
      expect(marks).toHaveLength(2);
      expect(marks[0].getAttribute('data-verdict')).toBe('exact');
      expect(marks[1].getAttribute('data-verdict')).toBe('wrong');
    });
  });

  it('shows the recognised text so the learner can see what was heard', async () => {
    recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '学天' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => expect(screen.getByTestId('pronounce-heard').textContent).toContain('学天'));
  });

  it('explains a microphone refusal in terms the learner can act on', async () => {
    recogniseOnceMock.mockResolvedValue({ ok: false, reason: 'not-allowed' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('麦克风');
    });
  });

  it('offers a retry after a failure', async () => {
    recogniseOnceMock.mockResolvedValue({ ok: false, reason: 'no-speech' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /再读一遍/ })).toBeTruthy());
  });

  it('finds the word inside a longer sentence', async () => {
    recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '我是学生' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => expect(screen.getByTestId('pronounce-score').textContent).toContain('100'));
  });

  it('does not score when nothing was heard', async () => {
    recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '。' });
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('没有听到');
    });
  });

  it('shows a listening state while the recogniser runs', async () => {
    recogniseOnceMock.mockReturnValue(new Promise(() => {}));
    render(<PronouncePanel {...WORD} />);
    fireEvent.click(screen.getByRole('button', { name: /跟读/ }));
    await waitFor(() => expect(screen.getByText(/正在听/)).toBeTruthy());
  });
});
