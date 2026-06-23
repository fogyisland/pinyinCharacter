import { loadManifest, loadPoem } from './loader';
import type { Dynasty, PoemDetail, PoemListItem, PoemListResult } from '../poetry-types';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export interface ListPoemsArgs {
  dynasty: Dynasty;
  category?: string | null;
  forms?: string[] | null;
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

/**
 * Filter semantics:
 * - `dynasty`: required. Item must have `dynasty === args.dynasty`.
 * - `category`: optional synonym for `dynasty`. When set, item must also
 *   have `dynasty === args.category`. This is intentional and exists
 *   because manifest items for the 5 new collections have their `dynasty`
 *   set to the collection label (e.g. `汉`, `魏`, `汉末`, `汉乐府`,
 *   `古诗十九首`, `骈文`, `yuan`, `qing`, `mixed`) — so a caller asking
 *   for `category='tang'` with `dynasty='song'` will match nothing, since
 *   both filters apply as an AND. Future callers should pass the same
 *   value to both `dynasty` and `category` (or omit `category`).
 * - `forms`: optional array filter, independent of `dynasty`/`category`.
 *   Item must have a non-null `form` AND that form must appear in the
 *   array. Empty array is treated as "no filter".
 * - `form`: optional single-form filter. Same semantics as `forms`
 *   but for one value. Exists for legacy callers.
 */
export async function listPoems(args: ListPoemsArgs): Promise<PoemListResult> {
  const manifest = await loadManifest();
  const page = Math.max(1, args.page ?? 1);
  const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, args.pageSize ?? DEFAULT_PAGE_SIZE));
  const filtered = manifest.items.filter(i =>
    i.dynasty === args.dynasty &&
    (args.category == null || i.dynasty === args.category) &&
    (args.forms == null || args.forms.length === 0 || (i.form != null && args.forms.includes(i.form))) &&
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

export async function getAvailableForms(category: string): Promise<string[]> {
  const manifest = await loadManifest();
  const counts = new Map<string, number>();
  for (const i of manifest.items) {
    if (i.dynasty !== category || !i.form) continue;
    counts.set(i.form, (counts.get(i.form) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([form]) => form);
}