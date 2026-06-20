import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getPool, closePool } from '@/lib/db';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:4444';

// This test fetches against a live Next.js dev server (port 4444). The dev
// server reads DATABASE_URL from .env.local (piyin_dev on local MySQL).
// load-env.ts only reads .env (DATABASE_URL = piyin on remote), so we'd seed
// the wrong DB. Override DATABASE_URL here so test seed and dev server hit
// the same database.
const envLocalPath = resolve(__dirname, '..', '..', '..', '.env.local');
if (existsSync(envLocalPath) && !process.env.DATABASE_URL_OVERRIDE_DONE) {
  const content = readFileSync(envLocalPath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key !== 'DATABASE_URL') continue;
    process.env.DATABASE_URL = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    process.env.DATABASE_URL_OVERRIDE_DONE = '1';
    break;
  }
}

beforeAll(async () => {
  const pool = getPool();
  // NOTE: use pool.query, NOT pool.execute — mysql2's binary protocol
  // (execute) corrupts multi-byte UTF-8 strings on the parameter path.
  await pool.query(`DELETE FROM classics WHERE slug IN ('lunyu', 'dizigui')`);
  await pool.query(
    `INSERT INTO classics (slug, title, category, author, era, chunks) VALUES
     ('lunyu', '论语', 'four-books', '孔子', '春秋', ?),
     ('dizigui', '弟子规', 'mengxue', NULL, '清', ?)`,
    [
      JSON.stringify([{ id: 1, label: '学而第一', content: ['子曰学而时习之。'], pinyin: [[]] }]),
      JSON.stringify([{ id: 1, label: '总叙', content: ['弟子规圣人训。'], pinyin: [[]] }]),
    ],
  );
});
afterAll(async () => {
  // Clean up the seed rows so other tests / pages don't see them.
  const pool = getPool();
  await pool.query(`DELETE FROM classics WHERE slug IN ('lunyu', 'dizigui')`);
  await closePool();
});
beforeEach(async () => {});

describe('GET /api/classics', () => {
  it('returns list', async () => {
    const res = await fetch(`${BASE}/api/classics`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.data.total).toBeGreaterThanOrEqual(2);
    const slugs = data.data.items.map((i: any) => i.slug);
    expect(slugs).toContain('lunyu');
    expect(slugs).toContain('dizigui');
  });

  it('filters by category', async () => {
    const res = await fetch(`${BASE}/api/classics?category=four-books`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.items.map((i: any) => i.slug)).toEqual(['lunyu']);
  });

  it('rejects bad category', async () => {
    const res = await fetch(`${BASE}/api/classics?category=bogus`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/classics/[slug]', () => {
  it('returns detail', async () => {
    const res = await fetch(`${BASE}/api/classics/lunyu`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data.title).toBe('论语');
    expect(data.data.author).toBe('孔子');
    expect(data.data.chunks).toHaveLength(1);
  });

  it('404 for missing', async () => {
    const res = await fetch(`${BASE}/api/classics/nope`);
    expect(res.status).toBe(404);
  });
});
