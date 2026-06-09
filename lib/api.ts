export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

export interface Candidate { char: string; freq: number; }

export async function fetchCandidates(
  pinyin: string,
  safeMode: boolean,
  script: 'simplified' | 'traditional'
): Promise<ApiResult<{ candidates: Candidate[] }>> {
  const params = new URLSearchParams({ pinyin, safeMode: String(safeMode), script });
  const res = await fetch(`/api/pinyin/candidates?${params}`);
  return (await res.json()) as ApiResult<{ candidates: Candidate[] }>;
}

export async function fetchSentence(
  pinyin: string,
  safeMode: boolean,
  script: 'simplified' | 'traditional'
): Promise<ApiResult<{ sentence: string }>> {
  const params = new URLSearchParams({ pinyin, safeMode: String(safeMode), script });
  const res = await fetch(`/api/pinyin/sentence?${params}`);
  return (await res.json()) as ApiResult<{ sentence: string }>;
}
