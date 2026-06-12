import type { SutraListResult, SutraDetail } from './sutra-types';

export async function listSutrasRequest(args: { q?: string; page?: number } = {}): Promise<SutraListResult> {
  const sp = new URLSearchParams();
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/sutras${sp.toString() ? '?' + sp.toString() : ''}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listSutras failed');
  return j.data;
}

export async function getSutraRequest(id: number): Promise<SutraDetail> {
  const res = await fetch(`/api/sutras/${id}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'getSutra failed');
  return j.data;
}

export async function printSutraRequest(slug: string, chunkId: string): Promise<{ sourceId: string }> {
  const res = await fetch(`/api/sutra/${slug}/print`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceId: `${slug}#${chunkId}` }),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'printSutra failed');
  return j.data;
}
