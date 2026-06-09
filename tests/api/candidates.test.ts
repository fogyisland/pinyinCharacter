import { describe, it, expect } from 'vitest';
import { GET } from '@/app/api/pinyin/candidates/route';

describe('GET /api/pinyin/candidates', () => {
  it('returns candidates for a valid pinyin', async () => {
    const url = new URL('http://localhost/api/pinyin/candidates?pinyin=ni');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { candidates: { char: string; freq: number }[] } };
    expect(json.ok).toBe(true);
    expect(json.data.candidates.length).toBeGreaterThan(0);
  });

  it('returns 400 when pinyin is missing', async () => {
    const url = new URL('http://localhost/api/pinyin/candidates');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(400);
  });

  it('returns empty candidates for unknown pinyin', async () => {
    const url = new URL('http://localhost/api/pinyin/candidates?pinyin=zzzzz');
    const req = new Request(url);
    const res = await GET(req as never);
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; data: { candidates: unknown[] } };
    expect(json.data.candidates).toEqual([]);
  });
});
