import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { getChar, getCharDetail } from '@/lib/chars';
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
  const data = await getCharDetail(decoded);
  if (!data) notFound();
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