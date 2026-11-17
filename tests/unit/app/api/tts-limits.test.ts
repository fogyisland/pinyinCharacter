import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const synthesizeMock = vi.fn();
vi.mock('@/lib/tts-edge', () => ({
  synthesize: (...args: unknown[]) => synthesizeMock(...args),
  TtsUpstreamError: class TtsUpstreamError extends Error {
    constructor(public reason: string) {
      super('upstream: ' + reason);
    }
  },
}));

vi.mock('@/lib/tts-config', () => ({
  getTtsConfig: vi.fn().mockResolvedValue({
    voiceMale: 'zh-CN-YunxiNeural',
    voiceFemale: 'zh-CN-XiaoxiaoNeural',
    audioFormat: 'audio-24khz-48kbitrate-mono-mp3',
  }),
}));

import { POST } from '@/app/api/tts/route';

beforeEach(() => {
  vi.clearAllMocks();
  synthesizeMock.mockResolvedValue(Buffer.from('fake-mp3-bytes'));
});

let ipCounter = 0;
function nextIp(): string {
  ipCounter += 1;
  return '192.0.2.' + ipCounter;
}

function postReq(body: unknown, ip = nextIp()): NextRequest {
  return new NextRequest('http://localhost/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/tts — the input size is bounded', () => {
  it('accepts a legitimate batch', async () => {
    // Real clients in this project send 500-800 characters per request
    // (`lib/tts.ts` batches at 500, `SutraAudioPlayer` at 800).
    const res = await POST(postReq({ text: 'a'.repeat(800) }));
    expect(res.status).toBe(200);
  });

  it('refuses a request larger than 2000 characters', async () => {
    // The server cap was 10 000 while every real client sends 500-800, so
    // one request could burn 12-20x the upstream work a legitimate request
    // needs — and the route is unauthenticated, so that was an
    // amplification lever.
    const res = await POST(postReq({ text: 'a'.repeat(2001) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('bad_input');
    expect(synthesizeMock).not.toHaveBeenCalled();
  });

  it('accepts exactly 2000 characters', async () => {
    const res = await POST(postReq({ text: 'a'.repeat(2000) }));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/tts — the request budget is bounded', () => {
  it('blocks the thirty-first request from one IP in a minute', async () => {
    // Every request costs a WebSocket, some CPU and some upstream quota.
    // Unbounded, this route was both a cost amplifier and a way to
    // exhaust the upstream quota so that LEGITIMATE users get denied.
    const ip = '198.18.0.1';
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) {
      last = await POST(postReq({ text: 'x' }, ip));
    }
    expect(last).not.toBeNull();
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error: { code: string } };
    expect(body.error.code).toBe('rate_limited');
  });

  it('does not call the upstream service once the budget is reached', async () => {
    const ip = '198.18.0.2';
    for (let i = 0; i < 31; i++) {
      await POST(postReq({ text: 'x' }, ip));
    }
    const calls = synthesizeMock.mock.calls.length;
    await POST(postReq({ text: 'x' }, ip));
    expect(synthesizeMock.mock.calls.length).toBe(calls);
  });

  it('keeps separate budgets per IP', async () => {
    const first = '198.18.0.3';
    for (let i = 0; i < 31; i++) {
      await POST(postReq({ text: 'x' }, first));
    }
    const res = await POST(postReq({ text: 'x' }, '198.18.0.4'));
    expect(res.status).toBe(200);
  });
});
