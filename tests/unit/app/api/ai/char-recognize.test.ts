import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const cookieStore = new Map<string, string>();
let currentUser: { id: number; isAdmin: boolean } | null = null;
let hasAiCallsFeature = true;
let anonCount = 0;
let userCount = 0;
let llmMockReply: string = '中';
let llmShouldThrow: Error | null = null;

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({
    get: (name: string) => cookieStore.has(name)
      ? { name, value: cookieStore.get(name)! }
      : undefined,
  }),
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(async () => currentUser),
}));

vi.mock('@/lib/membership', () => ({
  hasFeature: vi.fn(async (_userId: number, feature: string) =>
    feature === 'ai_calls' ? hasAiCallsFeature : false
  ),
}));

vi.mock('@/lib/ai-calls', () => ({
  checkAiRateLimit: vi.fn(async (_userId: number) => userCount < 5),
  checkAnonRateLimit: vi.fn(async (_ip: string) => ({ exceeded: anonCount >= 5, count: anonCount })),
  logAiCall: vi.fn(async () => { /* no-op */ }),
  withAiLogging: vi.fn(async (args: any, fn: () => Promise<any>) => {
    const start = Date.now();
    try { return await fn(); }
    finally { /* logAiCall would be called here */ }
  }),
  RateLimitError: class extends Error { constructor() { super('rate limit'); this.name = 'RateLimitError'; } },
}));

vi.mock('@/lib/llm', () => ({
  llmChat: vi.fn(async () => {
    if (llmShouldThrow) throw llmShouldThrow;
    return { content: llmMockReply };
  }),
}));

vi.mock('@/lib/config', () => ({
  getConfig: vi.fn(async (_key: string) => null),
}));

import { POST } from '@/app/api/ai/char-recognize/route';

beforeEach(() => {
  cookieStore.clear();
  currentUser = null;
  hasAiCallsFeature = true;
  anonCount = 0;
  userCount = 0;
  llmMockReply = '中';
  llmShouldThrow = null;
  vi.clearAllMocks();
});

function makeReq(body: any, ip = '1.2.3.4'): NextRequest {
  return new NextRequest('http://localhost/api/ai/char-recognize', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/char-recognize', () => {
  it('anonymous success: 200, returns { ok: true, char }, 5 in a row then 6th = 429', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true, char: '中' });
    }
    // 6th call: anonCount is now 5 in the check
    anonCount = 5;
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe('rate_limited');
  });

  it('logged-in without ai_calls: returns 403 membership_required', async () => {
    currentUser = { id: 100, isAdmin: false };
    hasAiCallsFeature = false;
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('membership_required');
  });

  it('logged-in with ai_calls but over limit: returns 429', async () => {
    currentUser = { id: 100, isAdmin: false };
    userCount = 5;
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(429);
  });

  it('invalid image: missing data URL prefix returns 400', async () => {
    const res = await POST(makeReq({ image: 'not-a-data-url' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_image');
  });

  it('LLM returns non-CJK: returns 502 not_recognized', async () => {
    llmMockReply = 'abc';
    const res = await POST(makeReq({ image: 'data:image/jpeg;base64,XYZ' }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('not_recognized');
  });
});