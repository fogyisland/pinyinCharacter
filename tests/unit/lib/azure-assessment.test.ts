// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Azure 发音评估的响应解析。
 *
 * Azure 的回复很啰嗦：同一个分数既在顶层也在 word 级，音节和音素又是两层。
 * 面板只要三层东西：整词的分数、每个音节的分数（「哪个字读得不好」）、以及
 * 失败时能读懂的原因。
 *
 * 这个文件把真实回复的**裁剪样本**固化下来，钉住解析；`assessPronunciation`
 * 的网络部分用假 fetch 覆盖。
 */

const { resolveSpeechConfigMock } = vi.hoisted(() => ({ resolveSpeechConfigMock: vi.fn() }));

vi.mock('@/lib/azure-speech', async () => {
  const actual = await vi.importActual<typeof import('@/lib/azure-speech')>('@/lib/azure-speech');
  return { ...actual, resolveSpeechConfig: resolveSpeechConfigMock };
});

import { assessPronunciation, describeFailure, toAssessment } from '@/lib/azure-assessment';

/** A trimmed sample of a real Azure response for 「学生」. */
const SAMPLE = {
  RecognitionStatus: 'Success',
  DisplayText: '学生',
  NBest: [
    {
      Display: '学生',
      AccuracyScore: 92,
      FluencyScore: 95,
      CompletenessScore: 100,
      PronScore: 93.5,
      ProsodyScore: 88,
      Words: [
        {
          Word: '学生',
          PronunciationAssessment: { AccuracyScore: 92, PronScore: 93.5 },
          Syllables: [
            {
              Syllable: 'xué',
              PronunciationAssessment: { AccuracyScore: 88, FluencyScore: 95, CompletenessScore: 100 },
            },
            {
              Syllable: 'shēng',
              PronunciationAssessment: { AccuracyScore: 96, FluencyScore: 95, CompletenessScore: 100 },
            },
          ],
          Phonemes: [
            { Phoneme: 'x', PronunciationAssessment: { AccuracyScore: 90 } },
            { Phoneme: 'ue', PronunciationAssessment: { AccuracyScore: 86 } },
          ],
        },
      ],
    },
  ],
};

beforeEach(() => {
  resolveSpeechConfigMock.mockReset();
});

describe('toAssessment', () => {
  it('reads the word-level scores', () => {
    const result = toAssessment(SAMPLE, '学生');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessment.pronunciation).toBe(93.5);
    expect(result.assessment.accuracy).toBe(92);
    expect(result.assessment.fluency).toBe(95);
    expect(result.assessment.completeness).toBe(100);
    expect(result.assessment.prosody).toBe(88);
    expect(result.assessment.recognised).toBe('学生');
  });

  it('reads one score per syllable, so the panel can name the bad one', () => {
    const result = toAssessment(SAMPLE, '学生');
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessment.syllables.map((s) => s.syllable)).toEqual(['xué', 'shēng']);
    expect(result.assessment.syllables[0].accuracy).toBe(88);
    expect(result.assessment.syllables[1].accuracy).toBe(96);
  });

  it('reads the phonemes, which is what 「哪个音不对」 needs', () => {
    const result = toAssessment(SAMPLE, '学生');
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessment.phonemes.map((p) => p.phoneme)).toEqual(['x', 'ue']);
    expect(result.assessment.phonemes[1].accuracy).toBe(86);
  });

  it('reports a no-match response as a bad request, not as a zero score', () => {
    // RecognitionStatus "NoMatch" carries no NBest; reporting 0 would look
    // like the learner read everything wrong, when in fact nothing was heard.
    const result = toAssessment({ RecognitionStatus: 'NoMatch', NBest: [] }, '学生');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('bad-request');
  });

  it('tolerates a missing prosody score', () => {
    // Prosody is only returned when it was requested and supported; a null
    // must not become 0, which would read as "no intonation at all".
    const result = toAssessment(
      { RecognitionStatus: 'Success', DisplayText: '学生', NBest: [{ Display: '学生', AccuracyScore: 90 }] },
      '学生',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessment.prosody).toBeNull();
  });

  it('tolerates a response with no syllables or phonemes', () => {
    const result = toAssessment(
      { RecognitionStatus: 'Success', DisplayText: '学生', NBest: [{ Display: '学生', AccuracyScore: 80 }] },
      '学生',
    );
    if (!result.ok) throw new Error('expected ok');
    expect(result.assessment.syllables).toEqual([]);
    expect(result.assessment.phonemes).toEqual([]);
  });
});

describe('assessPronunciation', () => {
  it('returns unconfigured without calling Azure when there is no key', async () => {
    resolveSpeechConfigMock.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => new Response('should not be called', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await assessPronunciation(new Uint8Array([1, 2, 3]), '学生');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('unconfigured');
    // Nothing was sent: a recording must never leave for a service the
    // operator has not configured.
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('classifies a 401 as an auth failure', async () => {
    resolveSpeechConfigMock.mockResolvedValue({ region: 'eastasia', key: 'bad' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('bad key', { status: 401 })),
    );
    const result = await assessPronunciation(new Uint8Array([1]), '学生');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('auth');
    vi.unstubAllGlobals();
  });

  it('classifies a 429 as rate-limit, which is retryable', async () => {
    resolveSpeechConfigMock.mockResolvedValue({ region: 'eastasia', key: 'ok' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('quota', { status: 429 })));
    const result = await assessPronunciation(new Uint8Array([1]), '学生');
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('rate-limit');
    vi.unstubAllGlobals();
  });

  it('sends the key, the assessment header and the audio', async () => {
    resolveSpeechConfigMock.mockResolvedValue({ region: 'eastasia', key: 'secret' });
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(SAMPLE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await assessPronunciation(new Uint8Array([1, 2, 3]), '学生');
    expect(result.ok).toBe(true);
    const url = fetchMock.mock.calls[0]?.[0] ?? '';
    const init = fetchMock.mock.calls[0]?.[1] ?? {};
    expect(url).toBe(
      'https://eastasia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN',
    );
    const headers = init.headers as Record<string, string>;
    expect(headers['Ocp-Apim-Subscription-Key']).toBe('secret');
    // The header is base64 of the JSON that names the reference text.
    const header = Buffer.from(headers['Pronunciation-Assessment'], 'base64').toString('utf8');
    expect(JSON.parse(header).ReferenceText).toBe('学生');
    vi.unstubAllGlobals();
  });

  it('never puts the key in the URL', async () => {
    // A key in a query string ends up in proxy logs and browser history.
    resolveSpeechConfigMock.mockResolvedValue({ region: 'eastasia', key: 'secret' });
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(SAMPLE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await assessPronunciation(new Uint8Array([1]), '学生');
    const url = fetchMock.mock.calls[0]?.[0] ?? '';
    expect(url).not.toContain('secret');
    vi.unstubAllGlobals();
  });

  it('treats a network failure as upstream and keeps going', async () => {
    resolveSpeechConfigMock.mockResolvedValue({ region: 'eastasia', key: 'ok' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const result = await assessPronunciation(new Uint8Array([1]), '学生');
    if (result.ok) throw new Error('expected failure');
    expect(result.reason).toBe('upstream');
    vi.unstubAllGlobals();
  });
});

describe('describeFailure', () => {
  it('says what the operator must fix for an auth failure', () => {
    // 「密钥无效」 alone leaves them hunting; naming the page fixes it.
    expect(describeFailure('auth')).toContain('后台');
  });

  it('says the unconfigured case falls back rather than fails', () => {
    expect(describeFailure('unconfigured')).toContain('浏览器识别');
  });

  it('tells the learner to retry for a transient upstream failure', () => {
    expect(describeFailure('upstream')).toContain('稍后再试');
  });
});
