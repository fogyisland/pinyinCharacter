import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(),
}));

import { getTtsConfig } from '@/lib/tts-config';
import { getConfig } from '@/lib/config';

const mocked = vi.mocked(getConfig);

describe('getTtsConfig', () => {
  beforeEach(() => mocked.mockReset());

  it('returns defaults when DB has no values', async () => {
    mocked.mockResolvedValue(null);
    const cfg = await getTtsConfig();
    expect(cfg).toEqual({
      voiceMale: 'zh-CN-YunjianNeural',
      voiceFemale: 'zh-CN-XiaoxiaoNeural',
      audioFormat: 'audio-24khz-48kbitrate-mono-mp3',
    });
  });

  it('returns DB values when present', async () => {
    mocked.mockImplementation(async (k) => {
      if (k === 'tts.voice_male') return 'zh-CN-YunxiNeural';
      if (k === 'tts.voice_female') return 'zh-CN-XiaoyiNeural';
      if (k === 'tts.audio_format') return 'audio-16khz-128kbitrate-mono-mp3';
      return null;
    });
    const cfg = await getTtsConfig();
    expect(cfg.voiceMale).toBe('zh-CN-YunxiNeural');
    expect(cfg.voiceFemale).toBe('zh-CN-XiaoyiNeural');
    expect(cfg.audioFormat).toBe('audio-16khz-128kbitrate-mono-mp3');
  });
});
