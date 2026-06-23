import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { getChar, getCharDetail, isSuppPlaneChar } from '@/lib/chars';
import { DictionaryDetailTabs } from '@/components/dictionary/DictionaryDetailTabs';
import { buildMetadata } from '@/lib/seo/metadata';
import { buildDefinedTerm, buildBreadcrumbList } from '@/lib/seo/jsonld';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ char: string }> }) {
  const { char: encoded } = await params;
  const ch = decodeURIComponent(encoded);
  const charInfo = await getChar(ch);
  if (!charInfo) return { title: `${ch} | 字·韵` };
  const meaning = (charInfo.meaningZh ?? '').slice(0, 80);
  return buildMetadata({
    title: `${ch} - 拼音 ${charInfo.pinyin} - 释义 | 字·韵`,
    description: `汉字「${ch}」的拼音 ${charInfo.pinyin}，释义：${meaning}`,
    path: `/dictionary/${encoded}`,
    ogType: 'article',
  });
}

export default async function DictionaryDetailPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  // Distinguish three cases: supp-plane (4-byte UTF-8, mysql2 binary protocol
  // corrupts the param) — soft empty state with explanation. Char in DB —
  // render detail page. Char genuinely missing — 404.
  const suppPlane = isSuppPlaneChar(decoded);
  const data = await getCharDetail(decoded);
  if (!data && !suppPlane) notFound();
  if (!data) {
    // Supp-plane soft empty state. Decoded is guaranteed non-empty here.
    const cp = decoded.codePointAt(0)!.toString(16).toUpperCase();
    return (
      <>
        <Suspense><Header /></Suspense>
        <PageContainer>
          <div className="flex items-center justify-between mb-4">
            <Link
              href="/dictionary"
              className="text-sm text-ink-soft hover:text-ink"
            >
              ← 返回字典
            </Link>
            <span className="text-xs text-ink-faint tracking-widest">
              字 · 韵 · 字典
            </span>
          </div>
          <SectionTitle subtitle={`U+${cp} · 增补平面`}>
            <span className="text-7xl font-serif text-ink mr-3 align-middle">{decoded}</span>
          </SectionTitle>
          <EmptyState
            title="字库不支持该字符"
            description={`「${decoded}」属于 Unicode 增补平面（U+${cp}），字典暂未收录。可以在搜索框按部首或拼音查询相近字符。`}
            action={
              <Link href="/dictionary" className="btn-seal text-sm">
                返回字典首页 →
              </Link>
            }
          />
        </PageContainer>
        <Footer />
      </>
    );
  }
  return (
    <>
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(buildDefinedTerm({ char: data.char, meaning: data.meaningZh })) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            buildBreadcrumbList([
              { name: '首页', url: '/' },
              { name: '字典', url: '/dictionary' },
              { name: data.char, url: `/dictionary/${encodeURIComponent(data.char)}` },
            ])
          ),
        }}
      />
      <Suspense><Header /></Suspense>
      <PageContainer>
        <SectionTitle subtitle={`${data.unicodeCodepoint} · 通用规范 ${data.level} 级`}>
          <span className="text-7xl font-serif text-ink mr-3">{data.char}</span>
        </SectionTitle>
        <DictionaryDetailTabs char={data} />
      </PageContainer>
      <Footer />
    </>
  );
}
