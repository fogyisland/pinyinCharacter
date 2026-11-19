/**
 * lib/magic-char-data.ts — reading the relation table.
 *
 * The table is `data/magic-chars.json`, a build product of
 * `scripts/build-magic-chars.ts`. It is read from disk rather than
 * imported, because it is several megabytes and importing it would put
 * it in the client bundle.
 *
 * These tests read a table file of their own, so they do not need the
 * real build to have run.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMagicTable, __resetMagicTableCache } from '@/lib/magic-char-data';

describe('the relation table reader', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'magic-table-'));
    __resetMagicTableCache();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    __resetMagicTableCache();
  });

  it('reads the table from the file', () => {
    const file = join(dir, 'table.json');
    writeFileSync(file, JSON.stringify({ 大: { 太: 'add' } }), 'utf-8');
    expect(getMagicTable(file)).toEqual({ 大: { 太: 'add' } });
  });

  it('reads the table only once', () => {
    const file = join(dir, 'table.json');
    writeFileSync(file, JSON.stringify({ 大: { 太: 'add' } }), 'utf-8');
    const first = getMagicTable(file);
    // Change the file behind the reader's back — the second read must
    // still be the first one.
    writeFileSync(file, JSON.stringify({ 木: { 本: 'add' } }), 'utf-8');
    expect(getMagicTable(file)).toBe(first);
  });

  it('says which file is missing when there is none', () => {
    const file = join(dir, 'nope.json');
    expect(() => getMagicTable(file)).toThrow(/nope\.json/);
  });

  it('says the file is broken when it is not JSON', () => {
    const file = join(dir, 'broken.json');
    writeFileSync(file, 'not json at all', 'utf-8');
    expect(() => getMagicTable(file)).toThrow(/broken\.json/);
  });

  it('gives up on a table that is not an object', () => {
    const file = join(dir, 'array.json');
    writeFileSync(file, '[]', 'utf-8');
    expect(() => getMagicTable(file)).toThrow(/array\.json/);
  });
});
