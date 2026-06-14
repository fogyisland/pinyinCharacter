import type { Char } from './chars-types';

export interface CharsListResult {
  chars: Char[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchChars(opts: {
  q?: string;
  level?: 1 | 2 | 3;
  page?: number;
} = {}): Promise<CharsListResult> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.level) params.set('level', String(opts.level));
  if (opts.page) params.set('page', String(opts.page));
  const res = await fetch(`/api/chars?${params.toString()}`);
  const json = (await res.json()) as { ok: boolean; data: CharsListResult; error?: { message: string } };
  if (!json.ok) throw new Error(json.error?.message ?? 'fetchChars failed');
  return json.data;
}
