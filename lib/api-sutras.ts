import type { SutraListResult } from './sutra-types';

export async function listSutrasRequest(
  args: { q?: string; page?: number } = {},
): Promise<SutraListResult> {
  const sp = new URLSearchParams();
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/sutras${sp.toString() ? '?' + sp.toString() : ''}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listSutras failed');
  return j.data;
}
