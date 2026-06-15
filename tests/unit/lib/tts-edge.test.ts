import { describe, it, expect } from 'vitest';
import { buildSsml } from '@/lib/tts-edge';

describe('buildSsml', () => {
  it('includes voice name and text', () => {
    const ssml = buildSsml('zh-CN-YunjianNeural', 'audio-24khz-48kbitrate-mono-mp3', '你好');
    expect(ssml).toContain("voice name='zh-CN-YunjianNeural'");
    expect(ssml).toContain('你好');
  });

  it('escapes XML special chars', () => {
    const ssml = buildSsml('v', 'f', '<a>');
    expect(ssml).toContain('&lt;a&gt;');
    expect(ssml).not.toContain('<a>');
  });

  it('escapes ampersand', () => {
    const ssml = buildSsml('v', 'f', 'A & B');
    expect(ssml).toContain('A &amp; B');
  });
});
