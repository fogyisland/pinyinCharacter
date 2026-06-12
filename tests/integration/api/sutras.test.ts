import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { getPool, closePool } from '@/lib/db';
import { GET as listRoute } from '@/app/api/sutras/route';
import { GET as detailRoute } from '@/app/api/sutras/[id]/route';

const TEST_SLUG = 'xinjing';
let insertedId: number;

beforeAll(async () => {
  const pool = getPool();
  await pool.query(`DELETE FROM sutras WHERE slug = ?`, [TEST_SLUG]);
  const [result] = await pool.query<any>(
    `INSERT INTO sutras (title, slug, chunks) VALUES (?, ?, ?)`,
    [
      '心经',
      TEST_SLUG,
      JSON.stringify([
        { id: 0, label: '心经', content: ['观自在菩萨', '行深般若波罗蜜多时'], pinyin: [['guān'], ['xíng']] },
      ]),
    ]
  );
  insertedId = result.insertId;
});

afterAll(async () => {
  const pool = getPool();
  await pool.query(`DELETE FROM sutras WHERE slug = ?`, [TEST_SLUG]);
  await closePool();
});

describe('GET /api/sutras', () => {
  it('returns list with our test sutra', async () => {
    const req = new NextRequest(new URL('http://test/api/sutras'));
    const res = await listRoute(req);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(Array.isArray(j.data.items)).toBe(true);
    const found = j.data.items.find((s: any) => s.slug === TEST_SLUG);
    expect(found).toBeTruthy();
    expect(found.title).toBe('心经');
    expect(found.chunkCount).toBe(1);
  });

  it('filters by q', async () => {
    const req = new NextRequest(new URL('http://test/api/sutras?q=心'));
    const res = await listRoute(req);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.items.some((s: any) => s.slug === TEST_SLUG)).toBe(true);
  });

  it('returns 400 on bad page', async () => {
    const req = new NextRequest(new URL('http://test/api/sutras?page=-1'));
    const res = await listRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/sutras/[id]', () => {
  it('returns sutra detail with chunks', async () => {
    const req = new Request('http://test') as any;
    const res = await detailRoute(req, { params: Promise.resolve({ id: String(insertedId) }) });
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.data.title).toBe('心经');
    expect(j.data.chunks).toHaveLength(1);
    expect(j.data.chunks[0].label).toBe('心经');
  });

  it('returns 404 for missing id', async () => {
    const req = new Request('http://test') as any;
    const res = await detailRoute(req, { params: Promise.resolve({ id: '9999999' }) });
    expect(res.status).toBe(404);
  });
});
