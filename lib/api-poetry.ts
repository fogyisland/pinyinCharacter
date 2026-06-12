import type { Dynasty, PoemListResult, PoemDetail } from './poetry-types';

export async function listPoemsRequest(args: { dynasty: Dynasty; q?: string; page?: number }): Promise<PoemListResult> {
  const sp = new URLSearchParams();
  sp.set('dynasty', args.dynasty);
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/poetry?${sp.toString()}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listPoems failed');
  return j.data;
}

export async function getPoemRequest(id: number): Promise<PoemDetail> {
  const res = await fetch(`/api/poetry/${id}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'getPoem failed');
  return j.data;
}

export async function getRandomPoemRequest(): Promise<PoemDetail | null> {
  const res = await fetch('/api/poetry/random');
  if (res.status === 404) return null;
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'getRandomPoem failed');
  return j.data;
}

export async function printPoemRequest(id: number): Promise<{ id: number }> {
  const res = await fetch(`/api/poetry/${id}/print`, { method: 'POST' });
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'printPoem failed');
  return j.data;
}
