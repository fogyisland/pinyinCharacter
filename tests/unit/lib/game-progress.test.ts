// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PROGRESS_KEY,
  collectChar,
  dailyKey,
  defaultProgress,
  loadProgress,
  localDateKey,
  markLevelPassed,
  recordDaily,
  recordMiss,
  saveProgress,
  type CharSnapshot,
  type CollectedSnapshot,
  type GameProgress,
} from '@/lib/game-progress';

/**
 * The progress store keeps everything in localStorage, so the test needs a
 * working localStorage. happy-dom's own one has no clear(), and Node's
 * built-in one is a non-functional stub, so the house in-memory shim is
 * installed instead - it also lets a single write fail on demand, which is
 * how the private-mode case is exercised.
 */
interface StorageShim {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

let writesFail = false;

function installStorageShim(): void {
  const store = new Map<string, string>();
  const shim: StorageShim = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (writesFail) {
        throw new Error('QuotaExceededError: the storage is full');
      }
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: shim });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: shim });
}

/** The snapshot the collection book stores - it carries the story flag. */
const collectedSnapshot: CollectedSnapshot = {
  pinyin: 'ài',
  plainPinyin: 'ai',
  tone: 4,
  toneName: 'fourth',
  radical: '心',
  meaningShort: 'to love',
  hasStory: true,
};

/** The snapshot the wrong book stores - the same fields minus the story flag. */
const plainSnapshot: CharSnapshot = {
  pinyin: 'ài',
  plainPinyin: 'ai',
  tone: 4,
  toneName: 'fourth',
  radical: '心',
  meaningShort: 'to love',
};

/**
 * `defaultProgress()` stamps `updatedAt` with the current time, so the two
 * objects can never be compared with a deep equality. The stable fields are
 * compared instead.
 */
function expectDefaultProgress(progress: GameProgress): void {
  expect(progress.version).toBe(1);
  expect(progress.current).toEqual({});
  expect(progress.passed).toEqual({});
  expect(progress.streak).toBe(0);
  expect(progress.bestStreak).toBe(0);
  expect(progress.collected).toEqual({});
  expect(progress.wrong).toEqual({});
  expect(progress.daily).toEqual({});
}

/**
 * Capture the warnings of the module.
 *
 * The library has to log when it degrades, so the warning is a behaviour that
 * is asserted - and while the spy is installed it keeps the test output
 * clean.
 */
function captureWarnings(): { messages: string[]; restore: () => void } {
  const messages: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    messages.push(String(args[0]));
  });
  return { messages, restore: () => spy.mockRestore() };
}

/** The fixed local date the daily tests are pinned to. */
const FIXED_DATE = new Date(2026, 9, 25, 12, 0, 0);
const FIXED_DATE_KEY = '2026-10-25';

beforeEach(() => {
  writesFail = false;
  installStorageShim();
});

afterEach(() => {
  writesFail = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('game-progress', () => {
  it('resets to the default when the stored payload is corrupt', () => {
    const warnings = captureWarnings();

    try {
      window.localStorage.setItem(PROGRESS_KEY, '{not json');

      const progress = loadProgress();

      expectDefaultProgress(progress);
      expect(warnings.messages.some((message) => message.includes('[game-progress]'))).toBe(true);
    } finally {
      warnings.restore();
    }
  });

  it('resets to the default when the stored payload has an unknown version', () => {
    const warnings = captureWarnings();

    try {
      window.localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ version: 99, current: { '1': { level: 7 } }, streak: 12 }),
      );

      const progress = loadProgress();

      expectDefaultProgress(progress);
      expect(warnings.messages.some((message) => message.includes('[game-progress]'))).toBe(true);
    } finally {
      warnings.restore();
    }
  });

  it('returns the default on the server, where there is no window', () => {
    vi.stubGlobal('window', undefined);

    try {
      expectDefaultProgress(loadProgress());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('round-trips a collected character', () => {
    const before = defaultProgress();
    const after = collectChar(before, '爱', collectedSnapshot, 1, 1);

    saveProgress(after);
    const loaded = loadProgress();

    expect(loaded.collected['爱']).toMatchObject({ ...collectedSnapshot, hsk: 1, level: 1 });
    expect(typeof loaded.collected['爱'].at).toBe('number');
    expect(loaded.streak).toBe(1);
    expect(loaded.bestStreak).toBe(1);
    // The mutator is pure - the input is untouched.
    expect(before.collected).toEqual({});
    expect(before.streak).toBe(0);
  });

  it('counts the misses of a character and keeps the story flag out of the wrong book', () => {
    const first = recordMiss(defaultProgress(), '爱', plainSnapshot, 1, 1);
    const second = recordMiss(first, '爱', plainSnapshot, 1, 1);

    expect(second.wrong['爱'].count).toBe(2);
    expect(second.wrong['爱'].lastAt).toBeGreaterThan(first.wrong['爱'].lastAt);
    expect(second.wrong['爱']).not.toHaveProperty('hasStory');
    expect(second.streak).toBe(0);

    saveProgress(second);
    const loaded = loadProgress();

    expect(loaded.wrong['爱'].count).toBe(2);
    expect(loaded.wrong['爱']).not.toHaveProperty('hasStory');
    expect(loaded.wrong['爱']).toMatchObject({ ...plainSnapshot, hsk: 1, level: 1 });
  });

  it('keeps the per-tier level pointers independent', () => {
    const first = markLevelPassed(defaultProgress(), 1, 3);
    const second = markLevelPassed(first, 4, 2);

    expect(second.current['1'].level).toBe(4);
    expect(second.current['4'].level).toBe(3);
    expect(second.passed['1']).toEqual([3]);
    expect(second.passed['4']).toEqual([2]);
  });

  it('keeps the passed list across a save and load round trip', () => {
    const progress = markLevelPassed(defaultProgress(), 1, 3);

    saveProgress(progress);

    expect(loadProgress().passed['1']).toEqual([3]);
  });

  it('is idempotent when the same level is passed twice', () => {
    const once = markLevelPassed(defaultProgress(), 1, 3);
    const twice = markLevelPassed(once, 1, 3);

    expect(twice.passed['1']).toEqual([3]);
  });

  it('never moves the level pointer backwards', () => {
    const first = markLevelPassed(defaultProgress(), 1, 3);
    const second = markLevelPassed(first, 1, 1);

    expect(second.current['1'].level).toBe(4);
    expect(second.passed['1']).toEqual([3, 1]);
  });

  it('drops a level pointer that is not an object', () => {
    window.localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ version: 1, current: { '1': 'garbage' } }),
    );

    const progress = loadProgress();

    expect(progress.current['1']).toBeUndefined();
    expect(progress.current).toEqual({});
  });

  it('keeps a level pointer that points beyond the tier', () => {
    window.localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ version: 1, current: { '1': { level: 999 } } }),
    );

    const progress = loadProgress();

    expect(progress.current['1']).toEqual({ level: 999 });
  });

  it('drops a collected entry that is not an object', () => {
    window.localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ version: 1, collected: { 爱: null } }),
    );

    const progress = loadProgress();

    expect(progress.collected['爱']).toBeUndefined();
    expect(progress.collected).toEqual({});
  });

  it('keys the daily map by the local date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);

    try {
      const progress = recordDaily(defaultProgress(), 'tone:medium:hsk1', 8);

      expect(progress.daily[FIXED_DATE_KEY]['tone:medium:hsk1']).toEqual({ done: true, score: 8 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the three axes of the daily key independent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_DATE);

    try {
      const tone = dailyKey('tone', 'medium', 1);
      const harderHsk = dailyKey('tone', 'medium', 2);
      const harderMode = dailyKey('tone', 'hard', 1);

      expect(new Set([tone, harderHsk, harderMode]).size).toBe(3);

      const progress = recordDaily(defaultProgress(), tone, 8);

      expect(progress.daily[FIXED_DATE_KEY][harderHsk]).toBeUndefined();
      expect(progress.daily[FIXED_DATE_KEY][harderMode]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never writes to localStorage from a mutator', () => {
    collectChar(defaultProgress(), '爱', collectedSnapshot, 1, 1);
    recordMiss(defaultProgress(), '爱', plainSnapshot, 1, 1);
    markLevelPassed(defaultProgress(), 1, 3);
    recordDaily(defaultProgress(), 'tone:medium:hsk1', 8);

    expect(window.localStorage.length).toBe(0);
  });

  it('does not throw when the storage refuses the write', () => {
    const warnings = captureWarnings();

    try {
      writesFail = true;

      expect(() => saveProgress(defaultProgress())).not.toThrow();
      expect(warnings.messages.some((message) => message.includes('[game-progress]'))).toBe(true);
    } finally {
      writesFail = false;
      warnings.restore();
    }
  });

  it('formats the local date as YYYY-MM-DD', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(localDateKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
