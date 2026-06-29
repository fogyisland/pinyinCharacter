import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  readJsonAuto,
  readJsonAutoCached,
  invalidateJsonCache,
  clearJsonCache,
  resolveJsonPath,
} from '@/lib/json-fs';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'json-fs-'));
});

afterEach(() => {
  clearJsonCache();
  rmSync(dir, { recursive: true, force: true });
});

function writeJsonGz(name: string, data: unknown) {
  const buf = gzipSync(Buffer.from(JSON.stringify(data), 'utf8'));
  writeFileSync(join(dir, name), buf);
}

function writeJson(name: string, data: unknown) {
  writeFileSync(join(dir, name), JSON.stringify(data), 'utf8');
}

describe('readJsonAuto', () => {
  it('reads plain .json when present', () => {
    writeJson('a.json', { x: 1 });
    expect(readJsonAuto(join(dir, 'a.json'))).toEqual({ x: 1 });
  });

  it('falls back to .json.gz when .json is missing', () => {
    writeJsonGz('a.json.gz', { y: 2 });
    expect(readJsonAuto(join(dir, 'a.json'))).toEqual({ y: 2 });
  });

  it('prefers .json over .json.gz when both exist', () => {
    writeJson('a.json', { from: 'plain' });
    writeJsonGz('a.json.gz', { from: 'gz' });
    expect(readJsonAuto(join(dir, 'a.json'))).toEqual({ from: 'plain' });
  });

  it('returns null when neither file exists', () => {
    expect(readJsonAuto(join(dir, 'missing.json'))).toBeNull();
  });

  it('handles large Chinese text with proper UTF-8 round-trip', () => {
    writeJsonGz('big.json.gz', { title: '史记·五帝本纪', chars: '黄帝者少典之子' });
    expect(readJsonAuto(join(dir, 'big.json'))).toEqual({
      title: '史记·五帝本纪',
      chars: '黄帝者少典之子',
    });
  });
});

describe('readJsonAutoCached', () => {
  it('caches parsed value across calls', () => {
    writeJson('a.json', { n: 1 });
    const path = join(dir, 'a.json');
    const v1 = readJsonAutoCached(path);
    const v2 = readJsonAutoCached(path);
    expect(v1).toEqual({ n: 1 });
    expect(v2).toBe(v1); // exact same reference
  });

  it('caches .json.gz fallback too', () => {
    writeJsonGz('b.json.gz', { n: 2 });
    const path = join(dir, 'b.json');
    const v1 = readJsonAutoCached(path);
    const v2 = readJsonAutoCached(path);
    expect(v1).toEqual({ n: 2 });
    expect(v2).toBe(v1);
  });

  it('does not cache null (missing) so retries are cheap and never stale', () => {
    const path = join(dir, 'absent.json');
    expect(readJsonAutoCached(path)).toBeNull();
    writeJson('absent.json', { arrived: true });
    expect(readJsonAutoCached(path)).toEqual({ arrived: true });
  });

  it('invalidateJsonCache removes a single entry', () => {
    writeJson('c.json', { v: 1 });
    const path = join(dir, 'c.json');
    const first = readJsonAutoCached(path);
    invalidateJsonCache(path);
    writeJson('c.json', { v: 2 });
    const second = readJsonAutoCached(path);
    expect(first).toEqual({ v: 1 });
    expect(second).toEqual({ v: 2 });
  });

  it('clearJsonCache wipes everything (used by tests + bulk importers)', () => {
    writeJson('d.json', { v: 1 });
    readJsonAutoCached(join(dir, 'd.json'));
    clearJsonCache();
    writeJson('d.json', { v: 2 });
    expect(readJsonAutoCached(join(dir, 'd.json'))).toEqual({ v: 2 });
  });
});

describe('resolveJsonPath', () => {
  it('returns .json path when present', () => {
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub/x.json'), JSON.stringify({ a: 1 }), 'utf8');
    expect(resolveJsonPath(join(dir, 'sub'), 'x')).toBe(join(dir, 'sub/x.json'));
  });

  it('returns .json.gz path when .json is missing', () => {
    mkdirSync(join(dir, 'sub'));
    const buf = gzipSync(Buffer.from(JSON.stringify({ a: 1 }), 'utf8'));
    writeFileSync(join(dir, 'sub/x.json.gz'), buf);
    expect(resolveJsonPath(join(dir, 'sub'), 'x')).toBe(join(dir, 'sub/x.json.gz'));
  });

  it('returns null when neither exists', () => {
    expect(resolveJsonPath(dir, 'nope')).toBeNull();
  });
});