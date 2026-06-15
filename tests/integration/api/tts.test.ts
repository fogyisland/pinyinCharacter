import { describe, it, expect, beforeAll } from 'vitest';
import { integrationDescribe, TEST_DATABASE_URL } from '../setup';
import { POST } from '@/app/api/tts/route';
import { NextRequest } from 'next/server';
import { setConfig } from '@/lib/config';

integrationDescribe('POST /api/tts', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    await setConfig('tts.voice_male', 'zh-CN-YunjianNeural', null);
    await setConfig('tts.voice_female', 'zh-CN-XiaoxiaoNeural', null);
    await setConfig('tts.audio_format', 'audio-24khz-48kbitrate-mono-mp3', null);
  });

  it('400 on empty text', async () => {
    const req = new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 on invalid voice', async () => {
    const req = new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '你好', voice: 'invalid' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it.skip('200 audio/mpeg on valid request (skipped — no network in CI)', async () => {
    const req = new NextRequest('http://localhost/api/tts', {
      method: 'POST', body: JSON.stringify({ text: '你好', voice: 'female' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
  });
});
