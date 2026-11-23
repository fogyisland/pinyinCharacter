// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Azure Speech —— 配置读取与失败分类（纯逻辑，不联网）。
 *
 * 这一层只回答三个问题：
 *   1. 后台配的 region / key 是否齐全；
 *   2. 五种失败（未配置、鉴权、限流、网络、上游异常）怎么分类 ——
 *      **分类决定行为**：鉴权失败停手，限流可重试，超时降级；
 *   3. 发给 Azure 的 `Pronunciation-Assessment` 头长什么样。
 */

const { getConfigMock } = vi.hoisted(() => ({ getConfigMock: vi.fn() }));

vi.mock('@/lib/config', () => ({ getConfig: getConfigMock }));

import {
  ASSESSMENT_KEYS,
  DEFAULT_DAILY_LIMIT,
  SPEECH_DAILY_LIMIT_KEY,
  buildAssessmentHeader,
  classifySpeechFailure,
  describeConfigState,
  isSpeechConfigured,
  resolveDailyLimit,
  resolveSpeechConfig,
} from '@/lib/azure-speech';

beforeEach(() => {
  getConfigMock.mockReset();
  getConfigMock.mockResolvedValue(null);
});

describe('resolving the Azure Speech config', () => {
  it('returns null when the key is missing', async () => {
    getConfigMock.mockImplementation(async (key: string) =>
      key === 'speech.region' ? 'eastasia' : null,
    );
    expect(await resolveSpeechConfig()).toBeNull();
  });

  it('returns null when the region is missing', async () => {
    getConfigMock.mockImplementation(async (key: string) =>
      key === 'speech.key' ? 'abc' : null,
    );
    expect(await resolveSpeechConfig()).toBeNull();
  });

  it('reads both values when they are configured', async () => {
    getConfigMock.mockImplementation(async (key: string) => {
      if (key === 'speech.region') return ' eastasia ';
      if (key === 'speech.key') return '  secret  ';
      return null;
    });
    const config = await resolveSpeechConfig();
    // Trimmed: a pasted key often carries a trailing newline, and a key with
    // whitespace is a 401 nobody can explain.
    expect(config).toEqual({ region: 'eastasia', key: 'secret' });
  });

  it('falls back to the environment when the database has no row', async () => {
    getConfigMock.mockResolvedValue(null);
    process.env.AZURE_SPEECH_KEY = 'env-key';
    process.env.AZURE_SPEECH_REGION = 'westus';
    const config = await resolveSpeechConfig();
    expect(config).toEqual({ region: 'westus', key: 'env-key' });
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
  });

  it('prefers the database over the environment', async () => {
    process.env.AZURE_SPEECH_KEY = 'env-key';
    process.env.AZURE_SPEECH_REGION = 'westus';
    getConfigMock.mockImplementation(async (key: string) => {
      if (key === 'speech.region') return 'eastasia';
      if (key === 'speech.key') return 'db-key';
      return null;
    });
    expect(await resolveSpeechConfig()).toEqual({ region: 'eastasia', key: 'db-key' });
    delete process.env.AZURE_SPEECH_KEY;
    delete process.env.AZURE_SPEECH_REGION;
  });
});

describe('isSpeechConfigured', () => {
  it('is false with nothing configured', async () => {
    expect(await isSpeechConfigured()).toBe(false);
  });

  it('is true once both values exist', async () => {
    getConfigMock.mockImplementation(async (key: string) => {
      if (key === 'speech.region') return 'eastasia';
      if (key === 'speech.key') return 'abc';
      return null;
    });
    expect(await isSpeechConfigured()).toBe(true);
  });
});

describe('describeConfigState', () => {
  it('names the missing field, not just "not configured"', () => {
    // 「没配置」 makes an operator hunt; 「缺少 region」 fixes it in one step.
    expect(describeConfigState({ region: '', key: 'abc' })).toContain('region');
    expect(describeConfigState({ region: 'eastasia', key: '' })).toContain('key');
    expect(describeConfigState(null)).toContain('未配置');
  });

  it('says nothing to fix when both are present', () => {
    expect(describeConfigState({ region: 'eastasia', key: 'abc' })).toBe('');
  });
});

describe('classifySpeechFailure', () => {
  it('separates a bad key from a throttled key', () => {
    // 401/403 means stop and fix the key; 429 means wait and retry. Treating
    // them the same either hides a real misconfiguration or gives up on a
    // request that would succeed in a minute.
    expect(classifySpeechFailure(401)).toBe('auth');
    expect(classifySpeechFailure(403)).toBe('auth');
    expect(classifySpeechFailure(429)).toBe('rate-limit');
  });

  it('treats 5xx as a retryable upstream problem', () => {
    expect(classifySpeechFailure(500)).toBe('upstream');
    expect(classifySpeechFailure(503)).toBe('upstream');
  });

  it('treats 400 as a bad request the caller must fix', () => {
    // 400 from Azure usually means a malformed assessment header or an audio
    // format it will not take — retrying is pointless.
    expect(classifySpeechFailure(400)).toBe('bad-request');
  });

  it('maps a missing config to its own class', () => {
    expect(classifySpeechFailure(null)).toBe('unconfigured');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifySpeechFailure(418)).toBe('unknown');
  });
});

describe('buildAssessmentHeader', () => {
  it('base64-encodes the Chinese reference text so the header stays ASCII', () => {
    // An HTTP header cannot carry 汉字; Azure expects the JSON base64-encoded,
    // and a raw UTF-8 header would be mangled by the transport.
    const header = buildAssessmentHeader('你好');
    expect(() => {
      // eslint-disable-next-line no-restricted-syntax -- proves ASCII-only
      for (const char of header) expect(char.charCodeAt(0)).toBeLessThan(128);
    }).not.toThrow();
    const decoded = JSON.parse(
      decodeURIComponent(escape(Buffer.from(header, 'base64').toString('binary'))),
    ) as { ReferenceText: string };
    expect(decoded.ReferenceText).toBe('你好');
  });

  it('asks for a hundred-mark scale, phoneme granularity and miscue detection', () => {
    // HundredMark: 0–100 is what a learner reads. Phoneme: enough detail to
    // say WHICH syllable failed. EnableMiscue: so a skipped character is a
    // miscue rather than silence the recogniser drops.
    const decoded = JSON.parse(
      decodeURIComponent(escape(Buffer.from(buildAssessmentHeader('学生'), 'base64').toString('binary'))),
    ) as Record<string, unknown>;
    expect(decoded.GradingSystem).toBe('HundredMark');
    expect(decoded.Granularity).toBe('Phoneme');
    expect(decoded.EnableMiscue).toBe(true);
  });

  it('uses zh-CN by default', () => {
    const decoded = JSON.parse(
      decodeURIComponent(escape(Buffer.from(buildAssessmentHeader('学生'), 'base64').toString('binary'))),
    ) as Record<string, unknown>;
    expect(decoded.Locale ?? 'zh-CN').toBe('zh-CN');
  });
});

describe('ASSESSMENT_KEYS', () => {
  it('lists the two keys the admin panel writes', () => {
    expect(ASSESSMENT_KEYS).toContain('speech.key');
    expect(ASSESSMENT_KEYS).toContain('speech.region');
  });
});

describe('resolveDailyLimit', () => {
  it('reads the stored cap', async () => {
    getConfigMock.mockImplementation(async (key: string) =>
      key === SPEECH_DAILY_LIMIT_KEY ? '5' : null,
    );
    expect(await resolveDailyLimit()).toBe(5);
  });

  it('treats 0 as unlimited, explicitly', async () => {
    getConfigMock.mockImplementation(async (key: string) =>
      key === SPEECH_DAILY_LIMIT_KEY ? '0' : null,
    );
    expect(await resolveDailyLimit()).toBe(0);
  });

  it('falls back to the default when nothing is stored', async () => {
    expect(await resolveDailyLimit()).toBe(DEFAULT_DAILY_LIMIT);
  });

  it('falls back to the default rather than becoming unlimited on garbage', async () => {
    // A typo must not read as "no limit": that is the direction that costs
    // money, so an unusable value keeps the default cap.
    getConfigMock.mockImplementation(async (key: string) =>
      key === SPEECH_DAILY_LIMIT_KEY ? 'twenty' : null,
    );
    expect(await resolveDailyLimit()).toBe(DEFAULT_DAILY_LIMIT);
  });

  it('reads the environment when the database has no row', async () => {
    process.env.AZURE_SPEECH_DAILY_LIMIT = '7';
    expect(await resolveDailyLimit()).toBe(7);
    delete process.env.AZURE_SPEECH_DAILY_LIMIT;
  });
});
