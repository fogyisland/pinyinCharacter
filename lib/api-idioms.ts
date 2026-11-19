/**
 * The client for the idiom questions.
 *
 * The route answers `{ idioms, failed }`. A failed envelope — the database
 * did not answer — is not cached, so a retry button actually retries.
 */

/** One idiom, as the game needs it. */
export interface GameIdiom {
  word: string;
  pinyin: string;
  meaning: string;
  level: number;
  category: string;
}

/** What the route answered. */
export interface IdiomsResult {
  idioms: GameIdiom[];
  /** The server's query threw. The list is empty and the game says so. */
  failed: boolean;
}

type CacheKey = string;
const cache = new Map<CacheKey, Promise<IdiomsResult>>();

/**
 * Read the idioms for a level.
 *
 * `level` is the difficulty band; `maxLevel` caps it. Passing neither asks
 * for every level.
 */
export async function fetchIdioms(level?: number, maxLevel?: number): Promise<IdiomsResult> {
  const key = `level:${level ?? 0}:max:${maxLevel ?? 0}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (level !== undefined) params.set('level', String(level));
  if (maxLevel !== undefined) params.set('maxLevel', String(maxLevel));
  const query = params.toString();
  const pending = fetch(`/api/idioms${query ? `?${query}` : ''}`)
    .then((response) => {
      if (!response.ok) throw new Error(`fetch /api/idioms failed: ${response.status}`);
      return response.json();
    })
    .then((data): IdiomsResult => {
      if (data && typeof data === 'object' && Array.isArray((data as { idioms?: unknown }).idioms)) {
        const envelope = data as { idioms: GameIdiom[]; failed?: boolean };
        return { idioms: envelope.idioms, failed: envelope.failed ?? false };
      }
      return { idioms: [], failed: false };
    });

  cache.set(key, pending);
  pending.then(
    (result) => {
      if (result.failed && cache.get(key) === pending) cache.delete(key);
    },
    () => {
      if (cache.get(key) === pending) cache.delete(key);
    },
  );
  return pending;
}

export function __resetIdiomCache(): void {
  cache.clear();
}
