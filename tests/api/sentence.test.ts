import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/pinyin/sentence/route';

describe('GET /api/pinyin/sentence', () => {
  it('returns sentence for valid pinyin', async () => {
    const url = new URL('http://localhost/api/pinyin/sentence?pinyin=ni3hao3');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { sentence: string } };
    expect(json.data.sentence).toBe('你好');
  });

  it('returns 400 when pinyin missing', async () => {
    const url = new URL('http://localhost/api/pinyin/sentence');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });
});
