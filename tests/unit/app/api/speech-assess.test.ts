// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/speech/assess —— 把录音交给 Azure，返回音节分数。
 *
 * 这一层不解析 Azure 的回复（`lib/azure-assessment.ts` 的事），只负责：
 *   - 权限：只有登录用户能用（它花的是站长的钱）；
 *   - 大小：录音不能无限大（一个 10 MB 的请求会拖垮内存）；
 *   - 未配置时不发请求，直接回退；
 *   - 失败时把分类带回去，供面板决定是「重试」还是「去后台改密钥」。
 */

const {
  getCurrentUserMock,
  assessPronunciationMock,
  isSpeechConfiguredMock,
  resolveDailyLimitMock,
  countAssessmentsTodayMock,
  recordAssessmentMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  assessPronunciationMock: vi.fn(),
  isSpeechConfiguredMock: vi.fn(),
  resolveDailyLimitMock: vi.fn(),
  countAssessmentsTodayMock: vi.fn(),
  recordAssessmentMock: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock('@/lib/azure-speech', async () => {
  const actual = await vi.importActual<typeof import('@/lib/azure-speech')>('@/lib/azure-speech');
  return {
    ...actual,
    isSpeechConfigured: isSpeechConfiguredMock,
    resolveDailyLimit: resolveDailyLimitMock,
  };
});
vi.mock('@/lib/azure-assessment', async () => {
  const actual = await vi.importActual<typeof import('@/lib/azure-assessment')>('@/lib/azure-assessment');
  return { ...actual, assessPronunciation: assessPronunciationMock };
});
vi.mock('@/lib/speech-store', () => ({
  countAssessmentsToday: countAssessmentsTodayMock,
  recordAssessment: recordAssessmentMock,
}));

import { GET as status, POST as assess } from '@/app/api/speech/assess/route';

const USER = { id: 9, username: '小明' };

function audioReq(bytes: number, reference = '学生'): NextRequest {
  const body = new Uint8Array(bytes);
  return new NextRequest(`http://localhost/api/speech/assess?reference=${encodeURIComponent(reference)}`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body,
  });
}

beforeEach(() => {
  getCurrentUserMock.mockReset();
  assessPronunciationMock.mockReset();
  isSpeechConfiguredMock.mockReset();
  resolveDailyLimitMock.mockReset();
  countAssessmentsTodayMock.mockReset();
  recordAssessmentMock.mockReset();
  getCurrentUserMock.mockResolvedValue(USER);
  isSpeechConfiguredMock.mockResolvedValue(true);
  // Unlimited by default, so the quota does not interfere with the cases
  // that are about something else.
  resolveDailyLimitMock.mockResolvedValue(0);
  countAssessmentsTodayMock.mockResolvedValue(0);
  recordAssessmentMock.mockResolvedValue(undefined);
  assessPronunciationMock.mockResolvedValue({
    ok: true,
    assessment: {
      reference: '学生',
      recognised: '学生',
      accuracy: 92,
      fluency: 95,
      completeness: 100,
      prosody: 88,
      pronunciation: 93.5,
      syllables: [],
      phonemes: [],
    },
  });
});

describe('GET /api/speech/assess — is it available?', () => {
  it('reports configured when the admin set a key', async () => {
    const res = await status();
    const body = await res.json();
    expect(body.data.configured).toBe(true);
  });

  it('reports not configured when there is no key', async () => {
    isSpeechConfiguredMock.mockResolvedValue(false);
    const res = await status();
    const body = await res.json();
    expect(body.data.configured).toBe(false);
  });

  it('is readable without logging in', async () => {
    // The panel asks this before rendering; a visitor must still be told the
    // feature exists even if they cannot use the paid path.
    getCurrentUserMock.mockResolvedValue(null);
    const res = await status();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.configured).toBe(true);
    // Two separate answers: the feature exists (configured), but this
    // caller may not use it (loggedIn false). A single boolean would make
    // the panel hide a configured feature from every visitor.
    expect(body.data.loggedIn).toBe(false);
  });

  it('reports the caller as logged in when they have a session', async () => {
    const res = await status();
    const body = await res.json();
    expect(body.data.loggedIn).toBe(true);
  });
});

describe('POST /api/speech/assess', () => {
  it('requires a login — the call costs money', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await assess(audioReq(100));
    expect(res.status).toBe(401);
    expect(assessPronunciationMock).not.toHaveBeenCalled();
  });

  it('requires a reference text', async () => {
    const res = await assess(audioReq(100, ''));
    expect(res.status).toBe(400);
  });

  it('rejects a body over the size limit instead of sending it', async () => {
    // 5 MB of WAV is ~25 seconds of speech; nothing a learner needs to read
    // one word should be near it.
    const res = await assess(audioReq(6 * 1024 * 1024));
    expect(res.status).toBe(413);
    expect(assessPronunciationMock).not.toHaveBeenCalled();
  });

  it('rejects an empty body', async () => {
    const res = await assess(audioReq(0));
    expect(res.status).toBe(400);
  });

  it('returns the assessment on success', async () => {
    const res = await assess(audioReq(100));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.assessment.pronunciation).toBe(93.5);
    expect(assessPronunciationMock).toHaveBeenCalledWith(expect.any(Uint8Array), '学生');
  });

  it('passes the failure reason through so the panel can act on it', async () => {
    assessPronunciationMock.mockResolvedValue({
      ok: false,
      reason: 'auth',
      message: '密钥无效',
    });
    const res = await assess(audioReq(100));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error.code).toBe('auth');
  });

  it('answers 503 when the service is not configured, so the panel falls back', async () => {
    assessPronunciationMock.mockResolvedValue({
      ok: false,
      reason: 'unconfigured',
      message: '未配置',
    });
    const res = await assess(audioReq(100));
    expect(res.status).toBe(503);
  });

  it('answers 429 when Azure is out of quota', async () => {
    assessPronunciationMock.mockResolvedValue({
      ok: false,
      reason: 'rate-limit',
      message: '配额',
    });
    const res = await assess(audioReq(100));
    expect(res.status).toBe(429);
    // Azure refused, so nothing was billed — and the learner's daily quota
    // must not be eaten by a call Azure never scored.
    expect(recordAssessmentMock).not.toHaveBeenCalled();
  });

  it('records a successful assessment for the daily quota', async () => {
    const res = await assess(audioReq(100));
    expect(res.status).toBe(200);
    expect(recordAssessmentMock).toHaveBeenCalledWith(
      9,
      expect.objectContaining({ reference: '学生', pronunciation: 93.5 }),
    );
  });

  it('refuses before reading the audio once the daily limit is reached', async () => {
    resolveDailyLimitMock.mockResolvedValue(3);
    countAssessmentsTodayMock.mockResolvedValue(3);
    const res = await assess(audioReq(100));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe('daily_limit');
    // The guard is in front of the paid call, not after it: an exhausted
    // quota must cost nothing.
    expect(assessPronunciationMock).not.toHaveBeenCalled();
  });

  it('allows a call when the quota is not spent yet', async () => {
    resolveDailyLimitMock.mockResolvedValue(3);
    countAssessmentsTodayMock.mockResolvedValue(2);
    const res = await assess(audioReq(100));
    expect(res.status).toBe(200);
    expect(assessPronunciationMock).toHaveBeenCalled();
  });

  it('treats a limit of 0 as unlimited', async () => {
    resolveDailyLimitMock.mockResolvedValue(0);
    countAssessmentsTodayMock.mockResolvedValue(999);
    const res = await assess(audioReq(100));
    expect(res.status).toBe(200);
    // No count query at all: an unlimited site saves a round trip per attempt.
    expect(countAssessmentsTodayMock).not.toHaveBeenCalled();
  });

  it('says what to do when the learner is not logged in', async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const res = await assess(audioReq(100));
    const body = await res.json();
    // "unauthorized" is a word an operator understands, not a learner.
    expect(body.error.message).toContain('登录');
    expect(body.error.message).toContain('跟读');
  });

  it('answers 503 with a migration hint when the quota table is missing', async () => {
    // A deploy that skipped `npm run db:migrate` must not surface as a bare
    // 500: the operator needs the command, and the learner needs to know the
    // free path still works.
    resolveDailyLimitMock.mockResolvedValue(20);
    countAssessmentsTodayMock.mockRejectedValue(
      Object.assign(new Error("ER_NO_SUCH_TABLE: Table 'pinyin_test.speech_assessments' doesn't exist"), {
        code: 'ER_NO_SUCH_TABLE',
        errno: 1146,
      }),
    );
    const res = await assess(audioReq(100));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe('schema_migration_pending');
    expect(body.error.message).toContain('db:migrate');
    // Nothing was sent to Azure, so nothing was billed.
    expect(assessPronunciationMock).not.toHaveBeenCalled();
  });

  it('leaves an unrelated database failure at 500', async () => {
    // If `users` were missing the whole site is down; naming this feature's
    // table would send the operator after the wrong migration.
    resolveDailyLimitMock.mockResolvedValue(20);
    countAssessmentsTodayMock.mockRejectedValue(new Error('boom'));
    const res = await assess(audioReq(100));
    expect(res.status).toBe(500);
  });
});
