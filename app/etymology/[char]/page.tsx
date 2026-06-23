import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { PageContainer, SectionTitle } from '@/components/common/PageContainer';
import { EmptyState } from '@/components/common/EmptyState';
import { getEtymology, getAdjacentChars } from '@/lib/etymology';
import { getChar } from '@/lib/chars';
import { EtymologyMorph } from '@/components/etymology/EtymologyMorph';
import { EtymologyPrevNext } from '@/components/etymology/EtymologyPrevNext';
import { ReadAloudButton } from '@/components/ReadAloudButton';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ char: string }>;
}

export default async function EtymologyPage({ params }: Props) {
  const { char } = await params;
  const decoded = decodeURIComponent(char);
  // Three parallel reads: char row (to distinguish "no such char" 404 from
  // "char exists but no etymology" empty state), etymology data, prev/next.
  const [charRow, etymology, adjacent] = await Promise.all([
    getChar(decoded),
    getEtymology(decoded),
    getAdjacentChars(decoded),
  ]);
  if (!charRow) notFound();
  return (
    <>
      <Suspense>
        <Header />
      </Suspense>
      <PageContainer>
        <div className="flex items-center justify-between mb-4">
          <Link
            href={`/dictionary/${encodeURIComponent(decoded)}`}
            className="text-sm text-ink-soft hover:text-ink"
          >
            ← 返回字典
          </Link>
          <span className="text-xs text-ink-faint tracking-widest">
            字 · 韵 · 字源
          </span>
        </div>
        <SectionTitle subtitle={etymology?.story ? '字形演变故事' : '字源即将生成'}>
          <span className="text-5xl sm:text-6xl font-serif text-ink mr-3 align-middle">{decoded}</span>
          <ReadAloudButton text={decoded} size="sm" variant="seal" label="读字" className="align-middle" />
        </SectionTitle>
        {etymology ? (
          <EtymologyMorph
            char={etymology.char}
            eraGlyphs={etymology.eraGlyphs}
            story={etymology.story}
            level={etymology.level}
          />
        ) : (
          // Char is in the chars table but no etymology row + no content JSON
          // story. Show a soft empty state instead of 404 — the route works,
          // we just don't have data for this char yet. (404 would suggest
          // the page is broken or the char doesn't exist anywhere.)
          <EmptyState
            title="字库中无字源"
            description={`「${decoded}」尚未收录字源数据,可在字典查看基本释义。`}
            action={
              <Link
                href={`/dictionary/${encodeURIComponent(decoded)}`}
                className="btn-seal text-sm"
              >
                查看「{decoded}」字典释义 →
              </Link>
            }
          />
        )}
        <EtymologyPrevNext prev={adjacent.prev} next={adjacent.next} />
      </PageContainer>
      <Footer />
    </>
  );
}
