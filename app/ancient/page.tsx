import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassicCategoryNav } from '@/components/classics/ClassicCategoryNav';
import { ClassicCard } from '@/components/classics/ClassicCard';
import { listClassics, countByCategory } from '@/lib/classics';
import type { ClassicCategory } from '@/lib/classics-types';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '古籍 · 字·韵',
  description: '四书五经、弟子规 等经典文本,提供原文与拼音注释,可一键生成字帖。',
};

interface Props {
  searchParams: Promise<{ category?: string; q?: string; page?: string }>;
}

const VALID_CATS = new Set<ClassicCategory>(['four-books', 'five-classics', 'mengxue', 'philosophy', 'history', 'other']);

export default async function AncientListPage({ searchParams }: Props) {
  const sp = await searchParams;
  const rawCat = sp.category;
  const category: ClassicCategory | undefined = rawCat && VALID_CATS.has(rawCat as ClassicCategory) ? (rawCat as ClassicCategory) : undefined;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const [result, counts] = await Promise.all([
    listClassics({ category, q: sp.q, page, pageSize: 12 }),
    countByCategory(),
  ]);

  return (
    <>
      <Suspense><Header /></Suspense>
      <PageContainer>
        <div className="max-w-5xl mx-auto py-8 space-y-6">
          <header className="space-y-2">
            <h1 className="text-3xl font-bold text-ink font-kai">古籍 / Classical Texts</h1>
            <p className="text-sm text-ink-soft">
              四书五经、蒙学、诸子、史书 — 经典文本 + 拼音注释,可一键生成字帖。
            </p>
          </header>

          <ClassicCategoryNav current={category ?? 'all'} counts={counts} />

          <form action="/ancient" method="GET" className="flex gap-2">
            {category && <input type="hidden" name="category" value={category} />}
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="搜索书名 (如 论语, 弟子规)..."
              className="flex-1 rounded-md border border-ink/20 px-3 py-2 text-sm"
            />
            <button type="submit" className="rounded-md bg-seal px-4 py-2 text-white text-sm hover:bg-seal/80">
              搜索
            </button>
          </form>

          {result.items.length === 0 ? (
            <p className="py-12 text-center text-ink-faint">
              暂无数据。先在网络主机跑 <code className="bg-paper-deep px-1 rounded">pnpm run build:classics</code> 导入。
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {result.items.map((item) => (
                <ClassicCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {result.total > result.pageSize && (
            <div className="flex items-center justify-center gap-2 pt-4">
              {page > 1 && (
                <a href={`/ancient?${new URLSearchParams({ ...(category ? { category } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(page - 1) }).toString()}`} className="px-3 py-1 rounded border border-ink/20 text-sm hover:bg-paper-deep">
                  ← 上一页
                </a>
              )}
              <span className="text-sm text-ink-faint">
                第 {page} / {Math.ceil(result.total / result.pageSize)} 页
              </span>
              {page * result.pageSize < result.total && (
                <a href={`/ancient?${new URLSearchParams({ ...(category ? { category } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(page + 1) }).toString()}`} className="px-3 py-1 rounded border border-ink/20 text-sm hover:bg-paper-deep">
                  下一页 →
                </a>
              )}
            </div>
          )}
        </div>
      </PageContainer>
      <Footer />
    </>
  );
}