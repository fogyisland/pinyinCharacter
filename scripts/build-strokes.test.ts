import { describe, it, expect, vi, beforeEach } from 'vitest';

interface BuildStrokesOptions {
  fetchImpl?: typeof fetch;
  readFile?: (p: string) => Promise<string>;
  writeFile?: (p: string, content: string) => Promise<void>;
  mkdir?: (p: string) => Promise<void>;
}

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

import * as fsPromises from 'fs/promises';
import { buildStrokes } from './build-strokes';

describe('buildStrokes', () => {
  beforeEach(() => {
    vi.mocked(fsPromises.readFile).mockReset();
    vi.mocked(fsPromises.writeFile).mockReset();
    vi.mocked(fsPromises.mkdir).mockReset();
  });

  it('writes one JSON per char and a manifest', async () => {
    // 2-char fixture list
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(['一', '丁']));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{"strokes":[]}'),
    } as any);

    const result = await buildStrokes({ fetchImpl });

    expect(result.supported).toEqual(['一', '丁']);
    expect(result.missing).toEqual([]);
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('public/strokes/一.json'),
      '{"strokes":[]}',
      'utf-8',
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('public/strokes/丁.json'),
      '{"strokes":[]}',
      'utf-8',
    );
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('data/strokes-manifest.json'),
      expect.stringContaining('"supported"'),
      'utf-8',
    );
  });

  it('records missing chars in manifest when all sources fail', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(['X']));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));

    const result = await buildStrokes({ fetchImpl });

    expect(result.supported).toEqual([]);
    expect(result.missing).toEqual(['X']);
    // No per-char JSON written
    expect(fsPromises.writeFile).not.toHaveBeenCalledWith(
      expect.stringContaining('public/strokes/X.json'),
      expect.anything(),
      expect.anything(),
    );
    // Manifest still written
    expect(fsPromises.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('data/strokes-manifest.json'),
      expect.stringContaining('"missing":["X"]'),
      'utf-8',
    );
  });

  it('uses manifest from data/ path, not public/', async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(JSON.stringify(['一']));
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.writeFile).mockResolvedValue(undefined);

    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('{}'),
    } as any);

    await buildStrokes({ fetchImpl });

    const manifestCall = vi.mocked(fsPromises.writeFile).mock.calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('strokes-manifest'),
    );
    expect(manifestCall).toBeDefined();
    expect(manifestCall![0]).toMatch(/^data\//);
  });
});
