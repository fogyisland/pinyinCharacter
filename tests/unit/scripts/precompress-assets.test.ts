import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isCompressible,
  precompressFile,
  precompressTree,
} from '../../../scripts/precompress-assets.mjs';

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('isCompressible', () => {
  it('accepts text payloads', () => {
    for (const file of ['a.js', 'a.css', 'a.json', 'a.svg', 'a.html', 'a.txt']) {
      expect(isCompressible(file)).toBe(true);
    }
  });

  it('rejects already-compressed payloads', () => {
    for (const file of ['a.woff2', 'a.png', 'a.jpg', 'a.webp', 'a.mp3', 'a.gz', 'a.br']) {
      expect(isCompressible(file)).toBe(false);
    }
  });
});

describe('precompressFile', () => {
  it('writes a .br next to the source and shrinks it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    await writeFile(file, 'console.log("x");'.repeat(500));
    const result = await precompressFile(file);
    expect(result.status).toBe('written');
    expect(result.bytesOut).toBeLessThan(result.bytesIn);
    const br = await readFile(`${file}.br`);
    expect(br.length).toBe(result.bytesOut);
  });

  it('skips a file whose .br is newer than the source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'app.js');
    await writeFile(file, 'console.log("x");'.repeat(500));
    await precompressFile(file);
    const second = await precompressFile(file);
    expect(second.status).toBe('skipped');
  });

  it('refuses to touch an already-compressed file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    const file = join(dir, 'font.woff2');
    await writeFile(file, 'not really a font');
    const result = await precompressFile(file);
    expect(result.status).toBe('skipped');
    await expect(stat(`${file}.br`)).rejects.toThrow();
  });
});

describe('precompressTree', () => {
  it('walks a directory tree and reports the totals', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'precompress-'));
    dirs.push(dir);
    await writeFile(join(dir, 'a.css'), 'body{color:red}'.repeat(200));
    await writeFile(join(dir, 'b.woff2'), 'binary');
    const result = await precompressTree(dir);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.savedBytes).toBeGreaterThan(0);
  });
});
