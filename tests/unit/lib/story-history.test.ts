// @vitest-environment happy-dom
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { GlobalWindow } from 'happy-dom';
import { getReadChars, addReadChar, clearReadHistory } from '@/lib/story-history';

// happy-dom 20 in vitest 2.1.9 exposes `localStorage` on globalThis as a
// plain object (no Storage prototype). Replace it with a real Storage
// instance from a fresh GlobalWindow so setItem/getItem/clear work.
beforeAll(() => {
  const win = new GlobalWindow({ url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'localStorage', {
    get: () => win.localStorage,
    configurable: true,
  });
});

beforeEach(() => {
  localStorage.clear();
  clearReadHistory();
});

describe('story-history', () => {
  it('returns empty array when no key set', () => {
    expect(getReadChars()).toEqual([]);
  });

  it('adds char and reads back', () => {
    addReadChar('龘');
    expect(getReadChars()).toEqual(['龘']);
  });

  it('does not duplicate char (Set semantics)', () => {
    addReadChar('龘');
    addReadChar('龘');
    addReadChar('好');
    expect(getReadChars().sort()).toEqual(['好', '龘']);
  });

  it('caps at 500 chars (FIFO)', () => {
    for (let i = 0; i < 510; i++) addReadChar(String.fromCodePoint(0x4e00 + i));
    const arr = getReadChars();
    expect(arr.length).toBe(500);
  });

  it('clearReadHistory empties the storage', () => {
    addReadChar('龘');
    addReadChar('好');
    clearReadHistory();
    expect(getReadChars()).toEqual([]);
  });

  it('returns [] silently when localStorage throws', () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => { throw new Error('QuotaExceeded'); };
    expect(getReadChars()).toEqual([]);
    Storage.prototype.getItem = original;
  });
});
