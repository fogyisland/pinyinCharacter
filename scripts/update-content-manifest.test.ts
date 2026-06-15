import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { updateContentManifest } from './update-content-manifest';

describe('updateContentManifest', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readFileSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(writeFileSync).mockReset();
    vi.mocked(mkdirSync).mockReset();
  });

  it('writes all-zero manifest when content dir is empty', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    vi.mocked(mkdirSync).mockReturnValue(undefined);
    vi.mocked(readdirSync).mockReturnValue([] as any);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const manifest = await updateContentManifest();

    expect(manifest.byField.meaning_zh).toBe(0);
    expect(manifest.byField.etymology_story).toBe(0);
    expect(manifest.byField.hanzi_story).toBe(0);
    expect(manifest.totalChars).toBe(8105);
    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('content-manifest.json'),
      expect.stringContaining('"version": 1'),
      'utf8'
    );
  });

  it('counts fields across multiple files', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['一.json', '丁.json', '㐀.json'] as any);
    vi.mocked(readFileSync).mockImplementation(((p: any) => {
      const path = String(p);
      if (path.endsWith('一.json')) return JSON.stringify({ char: '一', pinyin: 'yī', meaning_zh: 'm', etymology_story: 'e'.repeat(150) });
      if (path.endsWith('丁.json')) return JSON.stringify({ char: '丁', pinyin: 'dīng', meaning_zh: 'm' });
      if (path.endsWith('㐀.json')) return JSON.stringify({ char: '㐀', pinyin: 'x', hanzi_story: 'h'.repeat(20) });
      return '{}';
    }) as any);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const manifest = await updateContentManifest();
    expect(manifest.byField.meaning_zh).toBe(2);
    expect(manifest.byField.etymology_story).toBe(1);
    expect(manifest.byField.hanzi_story).toBe(1);
  });

  it('skips files that fail zod parse (logs but does not throw)', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue(['一.json', 'bad.json'] as any);
    vi.mocked(readFileSync).mockImplementation(((p: any) => {
      const path = String(p);
      if (path.endsWith('一.json')) return JSON.stringify({ char: '一', pinyin: 'yī' });
      if (path.endsWith('bad.json')) return 'not json';
      return '{}';
    }) as any);
    vi.mocked(writeFileSync).mockReturnValue(undefined);

    const manifest = await updateContentManifest();
    expect(manifest.byField.meaning_zh).toBe(0);
  });
});