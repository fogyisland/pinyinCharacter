import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SutraChunk } from '@/lib/sutra-types';
type SutraChunkType = SutraChunk;

// Mock process.cwd() to a temp dir so we don't pollute the real data/.
// We override BEFORE importing the module under test so the SUTRAS_DIR
// constant captures the temp path.
const tempDir = mkdtempSync(join(tmpdir(), 'sutras-fs-test-'));
const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

const {
  sutrasFsAvailable,
  readSutraManifest,
  readSutraChunksBySlug,
  listSutrasFromFs,
  getSutraByIdFromFs,
  sutraExistsBySlug,
  writeSutrasFs,
  sutraFsStats,
} = await import('@/lib/sutras-fs');

function seedFs() {
  const items = [
    { id: 1, slug: 'xinjing', title: '心经', chunkCount: 1, charCount: 260 },
    { id: 2, slug: 'jingang', title: '金刚经', chunkCount: 32, charCount: 5000 },
    { id: 3, slug: 'yaoshi', title: '药师经', chunkCount: 1, charCount: 1500 },
  ];
  const chunksBySlug: Record<string, SutraChunkType[]> = {
    xinjing: [{ id: 1, label: '心经', content: ['观自在菩萨'], pinyin: [['guān']] }],
    jingang: [
      { id: 1, label: '法会因由分第一', content: ['如是我闻'], pinyin: [['rú']] },
      { id: 2, label: '善现启请分第二', content: ['时长老须菩提'], pinyin: [['shí']] },
    ],
    yaoshi: [{ id: 1, label: '药师经', content: ['如是我闻'], pinyin: [['rú']] }],
  };
  writeSutrasFs({ items, chunksBySlug });
}

describe('sutras-fs', () => {
  beforeEach(() => {
    // Clean dir between tests
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    cwdSpy.mockClear();
  });

  it('reports not available when manifest missing', () => {
    expect(sutrasFsAvailable()).toBe(false);
    expect(readSutraManifest()).toBeNull();
  });

  it('writes and reads manifest + per-sutra JSON atomically', () => {
    seedFs();
    expect(sutrasFsAvailable()).toBe(true);
    const m = readSutraManifest();
    expect(m?.items).toHaveLength(3);
    expect(m?.items[0]?.slug).toBe('xinjing');
    const chunks = readSutraChunksBySlug('jingang');
    expect(chunks).toHaveLength(2);
    expect(chunks?.[0]?.label).toBe('法会因由分第一');
  });

  it('listSutrasFromFs filters by q (title substring)', () => {
    seedFs();
    const r = listSutrasFromFs({ q: '金刚' });
    expect(r?.items).toHaveLength(1);
    expect(r?.items[0]?.slug).toBe('jingang');
    expect(r?.total).toBe(1);
  });

  it('listSutrasFromFs paginates', () => {
    seedFs();
    const r = listSutrasFromFs({ page: 1, pageSize: 2 });
    expect(r?.items).toHaveLength(2);
    expect(r?.total).toBe(3);
    expect(r?.page).toBe(1);
    expect(r?.pageSize).toBe(2);
    const r2 = listSutrasFromFs({ page: 2, pageSize: 2 });
    expect(r2?.items).toHaveLength(1);
  });

  it('getSutraByIdFromFs returns full sutra', () => {
    seedFs();
    const s = getSutraByIdFromFs(2);
    expect(s?.id).toBe(2);
    expect(s?.slug).toBe('jingang');
    expect(s?.chunks).toHaveLength(2);
  });

  it('getSutraByIdFromFs returns null for missing id', () => {
    seedFs();
    expect(getSutraByIdFromFs(999)).toBeNull();
  });

  it('sutraExistsBySlug checks filesystem', () => {
    seedFs();
    expect(sutraExistsBySlug('xinjing')).toBe(true);
    expect(sutraExistsBySlug('nope')).toBe(false);
  });

  it('sutrasFsStats reports file count', () => {
    seedFs();
    const stats = sutraFsStats();
    expect(stats.exists).toBe(true);
    expect(stats.fileCount).toBe(4); // 3 sutras + manifest
  });
});