export interface RareCharClient {
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  needsReview: boolean;
  generatedBy: string | null;
  generatedAt: string | null;
  createdAt: string;
}

export interface ListResultClient {
  chars: RareCharClient[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchRareChars(opts: { q?: string; page?: number } = {}): Promise<ListResultClient> {
  const params = new URLSearchParams();
  if (opts.q) params.set('q', opts.q);
  if (opts.page) params.set('page', String(opts.page));
  const res = await fetch(`/api/rare-chars?${params.toString()}`);
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'fetch failed';
    throw new Error(msg);
  }
  return data.data;
}

export async function fetchRareChar(char: string): Promise<RareCharClient> {
  const res = await fetch(`/api/rare-chars/${encodeURIComponent(char)}`);
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'fetch failed';
    throw new Error(msg);
  }
  return data.data;
}

export async function fetchDailyChar(date?: string): Promise<{
  char: string;
  pinyin: string;
  meaning: string;
  story: string;
  date: string;
}> {
  const url = date ? `/api/rare-chars/daily?date=${date}` : '/api/rare-chars/daily';
  const res = await fetch(url);
  const data = await res.json();
  if (!data.ok) {
    const msg = typeof data.error === 'string' ? data.error : data.error?.message ?? 'fetch failed';
    throw new Error(msg);
  }
  return data.data;
}
