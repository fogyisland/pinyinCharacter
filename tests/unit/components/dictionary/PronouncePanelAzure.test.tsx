// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

/**
 * 跟读面板 —— Azure 分支。
 *
 * 面板现在有两条路径：
 *
 *   1. **浏览器识别**（默认）：免费、录音不出浏览器、判定由本站规则做。
 *   2. **Azure 评估**（配置了 key 才有）：录音上传到本站服务端再转 Azure，
 *      换回音素级分数 —— 能说「xué 的 üe 读得不准」。
 *
 * 面板必须做对的三件事：
 *   - 没有 key 时**不显示** Azure 那条路径（它需要把录音发出去，不能默认开）；
 *   - Azure 失败时**退回**第一条路径，而不是把功能判死；
 *   - 两条路径的结果都落在同一个「逐字标记」上，学生不需要学两套 UI。
 */

const {
  recogniseOnceMock,
  isSpeechSupportedMock,
  recordOnceMock,
  fetchAssessStatusMock,
  assessWithAzureMock,
} = vi.hoisted(() => ({
  recogniseOnceMock: vi.fn(),
  isSpeechSupportedMock: vi.fn(),
  recordOnceMock: vi.fn(),
  fetchAssessStatusMock: vi.fn(),
  assessWithAzureMock: vi.fn(),
}));

vi.mock('@/lib/pronunciation-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pronunciation-client')>(
    '@/lib/pronunciation-client',
  );
  return { ...actual, recogniseOnce: recogniseOnceMock, isSpeechSupported: isSpeechSupportedMock };
});

vi.mock('@/lib/pronunciation-recorder', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pronunciation-recorder')>(
    '@/lib/pronunciation-recorder',
  );
  return { ...actual, recordOnce: recordOnceMock };
});

vi.mock('@/lib/api-speech', () => ({
  fetchAssessStatus: fetchAssessStatusMock,
  assessWithAzure: assessWithAzureMock,
}));

vi.mock('@/components/ReadAloudButton', () => ({
  ReadAloudButton: ({ text }: { text: string }) => (
    <button type="button" data-read-aloud>
      朗读：{text}
    </button>
  ),
}));

import { PronouncePanel } from '@/components/dictionary/PronouncePanel';

const WORD = {
  word: '学生',
  pinyin: 'xué shēng',
  chars: [
    { char: '学', pinyin: 'xué' },
    { char: '生', pinyin: 'shēng' },
  ],
};

beforeEach(() => {
  recogniseOnceMock.mockReset();
  isSpeechSupportedMock.mockReset();
  recordOnceMock.mockReset();
  fetchAssessStatusMock.mockReset();
  assessWithAzureMock.mockReset();
  isSpeechSupportedMock.mockReturnValue(true);
  recogniseOnceMock.mockResolvedValue({ ok: true, transcript: '学生' });
  fetchAssessStatusMock.mockResolvedValue({ configured: false, loggedIn: false });
});

afterEach(() => {
  cleanup();
});

describe('PronouncePanel — with Azure configured', () => {
  beforeEach(() => {
    fetchAssessStatusMock.mockResolvedValue({ configured: true, loggedIn: true });
  });

  it('offers a higher-accuracy button when Azure is available', async () => {
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => {
      // The two buttons say what they do: one is local, one is the paid
      // assessment. A learner choosing the second should know it uploads.
      expect(screen.getByRole('button', { name: /精评/ })).toBeTruthy();
    });
  });

  it('says the recording is uploaded before it is', async () => {
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByText(/传给 Azure/)).toBeTruthy());
  });

  it('scores through Azure and shows the syllable breakdown', async () => {
    recordOnceMock.mockResolvedValue({ ok: true, wav: new ArrayBuffer(4) });
    assessWithAzureMock.mockResolvedValue({
      ok: true,
      assessment: {
        reference: '学生',
        recognised: '学生',
        accuracy: 92,
        fluency: 95,
        completeness: 100,
        prosody: 88,
        pronunciation: 93.5,
        syllables: [
          { syllable: 'xué', accuracy: 88, fluency: 95, completeness: 100, prosody: null },
          { syllable: 'shēng', accuracy: 96, fluency: 95, completeness: 100, prosody: null },
        ],
        phonemes: [],
      },
    });
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /精评/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /精评/ }));
    await waitFor(() => {
      expect(screen.getByTestId('pronounce-score').textContent).toContain('94');
    });
    // The syllable scores are what justifies the paid call: 88 vs 96 tells
    // the learner WHICH syllable to fix.
    expect(screen.getByTestId('pronounce-syllables').textContent).toContain('88');
    expect(screen.getByTestId('pronounce-syllables').textContent).toContain('96');
  });

  it('falls back to the browser path when Azure fails', async () => {
    recordOnceMock.mockResolvedValue({ ok: true, wav: new ArrayBuffer(4) });
    assessWithAzureMock.mockResolvedValue({
      ok: false,
      code: 'auth',
      message: 'Azure 语音密钥无效。请管理员到后台的「语音评测」页更新。',
    });
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /精评/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /精评/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('密钥');
    });
    // The local path still works: a broken paid path must not take the
    // feature down with it. After an attempt the button says 「再读一遍」,
    // which is the same local path by another name.
    expect(screen.getByRole('button', { name: /再读一遍/ })).toBeTruthy();
  });

  it('reports a microphone refusal from the recorder', async () => {
    recordOnceMock.mockResolvedValue({ ok: false, reason: 'not-allowed' });
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /精评/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /精评/ }));
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('麦克风');
    });
  });

  it('marks a character Azure never heard as missing, not as wrong', async () => {
    // The learner said only 学 and stopped. Azure returns one syllable; the
    // 生 mark would otherwise be `undefined` and render as the "wrong" colour,
    // which blames the learner for a character the recogniser never scored.
    recordOnceMock.mockResolvedValue({ ok: true, wav: new ArrayBuffer(4) });
    assessWithAzureMock.mockResolvedValue({
      ok: true,
      assessment: {
        reference: '学生',
        recognised: '学',
        accuracy: 70,
        fluency: 60,
        completeness: 50,
        prosody: null,
        pronunciation: 70,
        syllables: [
          { syllable: 'xué', accuracy: 91, fluency: 90, completeness: 100, prosody: null },
        ],
        phonemes: [],
      },
    });
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /精评/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /精评/ }));
    await waitFor(() => expect(screen.getByTestId('pronounce-score')).toBeTruthy());
    const marks = screen.getAllByTestId('pronounce-char-mark');
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute('data-verdict')).toBe('exact');
    expect(marks[1].getAttribute('data-verdict')).toBe('missing');
  });
});

describe('PronouncePanel — without Azure', () => {
  it('does not offer the paid path at all', async () => {
    // Default state: no key. A button that uploads the learner's voice must
    // never appear just because the code could do it.
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /跟读/ })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /精评/ })).toBeNull();
    expect(screen.queryByText(/录音会传给/)).toBeNull();
    expect(screen.queryByText(/传给 Azure/)).toBeNull();
  });

  it('says nothing about logging in when the site has no key at all', async () => {
    // A visitor on a site without a key sees no Azure copy at all: telling
    // them to log in for a feature that does not exist is noise.
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /跟读/ })).toBeTruthy());
    expect(screen.queryByText(/需要登录/)).toBeNull();
  });
});

describe('PronouncePanel — Azure configured, visitor not logged in', () => {
  beforeEach(() => {
    fetchAssessStatusMock.mockResolvedValue({ configured: true, loggedIn: false });
  });

  it('hides the paid button but says why', async () => {
    // The button would 401. Offering it and letting the learner discover
    // that is worse than naming the reason up front.
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByText(/需要登录后使用/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: /精评/ })).toBeNull();
    // The free path is untouched: no login is needed for 跟读.
    expect(screen.getByRole('button', { name: /跟读/ })).toBeTruthy();
  });

  it('does not claim the recording will be uploaded', async () => {
    // An upload notice belongs next to the button that uploads. A visitor
    // cannot upload, so the sentence would describe something that cannot
    // happen.
    render(<PronouncePanel {...WORD} />);
    await waitFor(() => expect(screen.getByText(/需要登录后使用/)).toBeTruthy());
    expect(screen.queryByText(/录音会传给/)).toBeNull();
    expect(screen.queryByText(/传给 Azure/)).toBeNull();
  });
});
