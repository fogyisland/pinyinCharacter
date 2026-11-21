// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { PinyinFullSentence } from '@/components/PinyinFullSentence';

/**
 * The 拼音 → 汉字 panel.
 *
 * The panel used to be an orphan: it was written, it called
 * /api/pinyin/sentence, and nothing mounted it — the page said "互转" and
 * only converted one way. Mounting it is half the work; the other half is
 * showing the learner HOW MUCH to trust the answer, because a character
 * model gets some sentences wrong and the UI must not pretend otherwise.
 */

const { fetchSentenceMock } = vi.hoisted(() => ({ fetchSentenceMock: vi.fn() }));

vi.mock('@/lib/api', () => ({
  fetchSentence: fetchSentenceMock,
}));

vi.mock('@/lib/api-history', () => ({
  createHistoryRequest: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/lib/store', () => ({
  useAppStore: (selector: (state: { safeMode: boolean; script: string; user: null }) => unknown) =>
    selector({ safeMode: false, script: 'simplified', user: null }),
}));

vi.mock('@/components/ReadAloudButton', () => ({
  ReadAloudButton: ({ text }: { text: string }) => <button type="button">朗读：{text}</button>,
}));

beforeEach(() => {
  fetchSentenceMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('PinyinFullSentence', () => {
  it('converts tone-numbered pinyin into characters', async () => {
    fetchSentenceMock.mockResolvedValue({
      ok: true,
      data: { sentence: '我是老师', engine: 'tone-aware' },
    });
    render(<PinyinFullSentence />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wo3shi4lao3shi1' } });
    fireEvent.click(screen.getByRole('button', { name: '转换' }));
    await waitFor(() => {
      expect(screen.getByText('我是老师')).toBeTruthy();
    });
    expect(fetchSentenceMock).toHaveBeenCalledWith('wo3shi4lao3shi1', false, 'simplified');
  });

  it('says which engine answered when the tone-aware decoder did', async () => {
    fetchSentenceMock.mockResolvedValue({
      ok: true,
      data: { sentence: '我是老师', engine: 'tone-aware' },
    });
    render(<PinyinFullSentence />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wo3shi4lao3shi1' } });
    fireEvent.click(screen.getByRole('button', { name: '转换' }));
    await waitFor(() => {
      // The learner must know the answer used their tones.
      expect(screen.getByText(/按声调/)).toBeTruthy();
    });
  });

  it('warns that a classic answer may be wrong', async () => {
    // The shipped character model gets some sentences wrong (卧石老师 for
    // 我是老师). The panel cannot fix that, but it must not present a
    // rough guess as a certain answer.
    fetchSentenceMock.mockResolvedValue({
      ok: true,
      data: { sentence: '卧石老师', engine: 'classic' },
    });
    render(<PinyinFullSentence />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'wo3shi4lao3shi1' } });
    fireEvent.click(screen.getByRole('button', { name: '转换' }));
    await waitFor(() => {
      expect(screen.getByText(/可能不准/)).toBeTruthy();
    });
  });

  it('shows the failure instead of a blank result', async () => {
    fetchSentenceMock.mockResolvedValue({ ok: false, error: 'boom' });
    render(<PinyinFullSentence />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: '转换' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
  });

  it('teaches the input format before the learner types anything', () => {
    render(<PinyinFullSentence />);
    // Tone numbers are the whole point of the tone-aware path; the hint
    // must say so.
    expect(screen.getByText(/ni3hao3/)).toBeTruthy();
  });

  it('disables the button while converting', async () => {
    let resolve: (value: unknown) => void = () => {};
    fetchSentenceMock.mockReturnValue(new Promise((r) => {
      resolve = r;
    }));
    render(<PinyinFullSentence />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ni3hao3' } });
    fireEvent.click(screen.getByRole('button', { name: '转换' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /转换中/ })).toHaveProperty('disabled', true);
    });
    resolve({ ok: true, data: { sentence: '你好', engine: 'tone-aware' } });
  });
});
