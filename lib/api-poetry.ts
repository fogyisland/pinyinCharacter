import type { Dynasty, PoemListResult } from './poetry-types';

export async function listPoemsRequest(args: {
  dynasty: Dynasty;
  category?: string;
  q?: string;
  forms?: string[];
  page?: number;
  pageSize?: number;
}): Promise<PoemListResult> {
  const sp = new URLSearchParams();
  sp.set('dynasty', args.dynasty);
  if (args.category) sp.set('category', args.category);
  if (args.forms && args.forms.length > 0) sp.set('forms', args.forms.join(','));
  if (args.q) sp.set('q', args.q);
  if (args.page) sp.set('page', String(args.page));
  const res = await fetch(`/api/poetry?${sp.toString()}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error?.message ?? 'listPoems failed');
  return j.data;
}

export async function getAvailableFormsRequest(category: string): Promise<string[]> {
  const res = await fetch(`/api/poetry/forms?category=${encodeURIComponent(category)}`);
  if (!res.ok) return [];
  const j = await res.json();
  return j.data?.forms ?? [];
}
