import { describe, it, expect } from 'vitest';
import { buildSsml, buildWsUrl, TtsUpstreamError } from '@/lib/tts-edge';
import { SEC_MS_GEC_VERSION, TRUSTED_CLIENT_TOKEN } from '@/lib/tts-gec';

describe('buildWsUrl()', () => {
  it('带上端点要求的全部鉴权参数', () => {
    const url = buildWsUrl('ABCDEF', '0123456789abcdef');
    expect(url.startsWith('wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?')).toBe(true);
    expect(url).toContain(`Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}`);
    expect(url).toContain('Sec-MS-GEC=ABCDEF');
    expect(url).toContain(`Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}`);
    expect(url).toContain('ConnectionId=0123456789abcdef');
  });

  it('令牌与连接 ID 不会串到别的参数上', () => {
    const url = buildWsUrl('TOKENVALUE', 'CONNECTIONVALUE');
    const query = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    expect(query.get('Sec-MS-GEC')).toBe('TOKENVALUE');
    expect(query.get('ConnectionId')).toBe('CONNECTIONVALUE');
    expect(query.get('Ocp-Apim-Subscription-Key')).toBe(TRUSTED_CLIENT_TOKEN);
  });
});

describe('buildSsml()', () => {
  it('包含音色、prosody 与语言标记', () => {
    const ssml = buildSsml('zh-CN-XiaoxiaoNeural', '你好');
    expect(ssml).toContain("<speak version='1.0'");
    expect(ssml).toContain("xml:lang='zh-CN'");
    expect(ssml).toContain("<voice name='zh-CN-XiaoxiaoNeural'>");
    expect(ssml).toContain("<prosody pitch='+0Hz' rate='+0%' volume='+0%'>");
    expect(ssml).toContain('你好');
    expect(ssml).toContain('</speak>');
  });

  it('从音色名推断语言', () => {
    expect(buildSsml('en-US-JennyNeural', 'hi')).toContain("xml:lang='en-US'");
  });

  it('转义 XML 特殊字符', () => {
    const ssml = buildSsml('zh-CN-XiaoxiaoNeural', 'a & b < c > d " e \' f');
    expect(ssml).toContain('a &amp; b &lt; c &gt; d &quot; e &apos; f');
    expect(ssml).not.toContain('< c');
  });
});

describe('TtsUpstreamError', () => {
  it('保留失败分类与上游状态码', () => {
    const error = new TtsUpstreamError('上游握手被拒：HTTP 403', 'auth', 403);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TtsUpstreamError');
    expect(error.reason).toBe('auth');
    expect(error.upstreamStatus).toBe(403);
    expect(error.message).toContain('403');
  });

  it('默认没有上游状态码', () => {
    const error = new TtsUpstreamError('连接失败', 'network');
    expect(error.upstreamStatus).toBeNull();
  });
});
