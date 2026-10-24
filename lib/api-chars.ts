import type { Char } from './chars-types';

export interface CharsListResult {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * The envelope of `/api/chars`: the page of characters plus the flag that
 * tells the client whether the server had to widen the HSK filter.
 */
export interface CharsListResponse extends CharsListResult {
  hskFallback: boolean;
}

// 2026-07-04: T9 — DragMatchGame threads hskLevel to the /api/chars endpoint
// so the server filters by HSK column instead of (or in addition to) the
// legacy level column.
export type FetchCharsOpts = {
  q?: string;
  level?: 1 | 2 | 3;
  hskLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  page?: number;
  /** Lets the caller cancel a request that is no longer needed. */
  signal?: AbortSignal;
};

export async function fetchChars(opts: FetchCharsOpts = {}): Promise<CharsListResponse> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.level) params.set('level', String(opts.level));
  if (opts.hskLevel) params.set('hskLevel', String(opts.hskLevel));
  if (opts.page) params.set('page', String(opts.page));
  const res = await fetch(`/api/chars?${params.toString()}`, { signal: opts.signal });
  const json = (await res.json()) as {
    ok: boolean;
    data: CharsListResult;
    hskFallback?: boolean;
    error?: { message: string };
  };
  if (!json.ok) throw new Error(json.error?.message ?? 'fetchChars failed');
  return { ...json.data, hskFallback: json.hskFallback ?? false };
}
