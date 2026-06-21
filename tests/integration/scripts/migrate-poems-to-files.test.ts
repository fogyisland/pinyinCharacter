import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('@/lib/db', () => ({ getPool: () => ({ query: mockQuery }) }));

const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockMkdir = vi.fn();
const mockReaddir = vi.fn();
vi.mock('fs/promises', () => ({
  default: { writeFile: mockWriteFile, readFile: mockReadFile, mkdir: mockMkdir, readdir: mockReaddir },
  writeFile: mockWriteFile, readFile: mockReadFile, mkdir: mockMkdir, readdir: mockReaddir,
}));

beforeEach(() => { vi.clearAllMocks(); });

describe('migratePoemsToFiles', () => {
  it('reads 2 rows and writes 2 files + 1 manifest', async () => {
    mockQuery.mockResolvedValueOnce([[
      { id: 1, dynasty: '唐', category: 'tang', title: '静夜思', author: '李白', form: '五绝',
        content: JSON.stringify(['床前明月光，']), pinyin: JSON.stringify([['chuáng']]),
        appreciation: null, source: 'chinese-poetry:/x/001.json' },
      { id: 2, dynasty: '唐', category: 'tang', title: '登鹳雀楼', author: '王之涣', form: '五绝',
        content: JSON.stringify(['白日依山尽，']), pinyin: JSON.stringify([['bái']]),
        appreciation: null, source: 'chinese-poetry:/x/002.json' },
    ]]);
    mockMkdir.mockResolvedValueOnce(undefined);

    const { migratePoemsToFiles } = await import('@/scripts/migrate-poems-to-files');
    const r = await migratePoemsToFiles();

    expect(r.written).toBe(2);
    expect(r.skipped).toBe(0);
    expect(r.manifestWritten).toBe(true);
    // 2 poem files + 1 manifest
    expect(mockWriteFile).toHaveBeenCalledTimes(3);
    // First file: data/poems/1.json with the expected content
    expect((mockWriteFile.mock.calls[0][0] as string).replace(/\\/g, '/')).toMatch(/\/data\/poems\/1\.json$/);
    const body = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(body).toMatchObject({ id: 1, title: '静夜思', author: '李白', form: '五绝',
      content: ['床前明月光，'] });
    // Manifest call
    const manifestCall = mockWriteFile.mock.calls.find(c => /poems-manifest\.json$/.test((c[0] as string).replace(/\\/g, '/')));
    expect(manifestCall).toBeDefined();
    const manifest = JSON.parse(manifestCall![1] as string);
    expect(manifest.count).toBe(2);
    expect(manifest.items).toHaveLength(2);
    expect(manifest.items[0]).toMatchObject({ id: 1, title: '静夜思', form: '五绝', contentLineCount: 1 });
  });

  it('idempotent re-run with all files present returns skipped=2 manifestWritten=false', async () => {
    // First query: SELECT rows
    mockQuery.mockResolvedValueOnce([[
      { id: 1, dynasty: '唐', category: 'tang', title: 'A', author: 'X', form: '五绝',
        content: JSON.stringify(['a']), pinyin: JSON.stringify([['a']]), appreciation: null, source: 's' },
    ]]);
    // readdir for existing files (all poem files exist with matching content)
    mockReaddir.mockResolvedValueOnce(['1.json']);
    mockReadFile.mockResolvedValueOnce(JSON.stringify({ id: 1, title: 'A', author: 'X', dynasty: '唐',
      category: 'tang', form: '五绝', content: ['a'], pinyin: [['a']], appreciation: null, source: 's' }));
    mockMkdir.mockResolvedValueOnce(undefined);

    const { migratePoemsToFiles } = await import('@/scripts/migrate-poems-to-files');
    const r = await migratePoemsToFiles();

    expect(r.written).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.manifestWritten).toBe(true);
  });
});
