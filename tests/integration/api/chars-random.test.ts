import { describe, it, expect } from 'vitest';
import { integrationDescribe, TEST_DATABASE_URL } from '../setup';
import { GET } from '@/app/api/chars/random/route';
import { NextRequest } from 'next/server';

integrationDescribe('GET /api/chars/random', () => {
  it('returns N chars for easy difficulty', async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const req = new NextRequest('http://localhost/api/chars/random?count=5&difficulty=easy');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.chars.length).toBe(5);
  });

  it('400 on count > 100', async () => {
    const req = new NextRequest('http://localhost/api/chars/random?count=200');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('400 on invalid difficulty', async () => {
    const req = new NextRequest('http://localhost/api/chars/random?difficulty=invalid');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('medium difficulty returns level 1+2 chars only', async () => {
    const req = new NextRequest('http://localhost/api/chars/random?count=20&difficulty=medium');
    const res = await GET(req);
    const j = await res.json();
    expect(j.ok).toBe(true);
    for (const c of j.data.chars) {
      const cp = c.char.codePointAt(0)!;
      expect(cp).toBeLessThanOrEqual(0x9FFF);
    }
  });
});
