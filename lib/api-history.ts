export type HistoryKind = 'text2pinyin' | 'pinyin2text';
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export interface HistoryRow {
  id: number;
  user_id: number;
  kind: HistoryKind;
  input: string;
  output: string | null;
  is_favorite: 0 | 1;
  char_count: number;
  created_at: string | Date;
}

export interface Stats { total: number; favorites: number; }

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  const res = await fetch(path, { ...init, credentials: 'same-origin' });
  if (res.status === 204) return { ok: true, data: null as any };
  const j = await res.json();
  return j as ApiResult<T>;
}

export async function listHistoryRequest(opts: { favorite?: boolean; limit?: number; offset?: number } = {}): Promise<ApiResult<{ history: HistoryRow[] }>> {
  const sp = new URLSearchParams();
  if (opts.favorite) sp.set('favorite', 'true');
  if (opts.limit !== undefined) sp.set('limit', String(opts.limit));
  if (opts.offset !== undefined) sp.set('offset', String(opts.offset));
  const qs = sp.toString();
  return call(`/api/history${qs ? '?' + qs : ''}`, { method: 'GET' });
}

export interface CreateHistoryArgs {
  kind: HistoryKind;
  input: string;
  output?: string | null;
  char_count: number;
  dedup?: boolean;
}

export async function createHistoryRequest(args: CreateHistoryArgs): Promise<ApiResult<{ id: number; deduped: boolean }>> {
  return call('/api/history', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(args),
  });
}

export async function setFavoriteRequest(id: number, isFavorite: boolean): Promise<ApiResult<{ id: number; is_favorite: boolean }>> {
  return call(`/api/history/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ is_favorite: isFavorite }),
  });
}

export async function deleteHistoryRequest(id: number): Promise<ApiResult<null>> {
  return call(`/api/history/${id}`, { method: 'DELETE' });
}

export async function statsRequest(): Promise<ApiResult<Stats>> {
  return call('/api/stats', { method: 'GET' });
}