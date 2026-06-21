import { loadManifest, loadPoem } from './loader';
import type { Dynasty, PoemDetail, PoemListItem, PoemListResult } from '../poetry-types';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export interface ListPoemsArgs {
  dynasty: Dynasty;
  q?: string;
  form?: string | null;
  page?: number;
  pageSize?: number;
}

function firstChar(s: string): string {
  const arr = Array.from(s.trim());
  return arr[0] ?? '';
}

function matchesQ(item: { title: string; author: string }, q: string): boolean {
  if (!q) return true;
  const trimmed = q.trim();
  if (!trimmed) return true;
  const first = firstChar(trimmed);
  return item.title.includes(trimmed) || item.author.includes(trimmed) || (first.length > 0 && item.title.includes(first));
}

export async function listPoems(args: ListPoemsArgs): Promise<PoemListResult> {
  const manifest = await loadManifest();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, args.pageSize ?? DEFAULT_PAGE_SIZE));
  const filtered = manifest.items.filter(i =>
    i.dynasty === args.dynasty &&
    (args.form == null || i.form === args.form) &&
    matchesQ({ title: i.title, author: i.author }, args.q ?? '')
  );
  const start = (page - 1) * pageSize;
  const slice = filtered.slice(start, start + pageSize);
  const items: PoemListItem[] = slice.map(i => ({
    id: i.id, title: i.title, author: i.author, dynasty: i.dynasty as Dynasty, form: i.form,
  }));
  return { items, total: filtered.length, page, pageSize };
}

export async function getPoem(id: number): Promise<PoemDetail | null> {
  return loadPoem(id);
}

export async function getRandomPoem(opts?: { dynasty?: Dynasty; form?: string | null }): Promise<PoemDetail | null> {
  const manifest = await loadManifest();
  const candidates = manifest.items.filter(i =>
    (!opts?.dynasty || i.dynasty === opts.dynasty) &&
    (opts?.form == null || i.form === opts.form)
  );
  if (candidates.length === 0) return null;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  return loadPoem(pick.id);
}

export async function listForms(): Promise<{ form: string; count: number }[]> {
  const manifest = await loadManifest();
  const counts = new Map<string, number>();
  for (const i of manifest.items) {
    if (!i.form) continue;
    counts.set(i.form, (counts.get(i.form) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([form, count]) => ({ form, count }))
    .sort((a, b) => b.count - a.count);
}

export async function listDynasties(): Promise<string[]> {
  const manifest = await loadManifest();
  const set = new Set<string>();
  for (const i of manifest.items) set.add(i.dynasty);
  return Array.from(set).sort();
}
