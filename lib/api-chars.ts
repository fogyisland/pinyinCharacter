import type { Char } from './chars-types';

export interface CharsListResult {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

// 2026-07-04: T9 — DragMatchGame threads hskLevel to the /api/chars endpoint
// so the server filters by HSK column instead of (or in addition to) the
// legacy level column.
export type FetchCharsOpts = {
  q?: string;
  level?: 1 | 2 | 3;
  hskLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  page?: number;
};

export async function fetchChars(opts: FetchCharsOpts = {}): Promise<CharsListResult> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.level) params.set('level', String(opts.level));
  if (opts.hskLevel) params.set('hskLevel', String(opts.hskLevel));
  if (opts.page) params.set('page', String(opts.page));
  const res = await fetch(`/api/chars?${params.toString()}`);
  const json = (await res.json()) as { ok: boolean; data: CharsListResult; error?: { message: string } };
  if (!json.ok) throw new Error(json.error?.message ?? 'fetchChars failed');
  return json.data;
}
