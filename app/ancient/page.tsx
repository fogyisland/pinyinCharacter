import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer } from '@/components/common/PageContainer';
import { ClassicCategoryNav } from '@/components/classics/ClassicCategoryNav';
import { ClassicCard } from '@/components/classics/ClassicCard';
import { listClassics, countByCategory } from '@/lib/classics';
import type { ClassicCategory } from '@/lib/classics-types';
import { buildMetadata } from '@/lib/seo/metadata';

export const dynamic = 'force-dynamic';

/**
 * `buildMetadata` rather than a static `metadata` object: the object supplied
 * a title but no canonical link, and a page that is linked from anywhere with
 * a tracking parameter then looks like a duplicate of itself.
 */
export async function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: '古籍 · 字·韵',
    description: '四书五经、弟子规 等经典文本，提供原文与拼音注释，可一键生成字帖。',
    path: '/ancient',
    ogType: 'website',
  });
}

interface Props {
  searchParams: Promise<{ category?: string; q?: string; page?: string }>;
}

const VALID_CATS = new Set<ClassicCategory>([
  'four-books',
  'five-classics',
  'mengxue',
  'philosophy',
  'history',
  'other',
  'pianwen',
]);

export default async function AncientListPage({ searchParams }: Props) {
  const sp = await searchParams;
  const rawCat = sp.category;
  const category: ClassicCategory | undefined =
    rawCat && VALID_CATS.has(rawCat as ClassicCategory) ? (rawCat as ClassicCategory) : undefined;
  const page = Math.max(1, Number(sp.page ?? '1') || 1);

  const [result, counts] = await Promise.all([
    listClassics({ category, q: sp.q, page, pageSize: 12 }),
    countByCategory(),
  ]);

  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="max-w-5xl mx-auto py-8 space-y-6">
          <header className="publication-heading">
            <h1>古籍</h1>
            <p className="text-sm text-ink-soft">
              按门类选书，循篇章读原文，也可将选段制成字帖。
            </p>
          </header>

          <ClassicCategoryNav current={category ?? 'all'} counts={counts} />
          <nav aria-label="经史子集入门选读" className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            <span className="font-medium">入门选读</span>
            <Link href="/ancient?category=mengxue" className="text-seal underline">蒙学</Link>
            <Link href="/ancient/lunyu" className="text-seal underline">经 · 论语</Link>
            <Link href="/ancient/sanguozhi-1" className="text-seal underline">史 · 三国志</Link>
            <Link href="/ancient/zhuangzi-1" className="text-seal underline">子 · 庄子</Link>
            <Link href="/ancient/chuci" className="text-seal underline">集 · 楚辞</Link>
          </nav>

          <form action="/ancient" method="GET" className="flex gap-2">
            {category && <input type="hidden" name="category" value={category} />}
            <input
              type="search"
              name="q"
              defaultValue={sp.q ?? ''}
              placeholder="搜索书名 (如 论语, 弟子规)..."
              className="flex-1 rounded-md border border-ink/20 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              className="rounded-md bg-seal px-4 py-2 text-white text-sm hover:bg-seal/80"
            >
              搜索
            </button>
          </form>

          {result.items.length === 0 ? (
            <p className="py-12 text-center text-ink-faint">
              暂无数据。先在网络主机跑{' '}
              <code className="bg-paper-deep px-1 rounded">pnpm run build:classics</code> 导入。
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
                <a
                  href={`/ancient?${new URLSearchParams({ ...(category ? { category } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(page - 1) }).toString()}`}
                  className="px-3 py-1 rounded border border-ink/20 text-sm hover:bg-paper-deep"
                >
                  ← 上一页
                </a>
              )}
              <span className="text-sm text-ink-faint">
                第 {page} / {Math.ceil(result.total / result.pageSize)} 页
              </span>
              {page * result.pageSize < result.total && (
                <a
                  href={`/ancient?${new URLSearchParams({ ...(category ? { category } : {}), ...(sp.q ? { q: sp.q } : {}), page: String(page + 1) }).toString()}`}
                  className="px-3 py-1 rounded border border-ink/20 text-sm hover:bg-paper-deep"
                >
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
